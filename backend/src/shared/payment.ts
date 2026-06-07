import type { DemoConfig } from "./config.js";
import type { PaymentRequirementSummary } from "./types.js";

export function paymentRequirementFromConfig(config: DemoConfig): PaymentRequirementSummary {
  return {
    scheme: "exact",
    priceUsdc: config.x402PriceUsdc,
    network: config.x402Network,
    tokenSymbol: config.x402TokenSymbol,
    payTo: config.providerPayToAddress,
    resource: "/risk-report"
  };
}

export function normalizeRiskReportResource(resourceUrl: string): "/risk-report" {
  const path = resourceUrl.startsWith("http")
    ? new URL(resourceUrl).pathname
    : resourceUrl.split("?")[0];

  if (path !== "/risk-report") {
    throw new Error(`Unsupported payment resource: ${resourceUrl}`);
  }
  return "/risk-report";
}
