import { describe, expect, it } from "vitest";
import { precheckPaymentRequirement } from "./precheck.js";

const baseRequirement = {
  scheme: "exact" as const,
  priceUsdc: "0.005",
  network: "eip155:84532",
  tokenSymbol: "USDC",
  payTo: "0x0000000000000000000000000000000000000000",
  resource: "/risk-report" as const
};

describe("precheckPaymentRequirement", () => {
  it("passes when the payment requirement matches local policy", () => {
    expect(
      precheckPaymentRequirement({
        requirement: baseRequirement,
        maxPriceUsdc: "0.005",
        expectedPayTo: baseRequirement.payTo,
        expectedNetwork: baseRequirement.network,
        expectedTokenSymbol: baseRequirement.tokenSymbol,
        now: new Date("2026-05-31T00:00:00.000Z")
      })
    ).toEqual({
      status: "passed",
      checks: ["price", "payee", "network", "token", "resource", "expiry"]
    });
  });

  it("fails before payment when the quote exceeds budget", () => {
    expect(
      precheckPaymentRequirement({
        requirement: { ...baseRequirement, priceUsdc: "0.006" },
        maxPriceUsdc: "0.005",
        expectedPayTo: baseRequirement.payTo,
        expectedNetwork: baseRequirement.network,
        expectedTokenSymbol: baseRequirement.tokenSymbol,
        now: new Date("2026-05-31T00:00:00.000Z")
      })
    ).toEqual({
      status: "failed",
      checks: [],
      reason: "payment requirement exceeds max price"
    });
  });

  it("fails before payment when the payee does not match policy", () => {
    expect(
      precheckPaymentRequirement({
        requirement: { ...baseRequirement, payTo: "0x0000000000000000000000000000000000000002" },
        maxPriceUsdc: "0.005",
        expectedPayTo: baseRequirement.payTo,
        expectedNetwork: baseRequirement.network,
        expectedTokenSymbol: baseRequirement.tokenSymbol,
        now: new Date("2026-05-31T00:00:00.000Z")
      })
    ).toEqual({
      status: "failed",
      checks: ["price"],
      reason: "payee mismatch"
    });
  });

  it("matches EVM payees case-insensitively and Solana payees case-sensitively", () => {
    expect(
      precheckPaymentRequirement({
        requirement: { ...baseRequirement, payTo: "0xDBAB90D3A468E25ED69F54D0850D492F3C6649BD" },
        maxPriceUsdc: "0.005",
        expectedPayTo: "0xdbab90d3a468e25ed69f54d0850d492f3c6649bd",
        expectedNetwork: baseRequirement.network,
        expectedTokenSymbol: baseRequirement.tokenSymbol,
        now: new Date("2026-05-31T00:00:00.000Z")
      })
    ).toMatchObject({ status: "passed" });

    expect(
      precheckPaymentRequirement({
        requirement: {
          ...baseRequirement,
          network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
          payTo: "7kuW3nm9Yw7c3SAQEZpBsyVgNywpabJekeXjKuYt2Z4b"
        },
        maxPriceUsdc: "0.005",
        expectedPayTo: "7kuW3nm9Yw7c3SAQEZpBsyVgNywpabJekeXjKuYt2Z4B",
        expectedNetwork: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
        expectedTokenSymbol: baseRequirement.tokenSymbol,
        now: new Date("2026-05-31T00:00:00.000Z")
      })
    ).toMatchObject({ status: "failed", reason: "payee mismatch" });
  });

  it("fails before payment when token or network does not match policy", () => {
    expect(
      precheckPaymentRequirement({
        requirement: { ...baseRequirement, network: "eip155:1" },
        maxPriceUsdc: "0.005",
        expectedPayTo: baseRequirement.payTo,
        expectedNetwork: baseRequirement.network,
        expectedTokenSymbol: baseRequirement.tokenSymbol,
        now: new Date("2026-05-31T00:00:00.000Z")
      })
    ).toMatchObject({ status: "failed", reason: "network mismatch" });

    expect(
      precheckPaymentRequirement({
        requirement: { ...baseRequirement, tokenSymbol: "DAI" },
        maxPriceUsdc: "0.005",
        expectedPayTo: baseRequirement.payTo,
        expectedNetwork: baseRequirement.network,
        expectedTokenSymbol: baseRequirement.tokenSymbol,
        now: new Date("2026-05-31T00:00:00.000Z")
      })
    ).toMatchObject({ status: "failed", reason: "token mismatch" });
  });

  it("fails before payment when the payment requirement is expired", () => {
    expect(
      precheckPaymentRequirement({
        requirement: { ...baseRequirement, expiresAt: "2026-05-30T23:59:59.000Z" },
        maxPriceUsdc: "0.005",
        expectedPayTo: baseRequirement.payTo,
        expectedNetwork: baseRequirement.network,
        expectedTokenSymbol: baseRequirement.tokenSymbol,
        now: new Date("2026-05-31T00:00:00.000Z")
      })
    ).toEqual({
      status: "failed",
      checks: ["price", "payee", "network", "token", "resource"],
      reason: "payment requirement expired"
    });
  });
});
