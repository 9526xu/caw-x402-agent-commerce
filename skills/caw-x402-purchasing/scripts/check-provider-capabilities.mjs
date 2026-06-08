#!/usr/bin/env node

import { writeCliError } from "./lib/errors.mjs";
import { fetchManifest, fetchStatus, normalizeBaseUrl } from "./lib/status.mjs";

const args = parseArgs(process.argv.slice(2));

if (!args.baseUrl) {
  usage("Missing required --base-url");
}

if (args.fingerprint && args.paymentId) {
  usage("Use --fingerprint or --payment-id, not both");
}

main().catch((error) => {
  writeCliError("capability_check", error);
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
