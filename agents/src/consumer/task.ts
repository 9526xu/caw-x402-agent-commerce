import { normalizeEvmAddress } from "../shared/address.js";
import { loadConfig, type DemoConfig } from "../shared/config.js";
import { createTaskId } from "../shared/ids.js";
import type { AuditRecord, PrecheckResult } from "../shared/types.js";
import { reportHash } from "../shared/fingerprint.js";
import { buildRiskReportPactSpec, createCawCliClient, type CawClient, type PactSpecDraft } from "./caw.js";
import { precheckPaymentRequirement } from "./precheck.js";
import { writeAuditRecord } from "./audit.js";
import { validateReport } from "./validate-report.js";
import {
  parsePaymentRequiredResponse,
  parsePaymentSettleResponse,
  summarizePaymentRequirement
} from "./x402-requirement.js";

export type ConsumerTaskArgs = {
  address: string;
  apiUrl?: string;
  maxPriceUsdc: string;
  expectedPayTo: string;
  expectedNetwork: string;
  expectedTokenSymbol: string;
  expectedResource: "/risk-report";
};

export type ConsumerTaskResult = {
  taskId: string;
  address: string;
  precheck: PrecheckResult;
  auditPath: string;
  paymentAttempted: boolean;
  status?: "precheck_failed" | "pact_failed" | "payment_failed" | "validation_failed" | "succeeded";
};

export async function runConsumerPrecheckTask(
  args: ConsumerTaskArgs,
  options: {
    config?: DemoConfig;
    fetchFn?: typeof fetch;
    now?: Date;
  } = {}
): Promise<ConsumerTaskResult> {
  return runConsumerTask(args, { ...options, precheckOnly: true });
}

