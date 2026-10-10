import { readFileSync } from "node:fs";
import { FakeAggregatorClient } from "../src/aggregator/fake.js";
import { buildApp } from "../src/app.js";
import { FixedClock } from "../src/clock.js";
import { InMemoryShipmentRepository } from "../src/repository.js";
import { TrackingService } from "../src/service.js";

export function loadExample(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../examples/${name}`, import.meta.url), "utf8"));
}

export function setup(options: { now?: string; delayLimitHours?: number } = {}) {
  const clock = new FixedClock(options.now ?? "2026-10-02T12:00:00Z");
  const aggregator = new FakeAggregatorClient();
  const repository = new InMemoryShipmentRepository();
  const service = new TrackingService({
    aggregator,
    repository,
    clock,
    defaultDelayLimitHours: options.delayLimitHours ?? 72,
  });
  const app = buildApp(service);
  return { clock, aggregator, repository, service, app };
}

export interface EventInput {
  id?: string;
  status: string;
  at: string;
  city?: string;
}

export function payload(code: string, carrier: string, events: EventInput[]) {
  return {
    tracking_code: code,
    carrier: { slug: carrier },
    events: events.map((event) => ({
      ...(event.id ? { id: event.id } : {}),
      status: event.status,
      description: `evento ${event.status}`,
      occurred_at: event.at,
      ...(event.city ? { location: { city: event.city } } : {}),
    })),
  };
}
