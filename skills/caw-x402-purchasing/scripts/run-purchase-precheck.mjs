#!/usr/bin/env node

const args = parseArgs(process.argv.slice(2));

if (!args.url) {
  usage("Missing required --url");
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        stage: "precheck",
        error: error instanceof Error ? error.message : "purchase precheck failed"
      },
      null,
      2
    )
  );
  process.exit(1);
});

async function main() {
  const resourceUrl = new URL(args.url);
  const baseUrl = args.baseUrl ? normalizeBaseUrl(args.baseUrl) : `${resourceUrl.protocol}//${resourceUrl.host}`;
  const manifest = await fetchManifest(baseUrl);
  const quote = await fetchQuote(resourceUrl);
  const status = quote.requestFingerprint ? await fetchStatus(baseUrl, quote.requestFingerprint) : undefined;
  const policy = evaluatePolicy(quote.payment, args);

  const ok = quote.httpStatus === 402 && policy.status === "passed";
  process.stdout.write(
    `${JSON.stringify(
      {
        ok,
        stage: "precheck",
        checkedAt: new Date().toISOString(),
        resource: {
          url: resourceUrl.toString(),
          method: "GET"
        },
        manifest,
        quote,
        status,
        policy,
        nextAction: nextAction({ ok, status })
      },
      null,
      2
    )}\n`
  );
}

async function fetchManifest(baseUrl) {
  const response = await fetch(`${baseUrl}/llms.txt`, {
    headers: { accept: "text/plain" }
  });
  const body = await response.text();

  return {
    ok: response.ok,
    httpStatus: response.status,
    contentType: response.headers.get("content-type"),
    hasPaidResource: body.includes("GET /risk-report?address={evm_address}"),
    hasRequestFingerprint: body.toLowerCase().includes("x-request-fingerprint"),
    hasStatusByFingerprint: body.includes("GET /orders/status?fingerprint={requestFingerprint}"),
    hasStatusByPaymentId: body.includes("GET /orders/status?paymentId={x402PaymentIdentifier}")
  };
}

async function fetchQuote(resourceUrl) {
  const response = await fetch(resourceUrl, {
    headers: { accept: "application/json" }
  });
  const bodyText = await response.text();
  const paymentRequiredHeader = response.headers.get("payment-required");
  const paymentRequired = paymentRequiredHeader ? decodeHeaderJson(paymentRequiredHeader) : undefined;
  const accepted = paymentRequired?.accepts?.[0];

  return {
    httpStatus: response.status,
    contentType: response.headers.get("content-type"),
    requestFingerprint: response.headers.get("x-request-fingerprint"),
    hasPaymentRequired: Boolean(paymentRequiredHeader),
    payment: accepted
      ? {
          scheme: accepted.scheme,
          amount: accepted.amount,
          priceUsdc: accepted.extra?.priceUsdc ?? amountToDecimal(accepted.amount, accepted.extra?.decimals ?? 6),
          tokenSymbol: accepted.extra?.tokenSymbol ?? accepted.extra?.name ?? "unknown",
          network: accepted.network,
          asset: accepted.asset,
          payTo: accepted.payTo,
          resource: normalizeResourcePath(paymentRequired?.resource?.url)
        }
      : null,
    bodySummary: summarizeBody(bodyText)
  };
}

async function fetchStatus(baseUrl, fingerprint) {
  const url = new URL(`${baseUrl}/orders/status`);
  url.searchParams.set("fingerprint", fingerprint);
  const response = await fetch(url, {
    headers: { accept: "application/json" }
  });
  const body = await safeJson(response);

  return {
    ok: response.ok,
    httpStatus: response.status,
    body: body && typeof body === "object" ? redactStatus(body) : null
  };
}

