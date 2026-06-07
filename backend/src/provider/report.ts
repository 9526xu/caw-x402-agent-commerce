import { createHash } from "node:crypto";
import type { RiskLevel, RiskReport } from "../shared/types.js";

export function generateRiskReport(address: string, now: Date = new Date()): RiskReport {
  const score = scoreAddress(address);
  return {
    address,
    riskScore: score,
    riskLevel: riskLevel(score),
    labels: labelsForScore(score),
    generatedAt: now.toISOString(),
    method: "deterministic-mock-v1"
  };
}

function scoreAddress(address: string): number {
  const digest = createHash("sha256").update(address.toLowerCase()).digest();
  return digest[0] % 101;
}

function riskLevel(score: number): RiskLevel {
  if (score >= 75) return "high";
  if (score >= 40) return "medium";
  if (score >= 0) return "low";
  return "unknown";
}

function labelsForScore(score: number): string[] {
  if (score >= 75) return ["high-risk-pattern", "new-counterparty"];
  if (score >= 40) return ["contract-interaction", "new-counterparty"];
  return ["low-observed-risk"];
}
