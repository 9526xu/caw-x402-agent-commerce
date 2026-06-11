#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeCliError } from "./lib/errors.mjs";
import { runPurchasePrecheck } from "./lib/precheck.mjs";

const execFileAsync = promisify(execFile);
const args = parseArgs(process.argv.slice(2));

if (!args.url) usage("Missing required --url");

main().catch((error) => {
  writeCliError("purchase", error);
  process.exit(1);
});

async function main() {
  const precheck = await runPurchasePrecheck(args);
  const plan = buildCawPurchasePlan(precheck, args);

  if (!precheck.ok) {
    writeResult({
      ok: false,
      stage: "precheck",
      precheck,
      plan,
      nextAction: "stop_for_review"
    });
    process.exitCode = 2;
    return;
  }

  if (!args.execute && !args.submitPact && !args.pay) {
    writeResult({
      ok: true,
      stage: "planned",
      precheck,
      plan,
      nextAction: "rerun_with_submit_pact_to_request_cobo_wallet_authorization"
    });
    return;
  }

  if (args.pay && !args.pactId) {
    throw new Error("--pay requires --pact-id");
  }

  const submitted = args.pactId
    ? {
        pactId: args.pactId,
        summary: {
          pactId: args.pactId,
          status: "provided_by_operator",
          credential: "not_inspected"
        }
      }
    : await submitPact(plan.pactSpec, args);

  writeResult({
    ok: true,
    stage: args.pactId ? "pact_resume_requested" : "pact_submitted",
    pact: submitted.summary,
    nextAction: args.pactId
      ? "check_or_wait_for_pact_active"
      : args.submitPact
        ? "approve_pact_in_cobo_wallet_then_resume_with_pay_and_pact_id"
        : "approve_pact_in_cobo_wallet"
  });

  if (args.submitPact && !args.execute && !args.pay) {
    return;
  }

  if (!submitted.pactId) {
    writeResult({
      ok: true,
      stage: "pact_approval_requested",
      pact: submitted.summary,
      nextAction:
        "approve_pact_in_cobo_wallet_then_resume_with_returned_pact_id_or_check_caw_pending_status",
      note:
        "CAW accepted the Pact request but did not return a pact id in the CLI response shape this script could read."
    });
    return;
  }

  const approval = await waitForPactApproval(submitted.pactId, args);
  if (approval.status !== "active") {
    writeResult({
      ok: false,
      stage: "pact_not_active",
      pact: approval,
      nextAction: "stop_for_review"
    });
    process.exitCode = 2;
    return;
  }

  const payment = await runCawFetch({
    pactId: submitted.pactId,
    url: precheck.resource.url,
    payment: precheck.quote.payment,
    args
  });

  const settlement = payment.ok
    ? await queryOrderSettlement(precheck.resource.url, precheck.quote.requestFingerprint, args)
    : undefined;

  writeResult({
    ok: payment.ok,
    stage: payment.ok ? "paid" : "payment_failed",
    pact: approval,
    payment,
    settlement,
    nextAction: payment.ok ? "validate_delivery_and_write_redacted_audit" : "check_caw_tx_and_provider_status_before_retry"
  });
  if (!payment.ok) process.exitCode = 2;
}

