import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../shared/config.js";
import { runConsumerPrecheckTask, runConsumerTask } from "./task.js";
import type { PaymentRequired, SettleResponse } from "@x402/core/types";
import type { CawClient } from "./caw.js";

describe("runConsumerPrecheckTask", () => {
  it("refuses an out-of-policy 402 locally and writes a failure audit without payment", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "x402-caw-consumer-"));
    try {
      const config = loadConfig({
        PROVIDER_BASE_URL: "http://localhost:4021",
        PROVIDER_PAY_TO_ADDRESS: "0x0000000000000000000000000000000000000000",
        X402_NETWORK: "eip155:84532",
        X402_PRICE_USDC: "0.005",
        X402_TOKEN_SYMBOL: "USDC",
        X402_FACILITATOR_URL: "https://x402.org/facilitator",
        SQLITE_PATH: path.join(tempDir, "db.sqlite"),
        AUDIT_DIR: path.join(tempDir, "audits")
      });
      const response = new Response("{}", {
        status: 402,
        headers: {
          "PAYMENT-REQUIRED": Buffer.from(
            JSON.stringify(paymentRequiredFixture({ payTo: "0x0000000000000000000000000000000000000002" }))
          ).toString("base64url")
        }
      });
      const fetchFn = async () => response;

      const result = await runConsumerPrecheckTask(
        {
          address: "0x0000000000000000000000000000000000000001",
          maxPriceUsdc: "0.005",
          expectedPayTo: config.providerPayToAddress,
          expectedNetwork: config.x402Network,
          expectedTokenSymbol: config.x402TokenSymbol,
          expectedResource: "/risk-report"
        },
        { config, fetchFn, now: new Date("2026-05-31T00:00:00.000Z") }
      );
      const audit = JSON.parse(await readFile(result.auditPath, "utf8")) as {
        precheck: { status: string; reason: string };
        payment: { status: string };
      };

      expect(result.paymentAttempted).toBe(false);
      expect(result.precheck).toMatchObject({ status: "failed", reason: "payee mismatch" });
      expect(audit.precheck).toMatchObject({ status: "failed", reason: "payee mismatch" });
      expect(audit.payment).toEqual({
        status: "not_attempted",
        reason: "Local precheck refused payment: payee mismatch"
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("creates a CAW pact, executes one payment, retries with proof, validates the report, and writes final audit", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "x402-caw-consumer-"));
    try {
      const config = testConfig(tempDir);
      const paymentRequired = paymentRequiredFixture();
      const settlement: SettleResponse = {
        success: true,
        transaction: "0xsettled",
        network: config.x402Network as `${string}:${string}`,
        payer: "0x00000000000000000000000000000000000000aa"
      };
      const fetchFn = async (_url: string | URL | Request, init?: RequestInit) => {
        if (init?.headers && "payment-signature" in (init.headers as Record<string, string>)) {
          return new Response(
            JSON.stringify({
              report: {
                address: "0x0000000000000000000000000000000000000001",
                riskScore: 42,
                riskLevel: "medium",
                labels: ["contract-interaction"],
                generatedAt: "2026-05-31T00:00:00.000Z",
                method: "deterministic-mock-v1"
              }
            }),
            {
              status: 200,
              headers: {
                "PAYMENT-RESPONSE": Buffer.from(JSON.stringify(settlement)).toString("base64url")
              }
            }
          );
        }
        return paymentRequiredResponse(paymentRequired);
      };

      const result = await runConsumerTask(
        {
          address: "0x0000000000000000000000000000000000000001",
          maxPriceUsdc: "0.005",
          expectedPayTo: config.providerPayToAddress,
          expectedNetwork: config.x402Network,
          expectedTokenSymbol: config.x402TokenSymbol,
          expectedResource: "/risk-report"
        },
        {
          config,
          fetchFn,
          cawClient: successfulCawClient(),
          now: new Date("2026-05-31T00:01:00.000Z"),
          pactApprovalPollMs: 1,
          pactApprovalTimeoutMs: 10
        }
      );
      const audit = JSON.parse(await readFile(result.auditPath, "utf8")) as {
        pact: { status: string; credential: string; pactId: string };
        payment: {
          status: string;
          paymentId: string;
          paymentProof: string;
          settlement: { txId: string; tx_id: string; transaction: string };
        };
        validation: { status: string };
        report: { hash: string; riskLevel: string };
      };

      expect(result).toMatchObject({ paymentAttempted: true, status: "succeeded" });
      expect(audit.pact).toMatchObject({ status: "active", credential: "available_redacted", pactId: "pact_123" });
      expect(audit.payment).toMatchObject({
        status: "settled",
        paymentProof: "available_redacted",
        settlement: { txId: "0xsettled", tx_id: "0xsettled", transaction: "0xsettled" }
      });
      expect(audit.payment.paymentId).toMatch(/^pay_/);
      expect(audit.validation).toMatchObject({ status: "passed" });
      expect(audit.report).toMatchObject({ riskLevel: "medium" });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("stops safely and writes audit when CAW policy denies payment", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "x402-caw-consumer-"));
    try {
      const config = testConfig(tempDir);
      const result = await runConsumerTask(
        {
          address: "0x0000000000000000000000000000000000000001",
          maxPriceUsdc: "0.005",
          expectedPayTo: config.providerPayToAddress,
          expectedNetwork: config.x402Network,
          expectedTokenSymbol: config.x402TokenSymbol,
          expectedResource: "/risk-report"
        },
        {
          config,
          fetchFn: async () => paymentRequiredResponse(paymentRequiredFixture()),
          cawClient: policyDeniedCawClient(),
          now: new Date("2026-05-31T00:01:00.000Z"),
          pactApprovalPollMs: 1,
          pactApprovalTimeoutMs: 10
        }
      );
      const audit = JSON.parse(await readFile(result.auditPath, "utf8")) as {
        payment: { status: string; reason: string };
      };

      expect(result).toMatchObject({ paymentAttempted: true, status: "payment_failed" });
      expect(audit.payment).toMatchObject({ status: "policy_denied", reason: "permission_check_failed" });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("keeps provider x402 verification advice when paid retry returns 402", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "x402-caw-consumer-"));
    try {
      const config = testConfig(tempDir);
      const paymentRequired = paymentRequiredFixture();
      const fetchFn = async (_url: string | URL | Request, init?: RequestInit) => {
        if (init?.headers && "payment-signature" in (init.headers as Record<string, string>)) {
          return new Response(
            JSON.stringify({
              error: "x402_payment_verification_failed",
              x402Error: "transaction_simulation_failed",
              agentAdvice: {
                nextAction: "stop_for_review",
                reason: "The Facilitator could not simulate the payment transaction.",
                likelyCause: "For Solana exact payments, this commonly means the Provider payee has no token account."
              }
            }),
            { status: 402, headers: { "content-type": "application/json" } }
          );
        }
        return paymentRequiredResponse(paymentRequired);
      };

      const result = await runConsumerTask(
        {
          address: "0x0000000000000000000000000000000000000001",
          maxPriceUsdc: "0.005",
          expectedPayTo: config.providerPayToAddress,
          expectedNetwork: config.x402Network,
          expectedTokenSymbol: config.x402TokenSymbol,
          expectedResource: "/risk-report"
        },
        {
          config,
          fetchFn,
          cawClient: successfulCawClient(),
          now: new Date("2026-05-31T00:01:00.000Z"),
          pactApprovalPollMs: 1,
          pactApprovalTimeoutMs: 10
        }
      );
      const audit = JSON.parse(await readFile(result.auditPath, "utf8")) as {
        validation: { status: string; reason: string };
      };

      expect(result).toMatchObject({ paymentAttempted: true, status: "validation_failed" });
      expect(audit.validation).toMatchObject({ status: "failed" });
      expect(audit.validation.reason).toContain("x402Error=transaction_simulation_failed");
      expect(audit.validation.reason).toContain("nextAction=stop_for_review");
      expect(audit.validation.reason).toContain("token account");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

function testConfig(tempDir: string) {
  return loadConfig({
    PROVIDER_BASE_URL: "http://localhost:4021",
    PROVIDER_PAY_TO_ADDRESS: "0x0000000000000000000000000000000000000000",
    X402_NETWORK: "eip155:84532",
    X402_PRICE_USDC: "0.005",
    X402_TOKEN_SYMBOL: "USDC",
    X402_FACILITATOR_URL: "https://x402.org/facilitator",
    SQLITE_PATH: path.join(tempDir, "db.sqlite"),
    AUDIT_DIR: path.join(tempDir, "audits")
  });
}

function paymentRequiredResponse(paymentRequired: PaymentRequired): Response {
  return new Response("{}", {
    status: 402,
    headers: {
      "PAYMENT-REQUIRED": Buffer.from(JSON.stringify(paymentRequired)).toString("base64url")
    }
  });
}

function successfulCawClient(): CawClient {
  return {
    async submitPact() {
      return { pactId: "pact_123", status: "submitted", credentialAvailable: false };
    },
    async waitForPactApproval() {
      return { pactId: "pact_123", status: "active", credentialAvailable: true };
    },
    async executePayment(input) {
      return {
        status: "succeeded",
        paymentId: input.paymentId,
        paymentSignatureHeader: "proof_redacted",
        cawReference: "caw_req_123",
        transaction: "0xcaw"
      };
    }
  };
}

function policyDeniedCawClient(): CawClient {
  return {
    async submitPact() {
      return { pactId: "pact_123", status: "active", credentialAvailable: true };
    },
    async waitForPactApproval() {
      return { pactId: "pact_123", status: "active", credentialAvailable: true };
    },
    async executePayment(input) {
      return {
        status: "policy_denied",
        paymentId: input.paymentId,
        reason: "permission_check_failed",
        cawReference: "caw_req_denied"
      };
    }
  };
}

function paymentRequiredFixture(overrides: Partial<PaymentRequired["accepts"][number]> = {}): PaymentRequired {
  return {
    x402Version: 2,
    error: "Payment required",
    resource: {
      url: "http://localhost:4021/risk-report",
      description: "On-chain address risk report",
      mimeType: "application/json"
    },
    accepts: [
      {
        scheme: "exact",
        network: "eip155:84532",
        asset: "USDC",
        amount: "5000",
        payTo: "0x0000000000000000000000000000000000000000",
        maxTimeoutSeconds: 1800,
        extra: {
          priceUsdc: "0.005",
          tokenSymbol: "USDC"
        },
        ...overrides
      }
    ]
  };
}
