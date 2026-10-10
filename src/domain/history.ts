import type { TrackingEvent } from "./normalize.js";

export interface MergeResult {
  readonly history: readonly TrackingEvent[];
  readonly added: number;
}

export function mergeHistory(existing: readonly TrackingEvent[], incoming: readonly TrackingEvent[]): MergeResult {
  const byKey = new Map(existing.map((event) => [event.key, event]));
  let added = 0;
  for (const event of incoming) {
    if (byKey.has(event.key)) continue;
    byKey.set(event.key, event);
    added += 1;
  }
  const history = [...byKey.values()].sort(
    (a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.key.localeCompare(b.key),
  );
  return { history, added };
}
