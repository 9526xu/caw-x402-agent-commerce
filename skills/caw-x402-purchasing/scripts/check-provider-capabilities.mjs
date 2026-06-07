#!/usr/bin/env node

const args = parseArgs(process.argv.slice(2));

if (!args.baseUrl) {
  usage("Missing required --base-url");
}

if (args.fingerprint && args.paymentId) {
  usage("Use --fingerprint or --payment-id, not both");
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : "provider capability check failed"
      },
      null,
      2
    )
  );
  process.exit(1);
});

async function main() {
  const baseUrl = normalizeBaseUrl(args.baseUrl);
  const result = {
    baseUrl,
    checkedAt: new Date().toISOString(),
    manifest: await fetchManifest(baseUrl),
    status: args.fingerprint || args.paymentId ? await fetchStatus(baseUrl, args) : undefined
  };

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--base-url") {
      parsed.baseUrl = requireValue(arg, next);
      index += 1;
    } else if (arg === "--fingerprint") {
      parsed.fingerprint = requireValue(arg, next);
      index += 1;
    } else if (arg === "--payment-id") {
      parsed.paymentId = requireValue(arg, next);
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

function normalizeBaseUrl(value) {
  const url = new URL(value);
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

async function fetchManifest(baseUrl) {
  const response = await fetch(`${baseUrl}/llms.txt`, {
    headers: { accept: "text/plain" }
  });
  const body = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    contentType: response.headers.get("content-type"),
    hasPaidResource: body.includes("GET /risk-report?address={evm_address}"),
    hasRequestFingerprint: body.toLowerCase().includes("x-request-fingerprint"),
    hasStatusByFingerprint: body.includes("GET /orders/status?fingerprint={requestFingerprint}"),
    hasStatusByPaymentId: body.includes("GET /orders/status?paymentId={x402PaymentIdentifier}"),
    preview: body.split("\n").slice(0, 12).join("\n")
  };
}

async function fetchStatus(baseUrl, args) {
  const url = new URL(`${baseUrl}/orders/status`);
  if (args.fingerprint) {
    url.searchParams.set("fingerprint", args.fingerprint);
  } else {
    url.searchParams.set("paymentId", args.paymentId);
  }

  const response = await fetch(url, {
    headers: { accept: "application/json" }
  });
  const body = await response.json();
  return redactStatusBody({
    ok: response.ok,
    httpStatus: response.status,
    body
  });
}

function redactStatusBody(status) {
  const body = status.body && typeof status.body === "object" ? status.body : {};
  return {
    ok: status.ok,
    httpStatus: status.httpStatus,
    body: {
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
    }
  };
}

function usage(message) {
  if (message) {
    console.error(message);
  }
  console.error(`Usage:
  node skills/caw-x402-purchasing/scripts/check-provider-capabilities.mjs \\
    --base-url http://localhost:4021 \\
    [--fingerprint <requestFingerprint> | --payment-id <paymentId>]`);
  process.exit(message ? 1 : 0);
}
