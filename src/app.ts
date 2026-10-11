import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import { AggregatorUnavailableError } from "./aggregator/types.js";
import { InvalidAggregatorPayloadError } from "./domain/normalize.js";
import { ShipmentNotFoundError, type TrackingService } from "./service.js";

const codeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{8,40}$/, "code must be 8-40 alphanumeric characters");

const registerBodySchema = z.object({
  code: codeSchema,
  delayLimitHours: z.number().positive().max(24 * 365).optional(),
});

const codeParamsSchema = z.object({ code: codeSchema });

const getQuerySchema = z.object({
  refresh: z.enum(["true", "false"]).default("true"),
});

export function buildApp(service: TrackingService, options: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) {
      return reply.status(400).send({
        error: "validation_error",
        issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      });
    }
    if (error instanceof ShipmentNotFoundError) {
      return reply.status(404).send({ error: "not_found", message: error.message });
    }
    if (error instanceof AggregatorUnavailableError || error instanceof InvalidAggregatorPayloadError) {
      return reply.status(502).send({ error: "aggregator_error", message: error.message });
    }
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      return reply.status(statusCode).send({ error: "bad_request", message: (error as Error).message });
    }
    app.log.error(error);
    return reply.status(500).send({ error: "internal_error" });
  });

  app.get("/health", async () => ({ status: "ok" }));

  app.post("/trackings", async (request, reply) => {
    const body = registerBodySchema.parse(request.body ?? {});
    const { view, created } = await service.register(
      body.code,
      body.delayLimitHours === undefined ? {} : { delayLimitHours: body.delayLimitHours },
    );
    return reply.status(created ? 201 : 200).send(view);
  });

  app.get("/trackings/:code", async (request) => {
    const { code } = codeParamsSchema.parse(request.params);
    const { refresh } = getQuerySchema.parse(request.query);
    if (refresh === "false") return service.get(code);
    const result = await service.refresh(code);
    return { ...result.view, sync: { addedEvents: result.addedEvents, discardedEvents: result.discardedEvents } };
  });

  app.get("/alerts/delays", async () => ({ items: await service.listDelayed() }));

  return app;
}
