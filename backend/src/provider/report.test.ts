import { describe, expect, it } from "vitest";
import { generateRiskReport } from "./report.js";

describe("generateRiskReport", () => {
  it("returns a deterministic score for the same address", () => {
    const address = "0x0000000000000000000000000000000000000001";

    const first = generateRiskReport(address, new Date("2026-05-31T00:00:00.000Z"));
    const second = generateRiskReport(address, new Date("2026-05-31T00:01:00.000Z"));

    expect(first.riskScore).toBe(second.riskScore);
    expect(first.address).toBe(address);
    expect(first.method).toBe("deterministic-mock-v1");
  });
});
