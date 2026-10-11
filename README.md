# Rastreio do produto

API HTTP que registra códigos de rastreio, consulta um agregador de rastreamento (fake, atrás de uma interface), normaliza os eventos das transportadoras para `posted | in_transit | out_for_delivery | delivered | exception` e sinaliza atraso quando o tempo em trânsito passa de um limite configurável.

Stack: Node 22+, TypeScript estrito, Fastify 5, zod 4, Vitest 5 e fast-check.

## Como rodar

```bash
npm install
npm test
npm run typecheck
npm start
```

O servidor sobe em `http://127.0.0.1:3000` com o agregador fake carregado com os dois payloads de `examples/`: `QB123456789BR` (Correios) e `JD000123456789` (Jadlog).

| Variável | Padrão | Uso |
| --- | --- | --- |
| `PORT` | `3000` | porta HTTP |
| `HOST` | `127.0.0.1` | interface |
| `DELAY_LIMIT_HOURS` | `120` | limite padrão de trânsito para o alerta de atraso |

## API

| Método | Rota | O que faz |
| --- | --- | --- |
| `POST` | `/trackings` | registra `{ code, delayLimitHours? }`. Devolve `201` se o código é novo e `200` se já existia (idempotente) |
| `GET` | `/trackings/:code` | consulta o agregador, mescla os eventos no histórico e devolve o estado atual. `?refresh=false` devolve o que está salvo sem chamar o agregador |
| `GET` | `/alerts/delays` | lista as remessas não entregues que passaram do limite de trânsito |
| `GET` | `/health` | healthcheck |

Erros: `400` para validação, `404` para código não registrado e `502` quando o agregador falha, devolve um payload inválido ou responde por outro código. Nos casos de `502`, o histórico salvo continua intacto.

### Exemplo

```bash
curl -X POST localhost:3000/trackings -H 'content-type: application/json' -d '{"code":"qb123456789br"}'
```

```json
{"code":"QB123456789BR","carrier":null,"status":null,"registeredAt":"2026-10-04T15:00:00.000Z","lastSyncedAt":null,
 "delay":{"limitHours":120,"startedAt":null,"transitHours":null,"delayed":false},"history":[]}
```

```bash
curl localhost:3000/trackings/QB123456789BR
```

O agregador devolve o payload bruto [`examples/raw-payload.json`](examples/raw-payload.json): eventos fora de ordem, um evento repetido, o mesmo instante em fusos diferentes, um status desconhecido (`XLD`) e um `BDE` (entregue) sem data. A resposta normalizada é [`examples/normalized.json`](examples/normalized.json) (com o relógio em `2026-10-04T15:00Z`), e um teste garante que ela corresponde ao que a API devolve:

```json
{
  "code": "QB123456789BR",
  "carrier": "correios",
  "status": "out_for_delivery",
  "registeredAt": "2026-10-04T15:00:00.000Z",
  "lastSyncedAt": "2026-10-04T15:00:00.000Z",
  "delay": { "limitHours": 120, "startedAt": "2026-10-01T12:12:00.000Z", "transitHours": 74.8, "delayed": false },
  "history": [
    { "occurredAt": "2026-10-01T12:12:00.000Z", "status": "posted", "rawStatus": "PO", "description": "Objeto postado", "location": "São Paulo - SP" },
    { "occurredAt": "2026-10-03T01:40:00.000Z", "status": "in_transit", "rawStatus": "RO", "description": "Objeto em trânsito - por favor aguarde", "location": "Cajamar - SP" },
    { "occurredAt": "2026-10-03T14:10:00.000Z", "status": "in_transit", "rawStatus": "RO", "description": "Objeto em trânsito - por favor aguarde", "location": "Rio de Janeiro - RJ" },
    { "occurredAt": "2026-10-04T11:05:00.000Z", "status": "out_for_delivery", "rawStatus": "OEC", "description": "Objeto saiu para entrega ao destinatário", "location": "Rio de Janeiro - RJ" },
    { "occurredAt": "2026-10-04T13:30:00.000Z", "status": null, "rawStatus": "XLD", "description": "Objeto em análise na unidade", "location": "Rio de Janeiro - RJ" }
  ],
  "sync": { "addedEvents": 5, "discardedEvents": 1 }
}
```

Uma segunda chamada devolve o mesmo histórico com `"sync": { "addedEvents": 0, ... }`.

## Decisões

