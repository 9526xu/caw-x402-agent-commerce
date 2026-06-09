export function normalizeBaseUrl(value) {
  const url = new URL(value);
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export async function fetchManifest(baseUrl) {
  const response = await fetch(`${baseUrl}/llms.txt`, {
    headers: { accept: "text/plain" }
  });
  const body = await response.text();

  return {
    ok: response.ok,
    httpStatus: response.status,
    status: response.status,
    contentType: response.headers.get("content-type"),
    hasPaidResource: body.includes("GET /risk-report?address={evm_address}"),
    hasRequestFingerprint: body.toLowerCase().includes("x-request-fingerprint"),
    hasStatusByFingerprint: body.includes("GET /orders/status?fingerprint={requestFingerprint}"),
    hasStatusByPaymentId: body.includes("GET /orders/status?paymentId={x402PaymentIdentifier}"),
    preview: body.split("\n").slice(0, 12).join("\n")
  };
}

export async function fetchStatus(baseUrl, input) {
  const url = new URL(`${baseUrl}/orders/status`);
  if (input.fingerprint) {
    url.searchParams.set("fingerprint", input.fingerprint);
  } else if (input.paymentId) {
    url.searchParams.set("paymentId", input.paymentId);
  } else {
    throw new Error("fetchStatus requires fingerprint or paymentId");
  }

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

export async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

export function redactStatus(body) {
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
    settlement: body.settlement
      ? {
          txHash: body.settlement.txHash ?? null,
          payer: body.settlement.payer ?? null,
          settledAt: body.settlement.settledAt ?? null
        }
      : undefined,
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
