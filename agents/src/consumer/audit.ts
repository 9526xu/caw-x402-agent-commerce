import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AuditRecord } from "../shared/types.js";

export async function writeAuditRecord(auditDir: string, record: AuditRecord): Promise<string> {
  await mkdir(auditDir, { recursive: true });
  const filePath = path.join(auditDir, `${record.taskId}.json`);
  await writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return filePath;
}
