import { describe, expect, it } from "vitest";
import { normalizeCarrierStatus } from "../src/domain/carriers.js";

describe("normalizeCarrierStatus", () => {
  it.each([
    ["correios", "PO", "posted"],
    ["correios", "RO", "in_transit"],
    ["correios", "DO", "in_transit"],
    ["correios", "OEC", "out_for_delivery"],
    ["correios", "BDE", "delivered"],
    ["correios", "BDI", "exception"],
    ["jadlog", "EMISSAO", "posted"],
    ["jadlog", "TRANSFERENCIA", "in_transit"],
    ["jadlog", "EM ROTA", "out_for_delivery"],
    ["jadlog", "ENTREGUE", "delivered"],
    ["jadlog", "DEVOLUCAO", "exception"],
    ["loggi", "picked_up", "posted"],
    ["loggi", "delivered", "delivered"],
    ["loggi", "delivery_failed", "exception"],
  ])("maps %s %s to %s", (carrier, raw, expected) => {
    expect(normalizeCarrierStatus(carrier, raw)).toBe(expected);
  });

  it("tolerates case and whitespace differences", () => {
    expect(normalizeCarrierStatus(" Correios ", " bde ")).toBe("delivered");
    expect(normalizeCarrierStatus("jadlog", "em   rota")).toBe("out_for_delivery");
  });

  it.each([
    ["jadlog", "NAO ENTREGUE - ENDERECO INCORRETO"],
    ["jadlog", "ENTREGUE PARCIAL"],
    ["correios", "BDE-99"],
    ["correios", "XLD"],
    ["loggi", "delivered_to_neighbor"],
    ["correios", "constructor"],
    ["correios", "__proto__"],
    ["correios", "toString"],
  ])("never maps unknown %s status %s, so it can't become delivered", (carrier, raw) => {
    expect(normalizeCarrierStatus(carrier, raw)).toBeNull();
  });

  it("returns null for every status of an unknown carrier", () => {
    expect(normalizeCarrierStatus("transportadora-x", "DELIVERED")).toBeNull();
    expect(normalizeCarrierStatus("transportadora-x", "BDE")).toBeNull();
  });
});
