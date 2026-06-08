#!/usr/bin/env node

import { writeCliError } from "./lib/errors.mjs";
import { planPurchaseAuthorization } from "./lib/authorize.mjs";
import { runPurchasePrecheck } from "./lib/precheck.mjs";

const args = parseArgs(process.argv.slice(2));

if (!args.url) {
  usage("Missing required --url");
}

main().catch((error) => {
  writeCliError("authorize", error);
  process.exit(1);
});

async function main() {
  const precheck = await runPurchasePrecheck(args);
  const authorization = planPurchaseAuthorization({
    adapter: args.walletAdapter,
    args,
    precheck
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: precheck.ok && authorization.status !== "blocked",
        stage: "authorize",
        checkedAt: new Date().toISOString(),
        precheck,
        authorization,
        nextAction: authorization.nextAction
      },
      null,
      2
    )}\n`
  );
}

function parseArgs(argv) {
  const parsed = {
    walletAdapter: "caw",
    adapterOptions: {}
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--url") {
      parsed.url = requireValue(arg, next);
      index += 1;
    } else if (arg === "--base-url") {
      parsed.baseUrl = requireValue(arg, next);
      index += 1;
    } else if (arg === "--wallet-adapter") {
      parsed.walletAdapter = requireValue(arg, next);
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
    } else if (arg === "--mandate-endpoint") {
      parsed.adapterOptions.mandateEndpoint = requireValue(arg, next);
      index += 1;
    } else if (arg === "--payment-endpoint") {
      parsed.adapterOptions.paymentEndpoint = requireValue(arg, next);
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

function usage(message) {
  if (message) {
    console.error(message);
  }
  console.error(`Usage:
  node skills/caw-x402-purchasing/scripts/authorize.mjs \\
    --url 'http://localhost:4021/risk-report?address=0x...' \\
    --max-price-usdc 0.005 \\
    [--wallet-adapter caw|fluxa-x402v3] \\
    [--expected-token USDC] \\
    [--expected-network <network>] \\
    [--expected-payee <payee>] \\
    [--solana-rpc-url https://api.devnet.solana.com] \\
    [--mandate-endpoint <url>] \\
    [--payment-endpoint <url>]`);
  process.exit(message ? 1 : 0);
}
