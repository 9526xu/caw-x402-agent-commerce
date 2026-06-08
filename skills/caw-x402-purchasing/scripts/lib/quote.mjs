export async function fetchQuote(resourceUrl) {
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

function decodeHeaderJson(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(Buffer.from(normalized, "base64").toString("utf8"));
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
