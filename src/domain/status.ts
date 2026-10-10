export const NORMALIZED_STATUSES = [
  "posted",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "exception",
] as const;

export type NormalizedStatus = (typeof NORMALIZED_STATUSES)[number];

type ProgressStatus = Exclude<NormalizedStatus, "exception">;

const PROGRESS_RANK: Record<ProgressStatus, number> = {
  posted: 0,
  in_transit: 1,
  out_for_delivery: 2,
  delivered: 3,
};

export interface StatusBearingEvent {
  readonly occurredAt: string;
  readonly status: NormalizedStatus | null;
}

export function deriveStatus(events: readonly StatusBearingEvent[]): NormalizedStatus | null {
  const recognized = events.filter(
    (event): event is StatusBearingEvent & { status: NormalizedStatus } => event.status !== null,
  );
  if (recognized.length === 0) return null;
  if (recognized.some((event) => event.status === "delivered")) return "delivered";

  const latestAt = recognized.reduce((max, event) => (event.occurredAt > max ? event.occurredAt : max), "");
  if (recognized.some((event) => event.occurredAt === latestAt && event.status === "exception")) {
    return "exception";
  }

  let best: ProgressStatus | null = null;
  for (const event of recognized) {
    if (event.status === "exception") continue;
    if (best === null || PROGRESS_RANK[event.status] > PROGRESS_RANK[best]) best = event.status;
  }
  return best ?? "exception";
}

export function progressRank(status: NormalizedStatus | null): number {
  if (status === null || status === "exception") return -1;
  return PROGRESS_RANK[status];
}
