import type { RiskReport } from "../shared/types.js";

const VALID_LEVELS = new Set(["low", "medium", "high", "unknown"]);

export function validateReport(
  report: unknown,
  requestedAddress: string,
  options: { now?: Date; maxAgeMs?: number; hasReceipt?: boolean } = {}
): {
  status: "passed" | "failed";
  checks: string[];
  reason?: string;
} {
  const checks: string[] = [];
  const now = options.now ?? new Date();
  const maxAgeMs = options.maxAgeMs ?? 10 * 60 * 1000;

  if (!isRiskReportLike(report)) {
    return { status: "failed", checks, reason: "required fields missing" };
  }

  if (report.address.toLowerCase() !== requestedAddress.toLowerCase()) {
    return { status: "failed", checks, reason: "address mismatch" };
  }
  checks.push("address_match");

  if (!Number.isInteger(report.riskScore) || !report.generatedAt || !Array.isArray(report.labels)) {
    return { status: "failed", checks, reason: "required fields missing" };
  }
  checks.push("required_fields");

  if (!VALID_LEVELS.has(report.riskLevel)) {
    return { status: "failed", checks, reason: "invalid risk level" };
  }
  checks.push("risk_level");

  const generatedAt = Date.parse(report.generatedAt);
  if (!Number.isFinite(generatedAt) || generatedAt > now.getTime() || now.getTime() - generatedAt > maxAgeMs) {
    return { status: "failed", checks, reason: "stale report" };
  }
  checks.push("freshness");

  if (!options.hasReceipt) {
    return { status: "failed", checks, reason: "missing payment receipt" };
  }
  checks.push("payment_receipt");

  return { status: "passed", checks };
}

function isRiskReportLike(value: unknown): value is RiskReport {
  if (!value || typeof value !== "object") return false;
  const report = value as Partial<RiskReport>;
  return (
    typeof report.address === "string" &&
    typeof report.riskScore === "number" &&
    typeof report.riskLevel === "string" &&
    Array.isArray(report.labels) &&
    typeof report.generatedAt === "string"
  );
}
