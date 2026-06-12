const RECIPIENT_READINESS_TIMEOUT_MS = 10000;

export async function checkRecipientReadiness(payment, parsedArgs) {
  if (!payment || !payment.network?.startsWith("solana:")) {
    return { status: "not_applicable", reason: "recipient token-account readiness only applies to Solana quotes" };
  }

  if (!payment.asset || !payment.payTo) {
    return { status: "unknown", reason: "Solana quote did not include asset or payee" };
  }

  const rpcUrl = parsedArgs.solanaRpcUrl ?? defaultSolanaRpcUrl(payment.network);
  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(RECIPIENT_READINESS_TIMEOUT_MS),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTokenAccountsByOwner",
        params: [payment.payTo, { mint: payment.asset }, { encoding: "jsonParsed" }]
      })
    });
    const body = await response.json();
    const accounts = Array.isArray(body?.result?.value) ? body.result.value : [];
    return {
      status: accounts.length > 0 ? "passed" : "failed",
      network: payment.network,
      rpcUrl,
      payee: payment.payTo,
      asset: payment.asset,
      tokenAccountCount: accounts.length,
      reason:
        accounts.length > 0
          ? "Payee has a token account for the quoted Solana asset."
          : "Payee has no token account for the quoted Solana asset; x402 verify may fail with InvalidAccountData."
    };
  } catch (error) {
    const reason =
      error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
        ? `recipient readiness check timed out after ${RECIPIENT_READINESS_TIMEOUT_MS}ms`
        : error instanceof Error
          ? error.message
          : "recipient readiness check failed";
    return {
      status: "unknown",
      network: payment.network,
      rpcUrl,
      payee: payment.payTo,
      asset: payment.asset,
      reason
    };
  }
}

export function evaluatePolicy(payment, parsedArgs, recipientReadiness) {
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

  if (recipientReadiness.status === "failed" || recipientReadiness.status === "unknown") {
    checks.push("recipient_readiness");
    failures.push(recipientReadiness.reason);
  }

  return {
    status: failures.length === 0 ? "passed" : "failed",
    checks,
    failures
  };
}

function defaultSolanaRpcUrl(network) {
  if (network === "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1") {
    return "https://api.devnet.solana.com";
  }
  return "https://api.mainnet-beta.solana.com";
}

function sameAddress(left, right) {
  if (!left || !right) return false;
  if (/^0x[a-fA-F0-9]{40}$/.test(left) && /^0x[a-fA-F0-9]{40}$/.test(right)) {
    return left.toLowerCase() === right.toLowerCase();
  }
  return left === right;
}