- **Agregador atrás de interface.** `AggregatorClient.fetchTracking(code)` devolve o payload bruto (`unknown`) ou `null` quando o agregador ainda não conhece o código. `FakeAggregatorClient` guarda payloads em memória e consegue simular falhas. Trocar pelo cliente real é implementar essa interface. O payload é validado com zod na borda.
- **Normalização por tabela, com correspondência exata.** Cada transportadora (`correios`, `jadlog`, `loggi`) tem uma tabela `status bruto -> status normalizado`. A comparação ignora maiúsculas e espaços, mas nunca casa por substring: `NAO ENTREGUE` não vira `delivered` por conter `ENTREGUE`. Status ou transportadora desconhecidos ficam no histórico com `status: null` e o `rawStatus` original, e não alteram o status atual. Por isso um status desconhecido nunca vira `delivered`. As tabelas são `Map`, então chaves como `constructor` ou `__proto__` também não casam.
- **Status derivado do histórico inteiro, nunca do último evento recebido.** As regras:
  1. Se existe um evento `delivered` reconhecido, o status é `delivered`, que é terminal.
  2. Senão, se o evento reconhecido mais recente **pelo horário em que ocorreu** é `exception`, o status é `exception`.
  3. Senão, vale o status mais avançado na escada `posted < in_transit < out_for_delivery`.

  Assim, eventos repetidos ou fora de ordem não fazem o status regredir. Um `in_transit` depois de `out_for_delivery` mantém `out_for_delivery`. Uma `exception` antiga que chega atrasada não sobrescreve um progresso mais novo. Testes de propriedade (fast-check) verificam que o status final não depende da ordem, do agrupamento nem de duplicatas, e que o progresso nunca anda para trás.
- **Deduplicação por identidade do evento.** A chave é o `id` do agregador quando existe. Sem `id`, usa `status + instante em UTC + local`. Datas com offset são convertidas para UTC, então `22:40-03:00` e `01:40Z` contam como o mesmo evento. Consultar de novo só acrescenta os eventos novos, e o histórico fica ordenado por `occurredAt`. Como o histórico só cresce, um `delivered` não se perde se o agregador deixar de mandar esse evento.
- **Eventos malformados são descartados um a um** (sem data, data inválida, sem status), e o total aparece em `sync.discardedEvents`. Um `BDE` sem data não marca a remessa como entregue.
- **Atraso.** O trânsito começa no evento `posted` mais antigo (ou no primeiro evento reconhecido, se não houver `posted`) e termina na entrega ou em `clock.now()`. `delayed` é `transitHours > limite`, com o limite exato ainda sem atraso. O limite vem de `DELAY_LIMIT_HOURS` e pode ser sobrescrito por remessa com `delayLimitHours`. `/alerts/delays` lista só as remessas não entregues. As entregues fora do prazo continuam com `delayed: true` na consulta individual.
- **Relógio controlável.** Todo cálculo de tempo usa `Clock`. Os testes usam `FixedClock` (`set`, `advanceHours`) para cobrir a fronteira exata do limite.
- **Concorrência.** As consultas ao agregador rodam em paralelo, mas a etapa ler-mesclar-salvar é serializada por código. Assim, refreshes simultâneos não perdem nem duplicam eventos.
- **`status: null`** significa "ainda sem evento reconhecido" (recém-registrado, ou só com status desconhecidos). Preferi isso a criar um sexto status fora do enunciado.

## O que ficou de fora

- Cliente HTTP real de agregador, com retry, backoff e rate limit. Só existe o fake.
- Persistência: o repositório é em memória (`ShipmentRepository` é a interface para trocar por um banco).
- Polling ou webhooks do agregador. A sincronização acontece sob demanda, no `GET`.
- Notificação ativa do alerta (e-mail, fila). O alerta é consultável em `/alerts/delays`.
- Autenticação, paginação e métricas.
- Tabelas de status completas das transportadoras. Mapeei um subconjunto representativo, e o resto cai em `status: null` de propósito.

## Testes

`npm test` roda 68 testes: mapeamento por transportadora, regras de status, propriedades com fast-check, normalização do payload de exemplo, alerta de atraso com relógio fixo, deduplicação em consultas repetidas, falhas do agregador e refreshes concorrentes.

## Uso de IA

O código foi gerado com assistência de IA (Claude Code). O que a IA fez:

- estrutura do projeto (TypeScript estrito, Fastify, zod, Vitest);
- interface do agregador, cliente fake e payloads de exemplo;
- normalização por transportadora, regras de status sem regressão, deduplicação do histórico e cálculo de atraso com relógio injetável;
- rotas da API e tratamento de erros;
- suíte de testes, incluindo os testes de propriedade;
- este README.

Revisao humana: [Rodrigo completa]