function buildCawPurchasePlan(precheck, parsedArgs) {
  const payment = precheck.quote.payment;
  if (!payment) {
    return { status: "blocked", reason: "missing x402 payment requirement" };
  }
  const policyScope = cawPolicyScope(payment.network, payment.tokenSymbol);
  const maxPriceUsdc = parsedArgs.maxPriceUsdc ?? payment.priceUsdc;
  const resourceUrl = new URL(precheck.resource.url);
  const resourcePath = payment.resource ?? resourceUrl.pathname;

  return {
    status: "ready_to_submit_pact_request",
    createsPayment: true,
    summary: {
      resourceUrl: precheck.resource.url,
      requestFingerprint: precheck.quote.requestFingerprint,
      maxPriceUsdc,
      rawAmount: payment.amount,
      token: payment.tokenSymbol,
      network: payment.network,
      asset: payment.asset,
      payee: payment.payTo,
      cawChainId: policyScope.chainId,
      cawTokenId: policyScope.tokenId,
      txCount: "1",
      timeWindowSeconds: "1800"
    },
    pactSpec: {
      name: "x402 paid resource purchase",
      intent: `Buy one x402 paid resource at ${resourcePath}.`,
      original_intent: `Buy ${precheck.resource.url} with a maximum budget of ${maxPriceUsdc} ${payment.tokenSymbol}.`,
      execution_plan:
        `# Summary
Buy one x402-protected paid resource.

# Operations
- Request ${precheck.resource.url} and parse the x402 payment requirement.
- Pay ${maxPriceUsdc} ${payment.tokenSymbol} or less to ${payment.payTo} on ${payment.network} only after precheck passes.
- Use caw fetch to execute x402 payment under this Pact.
- Return the delivered result and write redacted audit evidence.

# Risk Controls
- Single paid-resource purchase only.
- Network allowlist: ${payment.network}
- Token allowlist: ${payment.tokenSymbol}
- Payee allowlist: ${payment.payTo}
- Per-operation cap: ${maxPriceUsdc} ${payment.tokenSymbol}
- Time window: 30 minutes`,
      completion_conditions: [
        { type: "tx_count", threshold: "1" },
        { type: "amount_spent", threshold: maxPriceUsdc },
        { type: "time_elapsed", threshold: "1800" }
      ],
      policies: [
        {
          name: "single-x402-usdc-transfer",
          type: "transfer",
          rules: {
            effect: "allow",
            when: {
              chain_in: [policyScope.chainId],
              token_in: [{ chain_id: policyScope.chainId, token_id: policyScope.tokenId }],
              destination_address_in: [{ chain_id: policyScope.chainId, address: payment.payTo }]
            },
            deny_if: {
              amount_gt: maxPriceUsdc,
              usage_limits: { rolling_24h: { tx_count_gt: 1, amount_gt: maxPriceUsdc } }
            }
          }
        }
      ]
    }
  };
}

async function submitPact(pactSpec, parsedArgs) {
  const output = await runCaw(
    [
      "pact",
      "submit",
      "--name",
      pactSpec.name,
      "--intent",
      pactSpec.intent,
      "--original-intent",
      pactSpec.original_intent,
      "--execution-plan",
      pactSpec.execution_plan,
      "--policies",
      JSON.stringify(pactSpec.policies),
      "--completion-conditions",
      JSON.stringify(pactSpec.completion_conditions)
    ],
    parsedArgs
  );
  const json = parseJsonObject(output.stdout);
  const pactId = readDeepString(json, ["pact_id", "pactId", "pactId"]);
  const approvalId = readDeepString(json, ["approval_id", "approvalId", "response_id", "responseId", "request_id", "requestId"]);
  if (!pactId && approvalId) {
    return {
      pactId: null,
      approvalId,
      summary: {
        approvalId,
        status: readDeepString(json, ["status"]) ?? "approval_requested",
        credential: hasCredential(json) ? "available_redacted" : "not_available"
      }
    };
  }
  if (!pactId) {
    return {
      pactId: null,
      summary: {
        status: readDeepString(json, ["status"]) ?? "approval_requested",
        credential: hasCredential(json) ? "available_redacted" : "not_available",
        outputShape: summarizeJsonShape(json)
      }
    };
  }
  return {
    pactId,
    summary: {
      pactId,
      approvalId,
      status: readDeepString(json, ["status"]) ?? "submitted",
      credential: hasCredential(json) ? "available_redacted" : "not_available"
    }
  };
}

async function waitForPactApproval(pactId, parsedArgs) {
  const deadline = Date.now() + parsedArgs.approvalTimeoutMs;
  while (Date.now() <= deadline) {
    const output = await runCaw(["pact", "status", "--pact-id", pactId], parsedArgs);
    const json = parseJsonObject(output.stdout);
    const status = readDeepString(json, ["status"]);
    if (status === "active") {
      return {
        pactId,
        status,
        credential: hasCredential(json) ? "available_redacted" : "not_available"
      };
    }
    if (status === "failed" || status === "rejected" || status === "expired") {
      return { pactId, status, reason: `Pact status is ${status}` };
    }
    await sleep(parsedArgs.approvalPollMs);
  }
  return { pactId, status: "timeout", reason: "Timed out waiting for Cobo Wallet Pact approval" };
}

