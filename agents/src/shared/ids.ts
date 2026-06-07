import { randomUUID } from "node:crypto";

export function createTaskId(now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `risk-report-${stamp}-${randomUUID().slice(0, 8)}`;
}
