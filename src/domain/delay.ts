import type { TrackingEvent } from "./normalize.js";
import type { NormalizedStatus } from "./status.js";

export interface DelayEvaluation {
  readonly limitHours: number;
  readonly startedAt: string | null;
  readonly transitHours: number | null;
  readonly delayed: boolean;
}

const HOUR_MS = 3_600_000;

export function evaluateDelay(input: {
  readonly history: readonly TrackingEvent[];
  readonly status: NormalizedStatus | null;
  readonly now: Date;
  readonly limitHours: number;
}): DelayEvaluation {
  const { history, status, now, limitHours } = input;
  const recognized = history.filter((event) => event.status !== null);
  const startedAt =
    recognized.find((event) => event.status === "posted")?.occurredAt ?? recognized[0]?.occurredAt ?? null;
  if (startedAt === null) return { limitHours, startedAt: null, transitHours: null, delayed: false };

  const deliveredAt = status === "delivered" ? recognized.find((e) => e.status === "delivered")?.occurredAt : undefined;
  const endMs = deliveredAt ? Date.parse(deliveredAt) : now.getTime();
  const transitHours = Math.max(0, (endMs - Date.parse(startedAt)) / HOUR_MS);

  return {
    limitHours,
    startedAt,
    transitHours: Math.round(transitHours * 100) / 100,
    delayed: transitHours > limitHours,
  };
}
