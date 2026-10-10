import type { AggregatorClient } from "./aggregator/types.js";
import type { Clock } from "./clock.js";
import { evaluateDelay, type DelayEvaluation } from "./domain/delay.js";
import { mergeHistory } from "./domain/history.js";
import { InvalidAggregatorPayloadError, normalizePayload } from "./domain/normalize.js";
import { deriveStatus, type NormalizedStatus } from "./domain/status.js";
import type { Shipment, ShipmentRepository } from "./repository.js";

export interface TrackingEventView {
  readonly occurredAt: string;
  readonly status: NormalizedStatus | null;
  readonly rawStatus: string;
  readonly description: string | null;
  readonly location: string | null;
}

export interface TrackingView {
  readonly code: string;
  readonly carrier: string | null;
  readonly status: NormalizedStatus | null;
  readonly registeredAt: string;
  readonly lastSyncedAt: string | null;
  readonly delay: DelayEvaluation;
  readonly history: readonly TrackingEventView[];
}

export interface RefreshResult {
  readonly view: TrackingView;
  readonly addedEvents: number;
  readonly discardedEvents: number;
}

export class ShipmentNotFoundError extends Error {
  constructor(readonly code: string) {
    super(`Tracking code ${code} is not registered`);
    this.name = "ShipmentNotFoundError";
  }
}

export interface TrackingServiceDeps {
  readonly aggregator: AggregatorClient;
  readonly repository: ShipmentRepository;
  readonly clock: Clock;
  readonly defaultDelayLimitHours: number;
}

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

export class TrackingService {
  readonly #deps: TrackingServiceDeps;
  readonly #locks = new Map<string, Promise<unknown>>();

  constructor(deps: TrackingServiceDeps) {
    this.#deps = deps;
  }

  async register(rawCode: string, options: { delayLimitHours?: number } = {}): Promise<{ view: TrackingView; created: boolean }> {
    const code = normalizeCode(rawCode);
    return this.#withLock(code, async () => {
      const existing = await this.#deps.repository.get(code);
      if (existing) return { view: this.#toView(existing), created: false };
      const shipment: Shipment = {
        code,
        carrier: null,
        registeredAt: this.#deps.clock.now().toISOString(),
        lastSyncedAt: null,
        delayLimitHours: options.delayLimitHours ?? null,
        status: null,
        history: [],
      };
      await this.#deps.repository.save(shipment);
      return { view: this.#toView(shipment), created: true };
    });
  }

  async get(rawCode: string): Promise<TrackingView> {
    return this.#toView(await this.#require(normalizeCode(rawCode)));
  }

  async refresh(rawCode: string): Promise<RefreshResult> {
    const code = normalizeCode(rawCode);
    await this.#require(code);
    const raw = await this.#deps.aggregator.fetchTracking(code);
    const normalized = raw === null ? null : normalizePayload(raw);
    if (normalized && normalized.code !== code) {
      throw new InvalidAggregatorPayloadError(`expected tracking_code ${code}, got ${normalized.code}`);
    }

    return this.#withLock(code, async () => {
      const current = await this.#require(code);
      const { history, added } = mergeHistory(current.history, normalized?.events ?? []);
      const updated: Shipment = {
        ...current,
        carrier: normalized?.carrier ?? current.carrier,
        lastSyncedAt: this.#deps.clock.now().toISOString(),
        status: deriveStatus(history),
        history,
      };
      await this.#deps.repository.save(updated);
      return { view: this.#toView(updated), addedEvents: added, discardedEvents: normalized?.discardedEvents ?? 0 };
    });
  }

  async listDelayed(): Promise<readonly TrackingView[]> {
    const shipments = await this.#deps.repository.list();
    return shipments
      .map((shipment) => this.#toView(shipment))
      .filter((view) => view.delay.delayed && view.status !== "delivered");
  }

  async #require(code: string): Promise<Shipment> {
    const shipment = await this.#deps.repository.get(code);
    if (!shipment) throw new ShipmentNotFoundError(code);
    return shipment;
  }

  #toView(shipment: Shipment): TrackingView {
    return {
      code: shipment.code,
      carrier: shipment.carrier,
      status: shipment.status,
      registeredAt: shipment.registeredAt,
      lastSyncedAt: shipment.lastSyncedAt,
      delay: evaluateDelay({
        history: shipment.history,
        status: shipment.status,
        now: this.#deps.clock.now(),
        limitHours: shipment.delayLimitHours ?? this.#deps.defaultDelayLimitHours,
      }),
      history: shipment.history.map(({ key: _key, ...event }) => event),
    };
  }

  async #withLock<T>(code: string, task: () => Promise<T>): Promise<T> {
    const previous = this.#locks.get(code) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(task);
    this.#locks.set(code, run);
    try {
      return await run;
    } finally {
      if (this.#locks.get(code) === run) this.#locks.delete(code);
    }
  }
}
