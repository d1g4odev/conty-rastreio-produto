import type { TrackingEvent } from "./domain/normalize.js";
import type { NormalizedStatus } from "./domain/status.js";

export interface Shipment {
  readonly code: string;
  readonly carrier: string | null;
  readonly registeredAt: string;
  readonly lastSyncedAt: string | null;
  readonly delayLimitHours: number | null;
  readonly status: NormalizedStatus | null;
  readonly history: readonly TrackingEvent[];
}

export interface ShipmentRepository {
  get(code: string): Promise<Shipment | undefined>;
  save(shipment: Shipment): Promise<void>;
  list(): Promise<readonly Shipment[]>;
}

export class InMemoryShipmentRepository implements ShipmentRepository {
  readonly #items = new Map<string, Shipment>();

  async get(code: string): Promise<Shipment | undefined> {
    return this.#items.get(code);
  }

  async save(shipment: Shipment): Promise<void> {
    this.#items.set(shipment.code, shipment);
  }

  async list(): Promise<readonly Shipment[]> {
    return [...this.#items.values()];
  }
}
