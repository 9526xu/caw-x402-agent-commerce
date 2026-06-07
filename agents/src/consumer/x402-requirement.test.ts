import { describe, expect, it } from "vitest";
import type { PaymentRequired } from "@x402/core/types";
import { parsePaymentRequiredResponse, summarizePaymentRequirement } from "./x402-requirement.js";

describe("x402 payment requirement parsing", () => {
  it("reads the PAYMENT-REQUIRED header and summarizes the first accepted exact payment option", () => {
    const paymentRequired = paymentRequiredFixture();
    const response = new Response("{}", {
      status: 402,
      headers: {
        "PAYMENT-REQUIRED": Buffer.from(JSON.stringify(paymentRequired)).toString("base64url")
      }
    });

    const parsed = parsePaymentRequiredResponse(response);
    expect(summarizePaymentRequirement(parsed)).toEqual({
      scheme: "exact",
      priceUsdc: "0.005",
      network: "eip155:84532",
      tokenSymbol: "USDC",
      payTo: "0x0000000000000000000000000000000000000000",
      resource: "/risk-report",
      expiresAt: "2026-05-31T00:30:00.000Z"
    });
  });
});

function paymentRequiredFixture(overrides: Partial<PaymentRequired["accepts"][number]> = {}): PaymentRequired {
  return {
    x402Version: 2,
    error: "Payment required",
    resource: {
      url: "http://localhost:4021/risk-report",
      description: "On-chain address risk report",
      mimeType: "application/json"
    },
    accepts: [
      {
        scheme: "exact",
        network: "eip155:84532",
        asset: "USDC",
        amount: "5000",
        payTo: "0x0000000000000000000000000000000000000000",
        maxTimeoutSeconds: 1800,
        extra: {
          priceUsdc: "0.005",
          tokenSymbol: "USDC",
          expiresAt: "2026-05-31T00:30:00.000Z"
        },
        ...overrides
      }
    ]
  };
}
