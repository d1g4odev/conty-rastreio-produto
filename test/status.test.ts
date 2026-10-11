import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { mergeHistory } from "../src/domain/history.js";
import type { TrackingEvent } from "../src/domain/normalize.js";
import { NORMALIZED_STATUSES, deriveStatus, progressRank, type NormalizedStatus } from "../src/domain/status.js";

function event(status: NormalizedStatus | null, occurredAt: string, key = `${status}-${occurredAt}`): TrackingEvent {
  return { key, occurredAt, status, rawStatus: String(status), description: null, location: null };
}

describe("deriveStatus", () => {
  it("is null when there are no recognized events", () => {
    expect(deriveStatus([])).toBeNull();
    expect(deriveStatus([event(null, "2026-10-01T00:00:00.000Z")])).toBeNull();
  });

  it("uses the furthest progress status, not the last one received", () => {
    const events = [
      event("out_for_delivery", "2026-10-03T00:00:00.000Z"),
      event("in_transit", "2026-10-02T00:00:00.000Z"),
      event("posted", "2026-10-01T00:00:00.000Z"),
    ];
    expect(deriveStatus(events)).toBe("out_for_delivery");
  });

  it("does not regress when a late in_transit event happens after out_for_delivery", () => {
    const events = [
      event("out_for_delivery", "2026-10-03T00:00:00.000Z"),
      event("in_transit", "2026-10-04T00:00:00.000Z"),
    ];
    expect(deriveStatus(events)).toBe("out_for_delivery");
  });

  it("treats delivered as terminal even if later events arrive", () => {
    const events = [
      event("delivered", "2026-10-03T00:00:00.000Z"),
      event("exception", "2026-10-05T00:00:00.000Z"),
      event("in_transit", "2026-10-06T00:00:00.000Z"),
    ];
    expect(deriveStatus(events)).toBe("delivered");
  });

  it("reports exception while it is the chronologically latest recognized event", () => {
    const events = [
      event("out_for_delivery", "2026-10-03T00:00:00.000Z"),
      event("exception", "2026-10-03T06:00:00.000Z"),
      event(null, "2026-10-03T07:00:00.000Z"),
    ];
    expect(deriveStatus(events)).toBe("exception");
  });

  it("leaves exception once the carrier resumes, without dropping below the furthest progress", () => {
    const events = [
      event("out_for_delivery", "2026-10-03T00:00:00.000Z"),
      event("exception", "2026-10-03T06:00:00.000Z"),
      event("in_transit", "2026-10-04T00:00:00.000Z"),
    ];
    expect(deriveStatus(events)).toBe("out_for_delivery");
  });

  it("ignores an exception that arrives late but happened before newer progress", () => {
    const events = [
      event("in_transit", "2026-10-04T00:00:00.000Z"),
      event("exception", "2026-10-02T00:00:00.000Z"),
    ];
    expect(deriveStatus(events)).toBe("in_transit");
  });
});

const statusArb = fc.constantFrom<NormalizedStatus | null>(...NORMALIZED_STATUSES, null);
const eventsArb = fc.uniqueArray(
  fc.record({
    status: statusArb,
    minute: fc.integer({ min: 0, max: 10_000 }),
  }),
  { minLength: 1, maxLength: 25, selector: (e) => e.minute },
).map((items) =>
  items.map((item, index) =>
    event(item.status, new Date(Date.UTC(2026, 9, 1) + item.minute * 60_000).toISOString(), `k${index}`),
  ),
);

const eventsWithPermutationArb = eventsArb.chain((events) =>
  fc.tuple(fc.constant(events), fc.shuffledSubarray(events, { minLength: events.length, maxLength: events.length })),
);

describe("status properties over arbitrary delivery orders", () => {
  it("final status does not depend on arrival order, batching or duplicates", () => {
    fc.assert(
      fc.property(eventsWithPermutationArb, fc.integer({ min: 1, max: 5 }), ([events, shuffled], batchSize) => {
        const withDuplicates = [...shuffled, ...shuffled.slice(0, Math.ceil(shuffled.length / 2))];
        let history: readonly TrackingEvent[] = [];
        for (let i = 0; i < withDuplicates.length; i += batchSize) {
          history = mergeHistory(history, withDuplicates.slice(i, i + batchSize)).history;
        }
        expect(history).toHaveLength(events.length);
        expect(deriveStatus(history)).toBe(deriveStatus(mergeHistory([], events).history));
      }),
    );
  });

  it("progress never goes backwards as events accumulate in any order", () => {
    fc.assert(
      fc.property(eventsArb, (events) => {
        let history: readonly TrackingEvent[] = [];
        let furthest = -1;
        for (const incoming of events) {
          history = mergeHistory(history, [incoming]).history;
          const status = deriveStatus(history);
          const rank = progressRank(status);
          if (status !== "exception") {
            expect(rank).toBeGreaterThanOrEqual(furthest);
            furthest = Math.max(furthest, rank);
          }
          if (furthest === progressRank("delivered")) expect(status).toBe("delivered");
        }
      }),
    );
  });

  it("is never delivered unless a recognized delivered event exists", () => {
    fc.assert(
      fc.property(eventsArb, (events) => {
        const delivered = deriveStatus(events) === "delivered";
        expect(delivered).toBe(events.some((e) => e.status === "delivered"));
      }),
    );
  });
});
