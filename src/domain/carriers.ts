import type { NormalizedStatus } from "./status.js";

const CARRIER_STATUS_TABLES: Readonly<Record<string, Readonly<Record<string, NormalizedStatus>>>> = {
  correios: {
    PO: "posted",
    RO: "in_transit",
    DO: "in_transit",
    PAR: "in_transit",
    OEC: "out_for_delivery",
    BDE: "delivered",
    BDI: "exception",
    BDR: "exception",
    FC: "exception",
  },
  jadlog: {
    EMISSAO: "posted",
    COLETADO: "posted",
    TRANSFERENCIA: "in_transit",
    "EM ROTA": "out_for_delivery",
    ENTREGUE: "delivered",
    "AGUARDANDO RETIRADA": "exception",
    DEVOLUCAO: "exception",
    AVARIA: "exception",
  },
  loggi: {
    created: "posted",
    picked_up: "posted",
    in_transit: "in_transit",
    out_for_delivery: "out_for_delivery",
    delivered: "delivered",
    delivery_failed: "exception",
    lost: "exception",
  },
};

const CARRIER_STATUS_MAP: ReadonlyMap<string, ReadonlyMap<string, NormalizedStatus>> = new Map(
  Object.entries(CARRIER_STATUS_TABLES).map(([carrier, table]) => [
    carrier,
    new Map(Object.entries(table).map(([raw, status]) => [canonical(raw), status])),
  ]),
);

export const SUPPORTED_CARRIERS: readonly string[] = [...CARRIER_STATUS_MAP.keys()];

function canonical(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

export function normalizeCarrierStatus(carrier: string, rawStatus: string): NormalizedStatus | null {
  return CARRIER_STATUS_MAP.get(carrier.trim().toLowerCase())?.get(canonical(rawStatus)) ?? null;
}
