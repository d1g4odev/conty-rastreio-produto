import { AggregatorUnavailableError, type AggregatorClient } from "./types.js";

export class FakeAggregatorClient implements AggregatorClient {
  readonly #payloads = new Map<string, unknown>();
  #pendingFailures = 0;
  calls = 0;

  setPayload(code: string, payload: unknown): void {
    this.#payloads.set(code.toUpperCase(), structuredClone(payload));
  }

  failNext(times = 1): void {
    this.#pendingFailures += times;
  }

  async fetchTracking(code: string): Promise<unknown | null> {
    this.calls += 1;
    if (this.#pendingFailures > 0) {
      this.#pendingFailures -= 1;
      throw new AggregatorUnavailableError("Fake aggregator is unavailable");
    }
    const payload = this.#payloads.get(code.toUpperCase());
    return payload === undefined ? null : structuredClone(payload);
  }
}
