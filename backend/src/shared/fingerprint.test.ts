import { describe, expect, it } from "vitest";
import { requestFingerprint } from "./fingerprint.js";

const basePayment = {
  scheme: "exact" as const,
  priceUsdc: "0.005",
  network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  tokenSymbol: "USDC",
  payTo: "Fxvz4gTxj2NMECVDD4XM3d5BGfMSv2mViyh4JFHh6oKk",
  resource: "/risk-report" as const
};

describe("requestFingerprint", () => {
  it("keeps Solana payees case-sensitive", () => {
    const fingerprint = requestFingerprint({
      method: "GET",
      path: "/risk-report",
      address: "0x0000000000000000000000000000000000000001",
      payment: basePayment
    });

    const lowercasedPayeeFingerprint = requestFingerprint({
      method: "GET",
      path: "/risk-report",
      address: "0x0000000000000000000000000000000000000001",
      payment: { ...basePayment, payTo: basePayment.payTo.toLowerCase() }
    });

    expect(fingerprint).not.toBe(lowercasedPayeeFingerprint);
  });

  it("normalizes EVM payees case-insensitively", () => {
    const fingerprint = requestFingerprint({
      method: "GET",
      path: "/risk-report",
      address: "0x0000000000000000000000000000000000000001",
      payment: {
        ...basePayment,
        network: "eip155:84532",
        payTo: "0xDBAB90D3A468E25ED69F54D0850D492F3C6649BD"
      }
    });

    const lowercasedPayeeFingerprint = requestFingerprint({
      method: "GET",
      path: "/risk-report",
      address: "0x0000000000000000000000000000000000000001",
      payment: {
        ...basePayment,
        network: "eip155:84532",
        payTo: "0xdbab90d3a468e25ed69f54d0850d492f3c6649bd"
      }
    });

    expect(fingerprint).toBe(lowercasedPayeeFingerprint);
  });
});