async function queryOrderSettlement(resourceUrl, requestFingerprint, parsedArgs) {
  try {
    const base = parsedArgs.baseUrl ?? new URL(resourceUrl).origin;
    const statusUrl = new URL("/orders/status", base);
    statusUrl.searchParams.set("fingerprint", requestFingerprint);

    const headers = { accept: "application/json" };
    if (parsedArgs.apiKey) headers["authorization"] = `Bearer ${parsedArgs.apiKey}`;

    const response = await fetch(statusUrl.toString(), { headers });
    if (!response.ok) {
      return { queried: true, error: `HTTP ${response.status}` };
    }

    const body = await response.json();
    return body.settlement
      ? {
          queried: true,
          txId: body.settlement.txId ?? body.settlement.txHash ?? body.settlement.tx_id,
          tx_id: body.settlement.tx_id ?? body.settlement.txId ?? body.settlement.txHash,
          txHash: body.settlement.txHash ?? body.settlement.txId ?? body.settlement.tx_id,
          payer: body.settlement.payer,
          settledAt: body.settlement.settledAt
        }
      : { queried: true, txHash: null };
  } catch (error) {
    return { queried: true, error: String(error.message ?? error) };
  }
}

async function runCawFetch(input) {
  const output = await runCaw(
    [
      "fetch",
      input.pactId,
      input.url,
      "--protocol",
      "x402",
      "--network",
      input.payment.network,
      "--asset",
      input.payment.asset,
      "--max-amount",
      input.payment.amount,
      "--output",
      "body"
    ],
    input.args,
    { allowFailure: true }
  );
  return {
    ok: output.code === 0,
    exitCode: output.code,
    outputBytes: Buffer.byteLength(output.stdout ?? "", "utf8"),
    body: summarizeFetchBody(output.stdout),
    stderr: output.code === 0 ? undefined : redact(output.stderr)
  };
}

async function runCaw(args, parsedArgs, options = {}) {
  const cawArgs = [...args];
  if (parsedArgs.apiKey) cawArgs.push("--api-key", parsedArgs.apiKey);
  if (parsedArgs.apiUrl) cawArgs.push("--api-url", parsedArgs.apiUrl);

  try {
    const { stdout, stderr } = await execFileAsync("caw", cawArgs, { maxBuffer: 1024 * 1024 });
    return { stdout, stderr, code: 0 };
  } catch (error) {
    const failure = error;
    if (options.allowFailure) {
      return {
        stdout: String(failure.stdout ?? ""),
        stderr: String(failure.stderr ?? failure.message ?? ""),
        code: typeof failure.code === "number" ? failure.code : 1
      };
    }
    throw new Error(redact(String(failure.stderr ?? failure.stdout ?? failure.message ?? error)));
  }
}

function cawPolicyScope(network, tokenSymbol) {
  if (tokenSymbol !== "USDC") throw new Error(`Unsupported CAW Pact token: ${tokenSymbol}`);
  switch (network) {
    case "eip155:84532":
      return { chainId: "TBASE_SETH", tokenId: "TBASE_SETH_USDC" };
    case "eip155:11155111":
      return { chainId: "SETH", tokenId: "SETH_USDC" };
    case "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1":
      return { chainId: "SOLDEV_SOL", tokenId: "SOLDEV_SOL_USDC" };
    default:
      throw new Error(`Unsupported CAW Pact network: ${network}`);
  }
}

function summarizeFetchBody(stdout) {
  const trimmed = String(stdout ?? "").trim();
  if (!trimmed) return { empty: true };
  try {
    const body = JSON.parse(trimmed);
    return {
      report: body.report
        ? {
            address: body.report.address,
            riskScore: body.report.riskScore,
            riskLevel: body.report.riskLevel,
            labels: body.report.labels,
            generatedAt: body.report.generatedAt,
            method: body.report.method
          }
        : undefined,
      requestFingerprint: body.requestFingerprint,
      orderId: body.orderId,
      keys: Object.keys(body).sort()
    };
  } catch {
    return { textBytes: Buffer.byteLength(trimmed, "utf8") };
  }
}

