import { rawEventSchema, rawPayloadSchema, type RawEvent } from "../aggregator/types.js";
import { normalizeCarrierStatus } from "./carriers.js";
import type { NormalizedStatus } from "./status.js";

export interface TrackingEvent {
  readonly key: string;
  readonly occurredAt: string;
  readonly status: NormalizedStatus | null;
  readonly rawStatus: string;
  readonly description: string | null;
  readonly location: string | null;
}

export interface NormalizedPayload {
  readonly code: string;
  readonly carrier: string;
  readonly events: readonly TrackingEvent[];
  readonly discardedEvents: number;
}

export class InvalidAggregatorPayloadError extends Error {
  constructor(readonly issues: string) {
    super(`Invalid aggregator payload: ${issues}`);
    this.name = "InvalidAggregatorPayloadError";
  }
}

export function normalizePayload(raw: unknown): NormalizedPayload {
  const parsed = rawPayloadSchema.safeParse(raw);
  if (!parsed.success) throw new InvalidAggregatorPayloadError(parsed.error.message);

  const carrier = parsed.data.carrier.slug.trim().toLowerCase();
  const events: TrackingEvent[] = [];
  let discardedEvents = 0;

  for (const candidate of parsed.data.events) {
    const event = rawEventSchema.safeParse(candidate);
    if (!event.success) {
      discardedEvents += 1;
      continue;
    }
    events.push(toTrackingEvent(carrier, event.data));
  }

  return { code: parsed.data.tracking_code.trim().toUpperCase(), carrier, events, discardedEvents };
}

function toTrackingEvent(carrier: string, event: RawEvent): TrackingEvent {
  const occurredAt = new Date(event.occurred_at).toISOString();
  const rawStatus = event.status.trim();
  const location = formatLocation(event.location);
  return {
    key: event.id ? `id:${event.id}` : `fp:${rawStatus.toUpperCase()}|${occurredAt}|${location ?? ""}`,
    occurredAt,
    status: normalizeCarrierStatus(carrier, rawStatus),
    rawStatus,
    description: event.description?.trim() || null,
    location,
  };
}

function formatLocation(location: RawEvent["location"]): string | null {
  const parts = [location?.city?.trim(), location?.state?.trim()].filter((part): part is string => !!part);
  return parts.length > 0 ? parts.join(" - ") : null;
}
