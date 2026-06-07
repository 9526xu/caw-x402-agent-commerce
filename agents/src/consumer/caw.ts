import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PaymentRequirementSummary } from "../shared/types.js";

const execFileAsync = promisify(execFile);

export type PactSpecDraft = {
  name: string;
  intent: string;
  original_intent: string;
  execution_plan: string;
  completion_conditions: Array<Record<string, string>>;
  policies: Array<Record<string, unknown>>;
};

export function buildRiskReportPactSpec(input: {
  address: string;
  maxPriceUsdc: string;
  network: string;
  tokenSymbol: string;
  payTo: string;
  resource?: "/risk-report";
}): PactSpecDraft {
  const resource = input.resource ?? "/risk-report";
  const policyScope = cawPolicyScope(input.network, input.tokenSymbol);
  return {
    name: "x402 risk report purchase",
    intent: `Buy one on-chain address risk report for ${input.address}.`,
    original_intent: `Buy one ${resource} report for ${input.address} with a maximum budget of ${input.maxPriceUsdc} ${input.tokenSymbol}.`,
    execution_plan:
      `# Summary
Buy one x402-protected risk report for ${input.address}.

# Operations
- Request ${resource} and parse the x402 payment requirement.
- Pay ${input.maxPriceUsdc} ${input.tokenSymbol} or less to ${input.payTo} on ${input.network} only after local precheck passes.
- Retry ${resource} with the x402 payment proof.
- Validate the returned report and write a redacted audit record.

# Risk Controls
- Single risk-report payment only.
- Network allowlist: ${input.network}
- Token allowlist: ${input.tokenSymbol}
- Payee allowlist: ${input.payTo}
- Per-operation cap: ${input.maxPriceUsdc} ${input.tokenSymbol}
- Time window: 30 minutes`,
    completion_conditions: [
      { type: "tx_count", threshold: "1" },
      { type: "amount_spent", threshold: input.maxPriceUsdc },
      { type: "time_elapsed", threshold: "1800" }
    ],
    policies: [
      {
        name: "single-risk-report-usdc-transfer",
        type: "transfer",
        rules: {
          effect: "allow",
          when: {
            chain_in: [policyScope.chainId],
            token_in: [{ chain_id: policyScope.chainId, token_id: policyScope.tokenId }],
            destination_address_in: [{ chain_id: policyScope.chainId, address: input.payTo }]
          },
          deny_if: {
            amount_gt: input.maxPriceUsdc,
            usage_limits: { rolling_24h: { tx_count_gt: 1, amount_gt: input.maxPriceUsdc } }
          }
        }
      }
    ]
  };
}

function cawPolicyScope(network: string, tokenSymbol: string): { chainId: string; tokenId: string } {
  if (tokenSymbol !== "USDC") {
    throw new Error(`Unsupported CAW Pact token for x402 risk report: ${tokenSymbol}`);
  }

  switch (network) {
    case "eip155:84532":
      return { chainId: "TBASE_SETH", tokenId: "TBASE_SETH_USDC" };
    case "eip155:11155111":
      return { chainId: "SETH", tokenId: "SETH_USDC" };
    case "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1":
      return { chainId: "SOLDEV_SOL", tokenId: "SOLDEV_SOL_USDC" };
    default:
      throw new Error(`Unsupported CAW Pact network for x402 risk report: ${network}`);
  }
}

export type PactSubmitResult = {
  pactId: string;
  status: "submitted" | "active" | "failed";
  credentialAvailable: boolean;
};

export type PactApprovalResult = {
  pactId: string;
  status: "active" | "failed" | "timeout";
  credentialAvailable: boolean;
  reason?: string;
};

export type CawPaymentResult =
  | {
      status: "succeeded";
      paymentId: string;
      paymentSignatureHeader: string;
      cawReference?: string;
      transaction?: string;
    }
  | {
      status: "policy_denied" | "failed";
      paymentId: string;
      reason: string;
      cawReference?: string;
      transaction?: string;
    };

export type CawClient = {
  submitPact(spec: PactSpecDraft): Promise<PactSubmitResult>;
  waitForPactApproval(input: { pactId: string; timeoutMs: number; pollMs: number }): Promise<PactApprovalResult>;
  executePayment(input: {
    pactId: string;
    paymentId: string;
    requirement: PaymentRequirementSummary;
    requestId: string;
  }): Promise<CawPaymentResult>;
};

export function createCawCliClient(env: NodeJS.ProcessEnv = process.env): CawClient {
  return new CawCliClient({
    apiKey: env.CAW_AGENT_CREDENTIAL,
    apiUrl: env.CAW_API_BASE_URL,
    paymentHeaderCommand: env.CAW_X402_PAYMENT_HEADER_COMMAND
  });
}

class CawCliClient implements CawClient {
  constructor(private readonly options: { apiKey?: string; apiUrl?: string; paymentHeaderCommand?: string }) {}

