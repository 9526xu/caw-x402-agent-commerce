import { x402Client, x402HTTPClient } from "@x402/core/client";
import type { PaymentRequired, SettleResponse } from "@x402/core/types";
import { appendPaymentIdentifierToExtensions } from "@x402/extensions/payment-identifier";
import { normalizeRiskReportResource } from "../shared/payment.js";
import type { PaymentRequirementSummary } from "../shared/types.js";

export function parsePaymentRequiredResponse(response: Response): PaymentRequired {
  const client = new x402HTTPClient(new x402Client());
  return client.getPaymentRequiredResponse((name) => response.headers.get(name));
}

export function summarizePaymentRequirement(paymentRequired: PaymentRequired): PaymentRequirementSummary {
  const accepted = paymentRequired.accepts[0];
  if (!accepted) {
    throw new Error("x402 payment required response did not include accepted payment options");
  }

  return {
    scheme: accepted.scheme === "exact" ? "exact" : failUnsupportedScheme(accepted.scheme),
    priceUsdc: stringExtra(accepted.extra, "priceUsdc") ?? accepted.amount,
    network: accepted.network,
    tokenSymbol: stringExtra(accepted.extra, "tokenSymbol") ?? accepted.asset,
    payTo: accepted.payTo,
    resource: normalizeRiskReportResource(paymentRequired.resource.url),
    expiresAt: stringExtra(accepted.extra, "expiresAt")
  };
}

export function paymentRequiredWithPaymentId(paymentRequired: PaymentRequired, paymentId: string): PaymentRequired {
  return {
    ...paymentRequired,
    extensions: appendPaymentIdentifierToExtensions({ ...(paymentRequired.extensions ?? {}) }, paymentId)
  };
}

export function parsePaymentSettleResponse(response: Response): SettleResponse | undefined {
  try {
    const client = new x402HTTPClient(new x402Client());
    return client.getPaymentSettleResponse((name) => response.headers.get(name));
  } catch {
    return undefined;
  }
}

function stringExtra(extra: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = extra?.[key];
  return typeof value === "string" ? value : undefined;
}

function failUnsupportedScheme(scheme: string): never {
  throw new Error(`Unsupported x402 payment scheme: ${scheme}`);
}
