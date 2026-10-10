import { describe, expect, it } from "vitest";
import { loadExample, payload, setup } from "./helpers.js";

const CODE = "AB123456789BR";

describe("POST /trackings", () => {
  it("registers a code once and is idempotent afterwards", async () => {
    const { app, clock } = setup();
    const first = await app.inject({ method: "POST", url: "/trackings", payload: { code: " ab123456789br " } });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ code: CODE, status: null, history: [], registeredAt: "2026-10-02T12:00:00.000Z" });

    clock.advanceHours(1);
    const second = await app.inject({ method: "POST", url: "/trackings", payload: { code: CODE } });
    expect(second.statusCode).toBe(200);
    expect(second.json().registeredAt).toBe("2026-10-02T12:00:00.000Z");
  });

  it.each([{}, { code: "short" }, { code: "AB-123/456" }, { code: CODE, delayLimitHours: -1 }])(
    "rejects invalid body %j",
    async (body) => {
      const { app } = setup();
      const response = await app.inject({ method: "POST", url: "/trackings", payload: body });
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe("validation_error");
    },
  );
});

describe("GET /trackings/:code", () => {
  it("returns 404 for codes that were not registered", async () => {
    const { app, aggregator } = setup();
    const response = await app.inject({ method: "GET", url: `/trackings/${CODE}` });
    expect(response.statusCode).toBe(404);
    expect(aggregator.calls).toBe(0);
  });

  it("returns the documented normalized example for the documented raw payload", async () => {
    const { app, aggregator } = setup({ now: "2026-10-04T15:00:00Z", delayLimitHours: 120 });
    aggregator.setPayload("QB123456789BR", loadExample("raw-payload.json"));
    await app.inject({ method: "POST", url: "/trackings", payload: { code: "QB123456789BR" } });
    const response = await app.inject({ method: "GET", url: "/trackings/QB123456789BR" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(loadExample("normalized.json"));
  });

  it("keeps an empty history while the aggregator does not know the code yet", async () => {
    const { app } = setup();
    await app.inject({ method: "POST", url: "/trackings", payload: { code: CODE } });
    const response = await app.inject({ method: "GET", url: `/trackings/${CODE}` });
    expect(response.json()).toMatchObject({ status: null, history: [], lastSyncedAt: "2026-10-02T12:00:00.000Z" });
  });

  it("re-querying does not duplicate history", async () => {
    const { app, aggregator } = setup();
    aggregator.setPayload(
      CODE,
      payload(CODE, "correios", [
        { id: "1", status: "PO", at: "2026-10-01T09:00:00-03:00" },
        { status: "RO", at: "2026-10-02T09:00:00-03:00", city: "Cajamar" },
      ]),
    );
    await app.inject({ method: "POST", url: "/trackings", payload: { code: CODE } });

    const first = (await app.inject({ method: "GET", url: `/trackings/${CODE}` })).json();
    const second = (await app.inject({ method: "GET", url: `/trackings/${CODE}` })).json();
    const third = (await app.inject({ method: "GET", url: `/trackings/${CODE}` })).json();

    expect(first.history).toHaveLength(2);
    expect(first.sync.addedEvents).toBe(2);
    expect(second.history).toEqual(first.history);
    expect(third.history).toEqual(first.history);
    expect(third.sync.addedEvents).toBe(0);
    expect(aggregator.calls).toBe(3);
  });

  it("appends only new events when the aggregator returns the full history again", async () => {
    const { app, aggregator } = setup();
    const events = [
      { id: "1", status: "PO", at: "2026-10-01T09:00:00Z" },
      { id: "2", status: "RO", at: "2026-10-02T09:00:00Z" },
    ];
    aggregator.setPayload(CODE, payload(CODE, "correios", events));
    await app.inject({ method: "POST", url: "/trackings", payload: { code: CODE } });
    await app.inject({ method: "GET", url: `/trackings/${CODE}` });

    aggregator.setPayload(CODE, payload(CODE, "correios", [...events, { id: "3", status: "OEC", at: "2026-10-03T09:00:00Z" }]));
    const view = (await app.inject({ method: "GET", url: `/trackings/${CODE}` })).json();
    expect(view.sync.addedEvents).toBe(1);
    expect(view.history.map((e: { rawStatus: string }) => e.rawStatus)).toEqual(["PO", "RO", "OEC"]);
    expect(view.status).toBe("out_for_delivery");
  });

  it("does not regress when older or repeated events arrive in later queries", async () => {
    const { app, aggregator } = setup();
    await app.inject({ method: "POST", url: "/trackings", payload: { code: CODE } });

    aggregator.setPayload(CODE, payload(CODE, "jadlog", [{ id: "3", status: "EM ROTA", at: "2026-10-03T08:00:00Z" }]));
    expect((await app.inject({ method: "GET", url: `/trackings/${CODE}` })).json().status).toBe("out_for_delivery");

    aggregator.setPayload(
      CODE,
      payload(CODE, "jadlog", [
        { id: "2", status: "TRANSFERENCIA", at: "2026-10-02T08:00:00Z" },
        { id: "1", status: "EMISSAO", at: "2026-10-01T08:00:00Z" },
        { id: "3", status: "EM ROTA", at: "2026-10-03T08:00:00Z" },
        { id: "4", status: "TRANSFERENCIA", at: "2026-10-03T12:00:00Z" },
      ]),
    );
    const view = (await app.inject({ method: "GET", url: `/trackings/${CODE}` })).json();
    expect(view.status).toBe("out_for_delivery");
    expect(view.history.map((e: { rawStatus: string }) => e.rawStatus)).toEqual([
      "EMISSAO",
      "TRANSFERENCIA",
      "EM ROTA",
      "TRANSFERENCIA",
    ]);
  });

  it("keeps delivered even if the aggregator stops returning the delivery event", async () => {
    const { app, aggregator } = setup();
    await app.inject({ method: "POST", url: "/trackings", payload: { code: CODE } });
    aggregator.setPayload(CODE, payload(CODE, "loggi", [{ id: "d", status: "delivered", at: "2026-10-03T08:00:00Z" }]));
    await app.inject({ method: "GET", url: `/trackings/${CODE}` });

    aggregator.setPayload(CODE, payload(CODE, "loggi", [{ id: "x", status: "in_transit", at: "2026-10-04T08:00:00Z" }]));
    expect((await app.inject({ method: "GET", url: `/trackings/${CODE}` })).json().status).toBe("delivered");
  });

  it("never marks unknown carrier statuses as delivered", async () => {
    const { app, aggregator } = setup();
    aggregator.setPayload("JD000123456789", loadExample("raw-payload-jadlog.json"));
    await app.inject({ method: "POST", url: "/trackings", payload: { code: "JD000123456789" } });
    const view = (await app.inject({ method: "GET", url: "/trackings/JD000123456789" })).json();
    expect(view.status).toBe("in_transit");
    expect(view.history.at(-1)).toMatchObject({ rawStatus: "NAO ENTREGUE - ENDERECO INCORRETO", status: null });
  });

  it("never marks anything as delivered for an unsupported carrier", async () => {
    const { app, aggregator } = setup();
    aggregator.setPayload(CODE, payload(CODE, "transportadora-x", [{ status: "DELIVERED", at: "2026-10-01T08:00:00Z" }]));
    await app.inject({ method: "POST", url: "/trackings", payload: { code: CODE } });
    const view = (await app.inject({ method: "GET", url: `/trackings/${CODE}` })).json();
    expect(view).toMatchObject({ carrier: "transportadora-x", status: null });
    expect(view.history).toHaveLength(1);
  });

  it("returns 502 and preserves stored history when the aggregator fails", async () => {
    const { app, aggregator } = setup();
    aggregator.setPayload(CODE, payload(CODE, "correios", [{ id: "1", status: "PO", at: "2026-10-01T08:00:00Z" }]));
    await app.inject({ method: "POST", url: "/trackings", payload: { code: CODE } });
    await app.inject({ method: "GET", url: `/trackings/${CODE}` });

    aggregator.failNext();
    const failed = await app.inject({ method: "GET", url: `/trackings/${CODE}` });
    expect(failed.statusCode).toBe(502);
    expect(failed.json().error).toBe("aggregator_error");

    const cached = (await app.inject({ method: "GET", url: `/trackings/${CODE}?refresh=false` })).json();
    expect(cached).toMatchObject({ status: "posted" });
    expect(cached.history).toHaveLength(1);
  });

  it("returns 502 when the aggregator answers for a different code", async () => {
    const { app, aggregator } = setup();
    aggregator.setPayload(CODE, payload("ZZ999999999BR", "correios", [{ status: "BDE", at: "2026-10-01T08:00:00Z" }]));
    await app.inject({ method: "POST", url: "/trackings", payload: { code: CODE } });
    const response = await app.inject({ method: "GET", url: `/trackings/${CODE}` });
    expect(response.statusCode).toBe(502);
    expect((await app.inject({ method: "GET", url: `/trackings/${CODE}?refresh=false` })).json().status).toBeNull();
  });

  it("returns 502 for a malformed aggregator payload", async () => {
    const { app, aggregator } = setup();
    aggregator.setPayload(CODE, { unexpected: true });
    await app.inject({ method: "POST", url: "/trackings", payload: { code: CODE } });
    expect((await app.inject({ method: "GET", url: `/trackings/${CODE}` })).statusCode).toBe(502);
  });

  it("serves the stored view without calling the aggregator when refresh=false", async () => {
    const { app, aggregator } = setup();
    await app.inject({ method: "POST", url: "/trackings", payload: { code: CODE } });
    const response = await app.inject({ method: "GET", url: `/trackings/${CODE}?refresh=false` });
    expect(response.statusCode).toBe(200);
    expect(aggregator.calls).toBe(0);
  });

  it("does not lose or duplicate events under concurrent refreshes", async () => {
    const { app, aggregator, service } = setup();
    aggregator.setPayload(
      CODE,
      payload(CODE, "correios", [
        { id: "1", status: "PO", at: "2026-10-01T08:00:00Z" },
        { id: "2", status: "RO", at: "2026-10-02T08:00:00Z" },
      ]),
    );
    await app.inject({ method: "POST", url: "/trackings", payload: { code: CODE } });
    await Promise.all(Array.from({ length: 10 }, () => service.refresh(CODE)));
    const view = await service.get(CODE);
    expect(view.history).toHaveLength(2);
    expect(view.status).toBe("in_transit");
  });
});

describe("GET /health", () => {
  it("responds ok", async () => {
    const { app } = setup();
    expect((await app.inject({ method: "GET", url: "/health" })).json()).toEqual({ status: "ok" });
  });
});
