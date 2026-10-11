import { describe, expect, it } from "vitest";
import { payload, setup } from "./helpers.js";

const CODE = "AB123456789BR";

async function registerAndSync(ctx: ReturnType<typeof setup>, body: Record<string, unknown> = { code: CODE }) {
  await ctx.app.inject({ method: "POST", url: "/trackings", payload: body });
  return (await ctx.app.inject({ method: "GET", url: `/trackings/${CODE}` })).json();
}

describe("delay alert with a controlled clock", () => {
  it("is not raised at exactly the limit and is raised right after it", async () => {
    const ctx = setup({ now: "2026-10-01T10:00:00Z", delayLimitHours: 72 });
    ctx.aggregator.setPayload(CODE, payload(CODE, "correios", [{ status: "PO", at: "2026-10-01T10:00:00Z" }]));
    expect((await registerAndSync(ctx)).delay).toEqual({
      limitHours: 72,
      startedAt: "2026-10-01T10:00:00.000Z",
      transitHours: 0,
      delayed: false,
    });

    ctx.clock.set("2026-10-04T10:00:00Z");
    expect((await ctx.service.get(CODE)).delay).toMatchObject({ transitHours: 72, delayed: false });
    expect((await ctx.app.inject({ method: "GET", url: "/alerts/delays" })).json().items).toEqual([]);

    ctx.clock.set("2026-10-04T10:01:00Z");
    expect((await ctx.service.get(CODE)).delay.delayed).toBe(true);
    const alerts = (await ctx.app.inject({ method: "GET", url: "/alerts/delays" })).json().items;
    expect(alerts.map((a: { code: string }) => a.code)).toEqual([CODE]);
  });

  it("honours a per-shipment limit over the configured default", async () => {
    const ctx = setup({ now: "2026-10-02T11:00:00Z", delayLimitHours: 72 });
    ctx.aggregator.setPayload(CODE, payload(CODE, "correios", [{ status: "PO", at: "2026-10-01T10:00:00Z" }]));
    const view = await registerAndSync(ctx, { code: CODE, delayLimitHours: 24 });
    expect(view.delay).toMatchObject({ limitHours: 24, transitHours: 25, delayed: true });
  });

  it("measures delivered shipments up to the delivery time and stops alerting", async () => {
    const ctx = setup({ now: "2026-10-20T00:00:00Z", delayLimitHours: 72 });
    ctx.aggregator.setPayload(
      CODE,
      payload(CODE, "correios", [
        { status: "PO", at: "2026-10-01T00:00:00Z" },
        { status: "BDE", at: "2026-10-05T00:00:00Z" },
      ]),
    );
    const view = await registerAndSync(ctx);
    expect(view.status).toBe("delivered");
    expect(view.delay).toMatchObject({ transitHours: 96, delayed: true });
    expect((await ctx.app.inject({ method: "GET", url: "/alerts/delays" })).json().items).toEqual([]);
  });

  it("does not start counting before the first recognized event", async () => {
    const ctx = setup({ now: "2026-12-01T00:00:00Z" });
    ctx.aggregator.setPayload(CODE, payload(CODE, "correios", [{ status: "XLD", at: "2026-10-01T00:00:00Z" }]));
    const view = await registerAndSync(ctx);
    expect(view.status).toBeNull();
    expect(view.delay).toMatchObject({ startedAt: null, transitHours: null, delayed: false });
  });

  it("starts counting at the posted event even if it arrives after transit events", async () => {
    const ctx = setup({ now: "2026-10-05T00:00:00Z", delayLimitHours: 72 });
    ctx.aggregator.setPayload(CODE, payload(CODE, "correios", [{ status: "RO", at: "2026-10-03T00:00:00Z" }]));
    expect((await registerAndSync(ctx)).delay).toMatchObject({ transitHours: 48, delayed: false });

    ctx.aggregator.setPayload(
      CODE,
      payload(CODE, "correios", [
        { status: "RO", at: "2026-10-03T00:00:00Z" },
        { status: "PO", at: "2026-10-01T00:00:00Z" },
      ]),
    );
    const view = (await ctx.app.inject({ method: "GET", url: `/trackings/${CODE}` })).json();
    expect(view.delay).toMatchObject({ startedAt: "2026-10-01T00:00:00.000Z", transitHours: 96, delayed: true });
  });
});