export async function runConsumerTask(
  args: ConsumerTaskArgs,
  options: {
    config?: DemoConfig;
    fetchFn?: typeof fetch;
    now?: Date;
    cawClient?: CawClient;
    precheckOnly?: boolean;
    pactApprovalTimeoutMs?: number;
    pactApprovalPollMs?: number;
    maxPaidRetries?: number;
  } = {}
): Promise<ConsumerTaskResult> {
  const config = options.config ?? loadConfig();
  const fetchFn = options.fetchFn ?? fetch;
  const cawClient = options.cawClient ?? createCawCliClient();
  const address = normalizeEvmAddress(args.address);
  const apiUrl = args.apiUrl ?? `${config.providerBaseUrl}/risk-report`;
  const taskId = createTaskId(options.now);
  const baseAudit: AuditRecord = {
    taskId,
    requestedAddress: address,
    api: apiUrl,
    userRequest: { address, maxPriceUsdc: args.maxPriceUsdc }
  };
  const response = await fetchFn(`${apiUrl}?address=${encodeURIComponent(address)}`, {
    headers: { accept: "application/json" }
  });

  if (response.status !== 402) {
    throw new Error(`Expected 402 Payment Required, got ${response.status}`);
  }

  const paymentRequired = parsePaymentRequiredResponse(response);
  const requirement = summarizePaymentRequirement(paymentRequired);
  const pactSpec = buildRiskReportPactSpec({
    address,
    maxPriceUsdc: args.maxPriceUsdc,
    network: args.expectedNetwork,
    tokenSymbol: args.expectedTokenSymbol,
    payTo: args.expectedPayTo,
    resource: args.expectedResource
  });
  const precheck = precheckPaymentRequirement({
    requirement,
    maxPriceUsdc: args.maxPriceUsdc,
    expectedPayTo: args.expectedPayTo,
    expectedNetwork: args.expectedNetwork,
    expectedTokenSymbol: args.expectedTokenSymbol,
    expectedResource: args.expectedResource,
    now: options.now
  });

  if (precheck.status === "failed" || options.precheckOnly) {
    const audit: AuditRecord = {
      ...baseAudit,
      pact: pactSummary(pactSpec, args, precheck.status === "failed" ? "not_created" : "not_created"),
      paymentRequirement: requirement,
      precheck,
      payment: {
        status: "not_attempted",
        reason:
          precheck.status === "failed"
            ? `Local precheck refused payment: ${precheck.reason}`
            : "Precheck-only mode stopped before CAW Pact creation."
      }
    };
    const auditPath = await writeAuditRecord(config.auditDir, audit);

    return {
      taskId,
      address,
      precheck,
      auditPath,
      paymentAttempted: false,
      status: precheck.status === "failed" ? "precheck_failed" : undefined
    };
  }

  let pactId: string | undefined;
  try {
    const submitted = await cawClient.submitPact(pactSpec);
    pactId = submitted.pactId;
    const approval =
      submitted.status === "active"
        ? { pactId: submitted.pactId, status: "active" as const, credentialAvailable: submitted.credentialAvailable }
        : await cawClient.waitForPactApproval({
            pactId: submitted.pactId,
            timeoutMs: options.pactApprovalTimeoutMs ?? 10 * 60 * 1000,
            pollMs: options.pactApprovalPollMs ?? 5000
          });

    if (approval.status !== "active") {
      const auditPath = await writeAuditRecord(config.auditDir, {
        ...baseAudit,
        pact: {
          ...pactSummary(pactSpec, args, approval.status),
          pactId,
          credential: approval.credentialAvailable ? "available_redacted" : "not_available",
          reason: approval.reason
        },
        paymentRequirement: requirement,
        precheck,
        payment: { status: "not_attempted", reason: approval.reason ?? "PACT approval did not become active" }
      });
      return { taskId, address, precheck, auditPath, paymentAttempted: false, status: "pact_failed" };
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "PACT creation failed";
    const auditPath = await writeAuditRecord(config.auditDir, {
      ...baseAudit,
      pact: { ...pactSummary(pactSpec, args, "failed"), reason },
      paymentRequirement: requirement,
      precheck,
      payment: { status: "not_attempted", reason }
    });
    return { taskId, address, precheck, auditPath, paymentAttempted: false, status: "pact_failed" };
  }

  const paymentId = `pay_${taskId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  const requestId = `x402-risk-report-${taskId}`;
  const payment = await cawClient.executePayment({
    pactId,
    paymentId,
    requirement,
    requestId
  });

  if (payment.status !== "succeeded") {
    const auditPath = await writeAuditRecord(config.auditDir, {
      ...baseAudit,
      pact: { ...pactSummary(pactSpec, args, "active"), pactId, credential: "available_redacted" },
      paymentRequirement: requirement,
      precheck,
      payment:
        payment.status === "policy_denied"
          ? { status: "policy_denied", reason: payment.reason, paymentId, cawReference: payment.cawReference }
          : { status: "failed", reason: payment.reason, paymentId, cawReference: payment.cawReference }
    });
    return { taskId, address, precheck, auditPath, paymentAttempted: true, status: "payment_failed" };
  }

  let paidResponse: Response | undefined;
  for (let attempt = 0; attempt < (options.maxPaidRetries ?? 1); attempt += 1) {
    paidResponse = await fetchFn(`${apiUrl}?address=${encodeURIComponent(address)}`, {
      headers: {
        accept: "application/json",
        "payment-signature": payment.paymentSignatureHeader
      }
    });
    if (paidResponse.status !== 402) break;
  }

  if (!paidResponse || paidResponse.status !== 200) {
    const failureSummary = paidResponse ? await paidRetryFailureSummary(paidResponse) : "paid retry did not run";
    const auditPath = await writeAuditRecord(config.auditDir, {
      ...baseAudit,
      pact: { ...pactSummary(pactSpec, args, "active"), pactId, credential: "available_redacted" },
      paymentRequirement: requirement,
      precheck,
      payment: {
        status: "submitted",
        paymentId,
        paymentProof: "available_redacted",
        cawReference: payment.cawReference,
        transaction: payment.transaction
      },
      validation: {
        status: "failed",
        checks: [],
        reason: failureSummary
      }
    });
    return { taskId, address, precheck, auditPath, paymentAttempted: true, status: "validation_failed" };
  }

  const paidBody = (await paidResponse.json()) as { report?: unknown };
  const settlement = parsePaymentSettleResponse(paidResponse);
  const validation = validateReport(paidBody.report, address, {
    now: options.now,
    hasReceipt: Boolean(settlement || payment.transaction)
  });
  const audit: AuditRecord = {
    ...baseAudit,
    pact: { ...pactSummary(pactSpec, args, "active"), pactId, credential: "available_redacted" },
    paymentRequirement: requirement,
    precheck,
    payment: {
      status: settlement ? "settled" : "submitted",
      paymentId,
      paymentProof: "available_redacted",
      cawReference: payment.cawReference,
      transaction: payment.transaction,
      settlement: settlement
        ? { network: settlement.network, transaction: settlement.transaction, payer: settlement.payer }
        : undefined
    },
    report: isReportForAudit(paidBody.report)
      ? { hash: reportHash(paidBody.report), riskLevel: paidBody.report.riskLevel, generatedAt: paidBody.report.generatedAt }
      : undefined,
    validation
  };
  const auditPath = await writeAuditRecord(config.auditDir, audit);

  return {
    taskId,
    address,
    precheck,
    auditPath,
    paymentAttempted: true,
    status: validation.status === "passed" ? "succeeded" : "validation_failed"
  };
}

async function paidRetryFailureSummary(response: Response): Promise<string> {
  const prefix = `paid retry returned HTTP ${response.status}`;
  try {
    const body = (await response.clone().json()) as {
      error?: unknown;
      x402Error?: unknown;
      agentAdvice?: {
        reason?: unknown;
        likelyCause?: unknown;
        nextAction?: unknown;
      };
    };
    const details = [
      typeof body.error === "string" ? `error=${body.error}` : undefined,
      typeof body.x402Error === "string" ? `x402Error=${body.x402Error}` : undefined,
      typeof body.agentAdvice?.nextAction === "string" ? `nextAction=${body.agentAdvice.nextAction}` : undefined,
      typeof body.agentAdvice?.reason === "string" ? `reason=${body.agentAdvice.reason}` : undefined,
      typeof body.agentAdvice?.likelyCause === "string" ? `likelyCause=${body.agentAdvice.likelyCause}` : undefined
    ].filter(Boolean);
    return details.length > 0 ? `${prefix}: ${details.join("; ")}` : prefix;
  } catch {
    return prefix;
  }
}

function pactSummary(
  spec: PactSpecDraft,
  args: ConsumerTaskArgs,
  status: "not_created" | "submitted" | "active" | "failed" | "timeout"
): NonNullable<AuditRecord["pact"]> {
  return {
    status,
    policySummary: {
      network: args.expectedNetwork,
      tokenSymbol: args.expectedTokenSymbol,
      payTo: args.expectedPayTo,
      maxPriceUsdc: args.maxPriceUsdc,
      resource: args.expectedResource,
      completion: spec.completion_conditions.map((condition) => `${condition.type}:${condition.threshold}`)
    },
    credential: "not_available"
  };
}

function isReportForAudit(value: unknown): value is {
  address: string;
  riskScore: number;
  riskLevel: "low" | "medium" | "high" | "unknown";
  labels: string[];
  generatedAt: string;
  method: "deterministic-mock-v1";
} {
  return Boolean(value && typeof value === "object" && "riskLevel" in value && "generatedAt" in value);
}
