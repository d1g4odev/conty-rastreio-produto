import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("uses a 120h delay limit by default", () => {
    expect(loadConfig({})).toEqual({ PORT: 3000, HOST: "127.0.0.1", DELAY_LIMIT_HOURS: 120 });
  });

  it("reads the delay limit from the environment", () => {
    expect(loadConfig({ DELAY_LIMIT_HOURS: "48" }).DELAY_LIMIT_HOURS).toBe(48);
  });

  it("rejects an invalid delay limit", () => {
    expect(() => loadConfig({ DELAY_LIMIT_HOURS: "-5" })).toThrow();
  });
});