function evaluatePolicy(payment, parsedArgs) {
  const checks = [];
  const failures = [];

  if (!payment) {
    return { status: "failed", checks, failures: ["missing x402 payment requirement"] };
  }

  if (parsedArgs.maxPriceUsdc) {
    checks.push("price");
    if (Number(payment.priceUsdc) > Number(parsedArgs.maxPriceUsdc)) {
      failures.push(`price ${payment.priceUsdc} exceeds max ${parsedArgs.maxPriceUsdc}`);
    }
  }

  if (parsedArgs.expectedToken) {
    checks.push("token");
    if (payment.tokenSymbol !== parsedArgs.expectedToken) {
      failures.push(`token ${payment.tokenSymbol} did not match ${parsedArgs.expectedToken}`);
    }
  }

  if (parsedArgs.expectedNetwork) {
    checks.push("network");
    if (payment.network !== parsedArgs.expectedNetwork) {
      failures.push(`network ${payment.network} did not match ${parsedArgs.expectedNetwork}`);
    }
  }

  if (parsedArgs.expectedPayee) {
    checks.push("payee");
    if (!sameAddress(payment.payTo, parsedArgs.expectedPayee)) {
      failures.push(`payee ${payment.payTo} did not match ${parsedArgs.expectedPayee}`);
    }
  }

  return {
    status: failures.length === 0 ? "passed" : "failed",
    checks,
    failures
  };
}

function nextAction(input) {
  if (!input.ok) return "stop_for_review";
  const status = input.status?.body?.status;
  if (status === "delivered") return "use_cached_delivery";
  if (status === "paid") return "recover_delivery";
  if (status === "payment_required" || status === "not_found") return "show_quote_and_plan_pact";
  return "show_quote_and_plan_pact";
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--url") {
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
    } else if (arg === "--help" || arg === "-h") {
      usage();
    } else {
      usage(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function requireValue(flag, value) {
  if (!value || value.startsWith("--")) {
    usage(`Missing value for ${flag}`);
  }
  return value;
}

function decodeHeaderJson(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(Buffer.from(normalized, "base64").toString("utf8"));
}

function normalizeBaseUrl(value) {
  const url = new URL(value);
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function normalizeResourcePath(value) {
  if (!value || typeof value !== "string") return undefined;
  try {
    return new URL(value).pathname;
  } catch {
    return value;
  }
}

function amountToDecimal(amount, decimals) {
  if (!amount || !/^\d+$/.test(String(amount))) return undefined;
  const scale = Number(decimals);
  const padded = String(amount).padStart(scale + 1, "0");
  const whole = padded.slice(0, -scale);
  const fraction = padded.slice(-scale).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

function summarizeBody(bodyText) {
  if (!bodyText) return { empty: true };
  try {
    const body = JSON.parse(bodyText);
    if (body && typeof body === "object") {
      return {
        error: body.error,
        message: body.message
      };
    }
  } catch {
    return { textBytes: Buffer.byteLength(bodyText, "utf8") };
  }
  return { textBytes: Buffer.byteLength(bodyText, "utf8") };
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function redactStatus(body) {
  return {
    status: body.status,
    orderId: body.orderId ?? null,
    paymentId: body.paymentId ?? null,
    requestFingerprint: body.requestFingerprint ?? null,
    resource: body.resource,
    payment: body.payment
      ? {
          amount: body.payment.amount,
          token: body.payment.token,
          network: body.payment.network,
          payee: body.payment.payee
        }
      : null,
    delivery: body.delivery
      ? {
          available: Boolean(body.delivery.available),
          hash: body.delivery.hash ?? null,
          recovery: body.delivery.recovery
        }
      : null,
    agentAdvice: body.agentAdvice
      ? {
          nextAction: body.agentAdvice.nextAction,
          reason: body.agentAdvice.reason
        }
      : null
  };
}

function sameAddress(left, right) {
  if (!left || !right) return false;
  if (/^0x[a-fA-F0-9]{40}$/.test(left) && /^0x[a-fA-F0-9]{40}$/.test(right)) {
    return left.toLowerCase() === right.toLowerCase();
  }
  return left === right;
}

function usage(message) {
  if (message) {
    console.error(message);
  }
  console.error(`Usage:
  node skills/caw-x402-purchasing/scripts/run-purchase-precheck.mjs \\
    --url 'http://localhost:4021/risk-report?address=0x...' \\
    --max-price-usdc 0.005 \\
    [--expected-token USDC] \\
    [--expected-network <network>] \\
    [--expected-payee <payee>]`);
  process.exit(message ? 1 : 0);
}