function parseJsonObject(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return {};
  return JSON.parse(trimmed);
}

function readString(value, keys) {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  }
  return undefined;
}

function readDeepString(value, keys) {
  if (!value || typeof value !== "object") return undefined;
  const direct = readString(value, keys);
  if (direct) return direct;

  for (const child of Object.values(value)) {
    if (child && typeof child === "object") {
      const nested = readDeepString(child, keys);
      if (nested) return nested;
    }
  }
  return undefined;
}

function hasCredential(value) {
  return Boolean(readDeepString(value, ["api_key", "apiKey", "credential", "pact_scoped_api_key", "pactScopedApiKey"]));
}

function summarizeJsonShape(value) {
  if (!value || typeof value !== "object") return typeof value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      child && typeof child === "object" && !Array.isArray(child) ? Object.keys(child).sort() : typeof child
    ])
  );
}

function redact(value) {
  return String(value)
    .replace(/(api[_-]?key["'=: ]+)[^"',\s]+/gi, "$1[REDACTED]")
    .replace(/(payment[_-]?signature[_-]?raw["'=: ]+)[^"',\s]+/gi, "$1[REDACTED]")
    .replace(/(payment[_-]?payload["'=: ]+)[^"',\s]+/gi, "$1[REDACTED]");
}

function writeResult(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const parsed = {
    execute: false,
    submitPact: false,
    pay: false,
    approvalTimeoutMs: 10 * 60 * 1000,
    approvalPollMs: 5000
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--execute") {
      parsed.execute = true;
    } else if (arg === "--submit-pact") {
      parsed.submitPact = true;
    } else if (arg === "--pay") {
      parsed.pay = true;
    } else if (arg === "--url") {
      parsed.url = requireValue(arg, next);
      index += 1;
    } else if (arg === "--base-url") {
      parsed.baseUrl = requireValue(arg, next);
      index += 1;
    } else if (arg === "--max-price-usdc") {
      parsed.maxPriceUsdc = requireValue(arg, next);
      index += 1;
    } else if (arg === "--expected-token") {
      parsed.expectedToken = requireValue(arg, next);
      index += 1;
    } else if (arg === "--expected-network") {
      parsed.expectedNetwork = requireValue(arg, next);
      index += 1;
    } else if (arg === "--expected-payee") {
      parsed.expectedPayee = requireValue(arg, next);
      index += 1;
    } else if (arg === "--solana-rpc-url") {
      parsed.solanaRpcUrl = requireValue(arg, next);
      index += 1;
    } else if (arg === "--approval-timeout-ms") {
      parsed.approvalTimeoutMs = Number(requireValue(arg, next));
      index += 1;
    } else if (arg === "--approval-poll-ms") {
      parsed.approvalPollMs = Number(requireValue(arg, next));
      index += 1;
    } else if (arg === "--pact-id" || arg === "--resume-pact-id") {
      parsed.pactId = requireValue(arg, next);
      index += 1;
    } else if (arg === "--api-key") {
      parsed.apiKey = requireValue(arg, next);
      index += 1;
    } else if (arg === "--api-url") {
      parsed.apiUrl = requireValue(arg, next);
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      usage();
    } else {
      usage(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function requireValue(flag, value) {
  if (!value || value.startsWith("--")) usage(`Missing value for ${flag}`);
  return value;
}

function usage(message) {
  if (message) console.error(message);
  const command = process.argv[1] ? `node ${process.argv[1]}` : "node skills/caw-x402-purchasing/scripts/purchase-with-caw-fetch.mjs";
  console.error(`Usage:
  ${command} \\
    --url 'http://localhost:4021/risk-report?address=0x...' \\
    --max-price-usdc 0.005 \\
    --expected-token USDC \\
    --expected-network <network> \\
    --expected-payee <payee> \\
    [--submit-pact | --pay --pact-id <approved-pact-id> | --execute] \\
    [--pact-id <approved-or-pending-pact-id>] \\
    [--approval-timeout-ms 600000] \\
    [--approval-poll-ms 5000]`);
  process.exit(message ? 1 : 0);
}
