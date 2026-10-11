import { readFile } from "node:fs/promises";
import { FakeAggregatorClient } from "./aggregator/fake.js";
import { buildApp } from "./app.js";
import { systemClock } from "./clock.js";
import { loadConfig } from "./config.js";
import { InMemoryShipmentRepository } from "./repository.js";
import { TrackingService } from "./service.js";

const SEED_FILES = ["raw-payload.json", "raw-payload-jadlog.json"];

const config = loadConfig();
const aggregator = new FakeAggregatorClient();

for (const file of SEED_FILES) {
  const payload = JSON.parse(await readFile(new URL(`../examples/${file}`, import.meta.url), "utf8")) as {
    tracking_code: string;
  };
  aggregator.setPayload(payload.tracking_code, payload);
}

const service = new TrackingService({
  aggregator,
  repository: new InMemoryShipmentRepository(),
  clock: systemClock,
  defaultDelayLimitHours: config.DELAY_LIMIT_HOURS,
});

const app = buildApp(service, { logger: true });
await app.listen({ port: config.PORT, host: config.HOST });
