import { describe, expect, it } from "vitest";
import { validateReport } from "./validate-report.js";

const report = {
  address: "0x0000000000000000000000000000000000000001",
  riskScore: 42,
  riskLevel: "medium" as const,
  labels: ["contract-interaction"],
  generatedAt: "2026-05-31T00:00:00.000Z",
  method: "deterministic-mock-v1" as const
};

describe("validateReport", () => {
  it("accepts a fresh report with matching address and payment receipt", () => {
    expect(
      validateReport(report, report.address, {
        now: new Date("2026-05-31T00:01:00.000Z"),
        hasReceipt: true
      })
    ).toMatchObject({ status: "passed" });
  });

  it("rejects address mismatch", () => {
    expect(
      validateReport(report, "0x0000000000000000000000000000000000000002", {
        now: new Date("2026-05-31T00:01:00.000Z"),
        hasReceipt: true
      })
    ).toMatchObject({ status: "failed", reason: "address mismatch" });
  });

  it("rejects malformed reports", () => {
    expect(
      validateReport({ ...report, labels: undefined }, report.address, {
        now: new Date("2026-05-31T00:01:00.000Z"),
        hasReceipt: true
      })
    ).toMatchObject({ status: "failed", reason: "required fields missing" });
  });

  it("rejects invalid risk levels", () => {
    expect(
      validateReport({ ...report, riskLevel: "critical" }, report.address, {
        now: new Date("2026-05-31T00:01:00.000Z"),
        hasReceipt: true
      })
    ).toMatchObject({ status: "failed", reason: "invalid risk level" });
  });

  it("rejects stale reports", () => {
    expect(
      validateReport(report, report.address, {
        now: new Date("2026-05-31T01:00:00.000Z"),
        hasReceipt: true
      })
    ).toMatchObject({ status: "failed", reason: "stale report" });
  });

  it("rejects missing receipts", () => {
    expect(
      validateReport(report, report.address, {
        now: new Date("2026-05-31T00:01:00.000Z"),
        hasReceipt: false
      })
    ).toMatchObject({ status: "failed", reason: "missing payment receipt" });
  });
});
