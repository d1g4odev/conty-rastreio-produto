import { z } from "zod";

export const rawEventSchema = z.object({
  id: z.string().min(1).optional(),
  status: z.string().min(1),
  description: z.string().optional(),
  occurred_at: z.iso.datetime({ offset: true }),
  location: z
    .object({
      city: z.string().optional(),
      state: z.string().optional(),
    })
    .optional(),
});

export const rawPayloadSchema = z.object({
  tracking_code: z.string().min(1),
  carrier: z.object({
    slug: z.string().min(1),
    name: z.string().optional(),
  }),
  events: z.array(z.unknown()),
});

export type RawEvent = z.infer<typeof rawEventSchema>;
export type RawPayload = z.infer<typeof rawPayloadSchema>;

export interface AggregatorClient {
  fetchTracking(code: string): Promise<unknown | null>;
}

export class AggregatorUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AggregatorUnavailableError";
  }
}