  async submitPact(spec: PactSpecDraft): Promise<PactSubmitResult> {
    const output = await this.runCaw([
      "pact",
      "submit",
      "--name",
      spec.name,
      "--intent",
      spec.intent,
      "--original-intent",
      spec.original_intent,
      "--execution-plan",
      spec.execution_plan,
      "--policies",
      JSON.stringify(spec.policies),
      "--completion-conditions",
      JSON.stringify(spec.completion_conditions)
    ]);
    const json = parseJsonObject(output.stdout);
    const pactId = readString(json, ["pact_id", "pactId", "id"]);
    if (!pactId) {
      throw new Error("CAW pact submit did not return a pact id");
    }
    return {
      pactId,
      status: readString(json, ["status"]) === "active" ? "active" : "submitted",
      credentialAvailable: hasCredential(json)
    };
  }

  async waitForPactApproval(input: { pactId: string; timeoutMs: number; pollMs: number }): Promise<PactApprovalResult> {
    const deadline = Date.now() + input.timeoutMs;
    while (Date.now() <= deadline) {
      const output = await this.runCaw(["pact", "show", "--pact-id", input.pactId]);
      const json = parseJsonObject(output.stdout);
      const status = readString(json, ["status"]);
      if (status === "active") {
        return { pactId: input.pactId, status: "active", credentialAvailable: hasCredential(json) };
      }
      if (status === "failed" || status === "rejected" || status === "expired") {
        return {
          pactId: input.pactId,
          status: "failed",
          credentialAvailable: hasCredential(json),
          reason: `PACT status is ${status}`
        };
      }
      await sleep(input.pollMs);
    }
    return { pactId: input.pactId, status: "timeout", credentialAvailable: false, reason: "PACT approval timed out" };
  }

  async executePayment(input: {
    pactId: string;
    paymentId: string;
    requirement: PaymentRequirementSummary;
    requestId: string;
  }): Promise<CawPaymentResult> {
    if (!this.options.paymentHeaderCommand) {
      return {
        status: "failed",
        paymentId: input.paymentId,
        reason:
          "CAW payment proof command is not configured. The current CAW CLI transfer path does not expose an x402 PAYMENT-SIGNATURE header."
      };
    }

    const output = await execFileAsync(this.options.paymentHeaderCommand, [], {
      env: {
        ...process.env,
        CAW_PACT_ID: input.pactId,
        X402_PAYMENT_ID: input.paymentId,
        X402_REQUEST_ID: input.requestId,
        X402_PRICE_USDC: input.requirement.priceUsdc,
        X402_NETWORK: input.requirement.network,
        X402_TOKEN_SYMBOL: input.requirement.tokenSymbol,
        X402_PAY_TO: input.requirement.payTo,
        X402_RESOURCE: input.requirement.resource
      },
      maxBuffer: 1024 * 1024
    });
    const json = parseJsonObject(output.stdout);
    const paymentSignatureHeader = readString(json, ["paymentSignatureHeader", "payment_signature_header"]);
    if (!paymentSignatureHeader) {
      return {
        status: "failed",
        paymentId: input.paymentId,
        reason: "CAW payment proof command did not return paymentSignatureHeader",
        cawReference: readString(json, ["request_id", "requestId", "tx_id", "txId"])
      };
    }
    return {
      status: "succeeded",
      paymentId: input.paymentId,
      paymentSignatureHeader,
      cawReference: readString(json, ["request_id", "requestId", "tx_id", "txId"]),
      transaction: readString(json, ["transaction", "tx_hash", "txHash"])
    };
  }

  private async runCaw(args: string[]): Promise<{ stdout: string; stderr: string }> {
    const cawArgs = [...args];
    if (this.options.apiKey && this.options.apiKey !== "replace-with-agent-credential") {
      cawArgs.push("--api-key", this.options.apiKey);
    }
    if (this.options.apiUrl && this.options.apiUrl !== "https://api.example.invalid") {
      cawArgs.push("--api-url", this.options.apiUrl);
    }

    try {
      const { stdout, stderr } = await execFileAsync("caw", cawArgs, { maxBuffer: 1024 * 1024 });
      return { stdout, stderr };
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string; code?: number };
      if (failure.code === 5) {
        throw new Error(`CAW policy denied: ${redact(String(failure.stderr ?? failure.stdout ?? ""))}`);
      }
      throw new Error(redact(String(failure.stderr ?? failure.stdout ?? error)));
    }
  }
}

function parseJsonObject(value: string): Record<string, unknown> {
  const trimmed = value.trim();
  if (!trimmed) return {};
  return JSON.parse(trimmed) as Record<string, unknown>;
}

function readString(value: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  }
  return undefined;
}

function hasCredential(value: Record<string, unknown>): boolean {
  return Boolean(readString(value, ["api_key", "apiKey", "credential", "pact_scoped_api_key", "pactScopedApiKey"]));
}

function redact(value: string): string {
  return value.replace(/(api[_-]?key|credential|token|secret)["'=:\s]+[A-Za-z0-9._-]+/gi, "$1=<redacted>");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
