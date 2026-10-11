import { describe, expect, it } from "vitest";
import { InvalidAggregatorPayloadError, normalizePayload } from "../src/domain/normalize.js";
import { loadExample, payload } from "./helpers.js";

describe("normalizePayload", () => {
  it("normalizes the documented raw payload example", () => {
    const result = normalizePayload(loadExample("raw-payload.json"));
    expect(result.code).toBe("QB123456789BR");
    expect(result.carrier).toBe("correios");
    expect(result.discardedEvents).toBe(1);
    expect(result.events.map((e) => [e.rawStatus, e.status])).toEqual([
      ["OEC", "out_for_delivery"],
      ["PO", "posted"],
      ["RO", "in_transit"],
      ["RO", "in_transit"],
      ["RO", "in_transit"],
      ["XLD", null],
    ]);
  });

  it("converts timestamps with offsets to UTC so the same instant gets the same key", () => {
    const a = normalizePayload(payload("AB12345678", "correios", [{ status: "RO", at: "2026-10-02T22:40:00-03:00" }]));
    const b = normalizePayload(payload("AB12345678", "correios", [{ status: "ro", at: "2026-10-03T01:40:00Z" }]));
    expect(a.events[0]?.occurredAt).toBe("2026-10-03T01:40:00.000Z");
    expect(a.events[0]?.key).toBe(b.events[0]?.key);
  });

  it("prefers the aggregator event id as identity", () => {
    const result = normalizePayload(payload("AB12345678", "correios", [{ id: "e1", status: "PO", at: "2026-10-01T00:00:00Z" }]));
    expect(result.events[0]?.key).toBe("id:e1");
  });

  it("keeps unknown carrier statuses in history without a normalized status", () => {
    const result = normalizePayload(loadExample("raw-payload-jadlog.json"));
    expect(result.events.at(-1)).toMatchObject({ rawStatus: "NAO ENTREGUE - ENDERECO INCORRETO", status: null });
  });

  it("discards malformed events instead of trusting them", () => {
    const result = normalizePayload({
      tracking_code: "AB12345678",
      carrier: { slug: "correios" },
      events: [{ status: "BDE" }, { status: "BDE", occurred_at: "ontem" }, null, { status: "PO", occurred_at: "2026-10-01T00:00:00Z" }],
    });
    expect(result.discardedEvents).toBe(3);
    expect(result.events.map((e) => e.status)).toEqual(["posted"]);
  });

  it("rejects payloads without the required envelope", () => {
    expect(() => normalizePayload({ events: [] })).toThrow(InvalidAggregatorPayloadError);
  });
});
