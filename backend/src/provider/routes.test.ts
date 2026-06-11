import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, type DemoConfig } from "../shared/config.js";
import { requestFingerprint } from "../shared/fingerprint.js";
import { paymentRequirementFromConfig } from "../shared/payment.js";
import type { PaymentPayload, PaymentRequired, SettleResponse } from "@x402/core/types";
import type { FacilitatorClient } from "@x402/core/server";
import { PAYMENT_IDENTIFIER } from "@x402/extensions/payment-identifier";
import { createProviderApp } from "./routes.js";
import { createSqliteProviderStore, type ProviderStore } from "./store.js";

describe("provider unpaid risk report quote path", () => {
  let tempDir: string;
  let config: DemoConfig;
  let store: ProviderStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "x402-caw-provider-"));
    config = loadConfig({
      PORT: "4021",
      PROVIDER_BASE_URL: "http://localhost:4021",
      PROVIDER_PAY_TO_ADDRESS: "0x0000000000000000000000000000000000000000",
      X402_NETWORK: "eip155:84532",
      X402_PRICE_USDC: "0.005",
      X402_TOKEN_SYMBOL: "USDC",
      X402_FACILITATOR_URL: "https://x402.org/facilitator",
      SQLITE_PATH: path.join(tempDir, "risk-report-demo.sqlite"),
      AUDIT_DIR: path.join(tempDir, "audits")
    });
    store = createSqliteProviderStore(config.sqlitePath);
  });

  afterEach(async () => {
    store.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("rejects invalid EVM addresses before creating an order", async () => {
    const app = createProviderApp(config, store, { facilitatorClient: fakeFacilitator(config).client });

    const response = await app.request("/risk-report?address=not-an-address", {
      headers: { accept: "application/json" }
    });

    expect(response.status).toBe(400);
    expect(store.getPaymentsForOrder("missing")).toEqual([]);
  });

  it("quotes a valid unpaid request without delivering the report", async () => {
    const app = createProviderApp(config, store, { facilitatorClient: fakeFacilitator(config).client });
    const address = "0x0000000000000000000000000000000000000001";
    const response = await app.request(`/risk-report?address=${address}`, {
      headers: { accept: "application/json" }
    });
    const body = (await response.json()) as Record<string, unknown>;
    expect(response.status).toBe(402);
    const paymentRequired = decodePaymentRequired(response.headers.get("payment-required"));
    const fingerprint = requestFingerprint({
      method: "GET",
      path: "/risk-report",
      address,
      payment: paymentRequirementFromConfig(config)
    });
    const order = store.getOrderByFingerprint(fingerprint);

    expect(body).toMatchObject({ error: "payment_required" });
    expect(body).not.toHaveProperty("report");
    expect(paymentRequired.resource.url).toBe(`${config.providerBaseUrl}/risk-report`);
    expect(response.headers.get("x-request-fingerprint")).toBe(fingerprint);
    expect(paymentRequired.accepts[0]).toMatchObject({
      scheme: "exact",
      network: config.x402Network,
      payTo: config.providerPayToAddress
    });
    expect(order).toMatchObject({
      requestAddress: address,
      status: "payment_required",
      requestFingerprint: fingerprint
    });
    expect(store.getPaymentsForOrder(order?.id ?? "")[0]).toMatchObject({
      status: "required",
      price: config.x402PriceUsdc,
      network: config.x402Network,
      token: config.x402TokenSymbol,
      payTo: config.providerPayToAddress
    });
    expect(existsSync(config.sqlitePath)).toBe(true);
  });

  it("serves an agent-facing provider capability manifest", async () => {
    const app = createProviderApp(config, store, { facilitatorClient: fakeFacilitator(config).client });

    const response = await app.request("/llms.txt");
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(body).toContain("# CAW x402 Purchasing Skill Provider");
    expect(body).toContain("GET /risk-report?address={evm_address}");
    expect(body).toContain("unpaid quote includes X-Request-Fingerprint");
    expect(body).toContain("GET /orders/status?fingerprint={requestFingerprint}");
    expect(body).toContain("CAW tx record ids are payment evidence");
    expect(body).toContain(`payee: ${config.providerPayToAddress}`);
  });

  it("serves the browser demo console", async () => {
    const app = createProviderApp(config, store, { facilitatorClient: fakeFacilitator(config).client });

    const response = await app.request("/demo");
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(body).toContain("CAW x402 Agent Handoff");
    expect(body).toContain("Agent invocation");
    expect(body).toContain("/risk-report");
  });

  it("reports not_found for unknown order status queries", async () => {
    const app = createProviderApp(config, store, { facilitatorClient: fakeFacilitator(config).client });

    const response = await app.request("/orders/status?fingerprint=sha256:missing");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "not_found",
      requestFingerprint: "sha256:missing",
      agentAdvice: {
        nextAction: "quote"
      }
    });
  });

  it("reports payment_required order status by request fingerprint", async () => {
    const app = createProviderApp(config, store, { facilitatorClient: fakeFacilitator(config).client });
    const address = "0x0000000000000000000000000000000000000001";
    await app.request(`/risk-report?address=${address}`, {
      headers: { accept: "application/json" }
    });
    const fingerprint = requestFingerprint({
      method: "GET",
      path: "/risk-report",
      address,
      payment: paymentRequirementFromConfig(config)
    });

    const response = await app.request(`/orders/status?fingerprint=${encodeURIComponent(fingerprint)}`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "payment_required",
      requestFingerprint: fingerprint,
      payment: {
        amount: config.x402PriceUsdc,
        token: config.x402TokenSymbol,
        network: config.x402Network,
        payee: config.providerPayToAddress
      },
      delivery: {
        available: false,
        recovery: "none"
      },
      agentAdvice: {
        nextAction: "submit_pact"
      }
    });
    expect(body.settlement).toBeUndefined();
  });

  it("uses the current browser URL for paywall paid retries", async () => {
    const app = createProviderApp(config, store, { facilitatorClient: fakeFacilitator(config).client });
    const address = "0x0000000000000000000000000000000000000001";

    const response = await app.request(`/risk-report?address=${address}`, {
      headers: { accept: "text/html", "user-agent": "Mozilla/5.0" }
    });
    const body = await response.text();

    expect(response.status).toBe(402);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(body).toContain("currentUrl: window.location.href");
    expect(body).not.toContain(`currentUrl: "${config.providerBaseUrl}/risk-report"`);
  });

  it("reuses the existing order and required payment record for the same unpaid request", async () => {
    const app = createProviderApp(config, store, { facilitatorClient: fakeFacilitator(config).client });
    const address = "0x0000000000000000000000000000000000000001";

    await app.request(`/risk-report?address=${address}`, { headers: { accept: "application/json" } });
    await app.request(`/risk-report?address=${address}`, { headers: { accept: "application/json" } });

    const fingerprint = requestFingerprint({
      method: "GET",
      path: "/risk-report",
      address,
      payment: paymentRequirementFromConfig(config)
    });
    const order = store.getOrderByFingerprint(fingerprint);
    const payments = store.getPaymentsForOrder(order?.id ?? "");

    expect(order?.status).toBe("payment_required");
    expect(payments).toHaveLength(1);
    expect(payments[0].status).toBe("required");
  });

  it("refreshes an expired unpaid order when the same request asks for a fresh quote", async () => {
    const app = createProviderApp(config, store, { facilitatorClient: fakeFacilitator(config).client });
    const address = "0x0000000000000000000000000000000000000001";
    await app.request(`/risk-report?address=${address}`, { headers: { accept: "application/json" } });
    const fingerprint = requestFingerprint({
      method: "GET",
      path: "/risk-report",
      address,
      payment: paymentRequirementFromConfig(config)
    });
    const initialOrder = store.getOrderByFingerprint(fingerprint);
    expect(initialOrder?.status).toBe("payment_required");
    store.markExpired(initialOrder?.id ?? "");

    const response = await app.request(`/risk-report?address=${address}`, { headers: { accept: "application/json" } });
    const refreshedOrder = store.getOrderByFingerprint(fingerprint);
    const payment = store.getPaymentsForOrder(refreshedOrder?.id ?? "")[0];

    expect(response.status).toBe(402);
    expect(response.headers.get("x-request-fingerprint")).toBe(fingerprint);
    expect(refreshedOrder).toMatchObject({ id: initialOrder?.id, status: "payment_required" });
    expect(Date.parse(refreshedOrder?.expiresAt ?? "")).toBeGreaterThan(Date.now());
    expect(payment).toMatchObject({ status: "required", failureReason: null });
  });

  it("settles a paid request, persists the delivered report, and returns the payment response header", async () => {
    const facilitator = fakeFacilitator(config, { verifies: true, settles: true });
    const app = createProviderApp(config, store, { facilitatorClient: facilitator.client });
    const address = "0x0000000000000000000000000000000000000001";
    const unpaid = await app.request(`/risk-report?address=${address}`, {
      headers: { accept: "application/json" }
    });
    const paymentRequired = decodePaymentRequired(unpaid.headers.get("payment-required"));
    const paymentId = "pay_paid_request_0001";

    const response = await app.request(`/risk-report?address=${address}`, {
      headers: {
        accept: "application/json",
        "payment-signature": encodePaymentPayload(paymentRequired, paymentId)
      }
    });
    const body = (await response.json()) as Record<string, { address?: string }>;
    const paymentResponse = decodePaymentResponse(response.headers.get("payment-response"));
    const fingerprint = requestFingerprint({
      method: "GET",
      path: "/risk-report",
      address,
      payment: paymentRequirementFromConfig(config)
    });
    const order = store.getOrderByPaymentId(paymentId);
    const payment = store.getPaymentsForOrder(order?.id ?? "")[0];
    const delivery = store.getDeliveryForOrder(order?.id ?? "");

    expect(response.status).toBe(200);
    expect(body.report.address).toBe(address);
    expect(paymentResponse).toMatchObject({ success: true, transaction: "0xtestsettlement" });
    expect(facilitator.verifyCalls).toBe(1);
    expect(facilitator.settleCalls).toBe(1);
    expect(order).toMatchObject({ status: "delivered", requestFingerprint: fingerprint });
    expect(payment).toMatchObject({
      paymentId,
      status: "settled",
      payer: "0x00000000000000000000000000000000000000aa",
      txHash: "0xtestsettlement"
    });
    expect(delivery).toMatchObject({ paymentId, requestFingerprint: fingerprint });
  });

  it("reports delivered status by payment id with cached delivery advice", async () => {
    const facilitator = fakeFacilitator(config, { verifies: true, settles: true });
    const app = createProviderApp(config, store, { facilitatorClient: facilitator.client });
    const address = "0x0000000000000000000000000000000000000001";
    const unpaid = await app.request(`/risk-report?address=${address}`, {
      headers: { accept: "application/json" }
    });
    const paymentRequired = decodePaymentRequired(unpaid.headers.get("payment-required"));
    const paymentId = "pay_status_delivered_0001";

    await app.request(`/risk-report?address=${address}`, {
      headers: {
        accept: "application/json",
        "payment-signature": encodePaymentPayload(paymentRequired, paymentId)
      }
    });

    const response = await app.request(`/orders/status?paymentId=${paymentId}`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "delivered",
      paymentId,
      delivery: {
        available: true,
        recovery: "cached_delivery"
      },
      agentAdvice: {
        nextAction: "use_cached_delivery"
      }
    });
    expect(body.settlement).toMatchObject({
      txId: "0xtestsettlement",
      tx_id: "0xtestsettlement",
      txHash: "0xtestsettlement",
      payer: "0x00000000000000000000000000000000000000aa"
    });
    expect(body.settlement.settledAt).toEqual(expect.any(String));
    expect(body.delivery.hash).toMatch(/^sha256:/);
  });

  it("settles and records delivery when the payment payload has no payment identifier", async () => {
    const facilitator = fakeFacilitator(config, { verifies: true, settles: true });
    const app = createProviderApp(config, store, { facilitatorClient: facilitator.client });
    const address = "0x0000000000000000000000000000000000000001";
    const unpaid = await app.request(`/risk-report?address=${address}`, {
      headers: { accept: "application/json" }
    });
    const paymentRequired = decodePaymentRequired(unpaid.headers.get("payment-required"));

    const response = await app.request(`/risk-report?address=${address}`, {
      headers: {
        accept: "application/json",
        "payment-signature": encodePaymentPayload(paymentRequired)
      }
    });
    const fingerprint = requestFingerprint({
      method: "GET",
      path: "/risk-report",
      address,
      payment: paymentRequirementFromConfig(config)
    });
    const order = store.getOrderByFingerprint(fingerprint);
    const payment = store.getPaymentsForOrder(order?.id ?? "")[0];
    const delivery = store.getDeliveryForOrder(order?.id ?? "");

    expect(response.status).toBe(200);
    expect(order).toMatchObject({ status: "delivered", requestFingerprint: fingerprint });
    expect(payment).toMatchObject({
      paymentId: null,
      status: "settled",
      payer: "0x00000000000000000000000000000000000000aa",
      txHash: "0xtestsettlement"
    });
    expect(delivery).toMatchObject({ paymentId: null, requestFingerprint: fingerprint });
  });

  it("returns agent-readable advice when paid retry verification fails", async () => {
    const facilitator = fakeFacilitator(config, {
      verifies: false,
      invalidReason: "transaction_simulation_failed",
      invalidMessage: 'Simulation failed: {"InstructionError":["2","InvalidAccountData"]}'
    });
    const app = createProviderApp(config, store, { facilitatorClient: facilitator.client });
    const address = "0x0000000000000000000000000000000000000001";
    const unpaid = await app.request(`/risk-report?address=${address}`, {
      headers: { accept: "application/json" }
    });
    const paymentRequired = decodePaymentRequired(unpaid.headers.get("payment-required"));

    const response = await app.request(`/risk-report?address=${address}`, {
      headers: {
        accept: "application/json",
        "payment-signature": encodePaymentPayload(paymentRequired)
      }
    });
    const body = await response.json();

    expect(response.status).toBe(402);
    expect(body).toMatchObject({
      error: "x402_payment_verification_failed",
      x402Error: "transaction_simulation_failed",
      agentAdvice: {
        nextAction: "stop_for_review"
      }
    });
    expect(body.agentAdvice.likelyCause).toContain("payment transaction");
    expect(body.payment.acceptedNetwork).toBe(config.x402Network);
  });

  it("returns a cached delivery for the same payment id and fingerprint without settling again", async () => {
    const facilitator = fakeFacilitator(config, { verifies: true, settles: true });
    const app = createProviderApp(config, store, { facilitatorClient: facilitator.client });
    const address = "0x0000000000000000000000000000000000000001";
    const unpaid = await app.request(`/risk-report?address=${address}`, {
      headers: { accept: "application/json" }
    });
    const paymentRequired = decodePaymentRequired(unpaid.headers.get("payment-required"));
    const paymentId = "pay_cached_request_001";
    const paymentSignature = encodePaymentPayload(paymentRequired, paymentId);

    const first = await app.request(`/risk-report?address=${address}`, {
      headers: { accept: "application/json", "payment-signature": paymentSignature }
    });
    const second = await app.request(`/risk-report?address=${address}`, {
      headers: { accept: "application/json", "payment-signature": paymentSignature }
    });
    const firstBody = await first.json();
    const secondBody = await second.json();

    expect(second.status).toBe(200);
    expect(second.headers.get("x-risk-report-cache")).toBe("hit");
    expect(secondBody).toEqual(firstBody);
    expect(facilitator.verifyCalls).toBe(1);
    expect(facilitator.settleCalls).toBe(1);
  });

  it("continues delivery for a paid order that was not delivered without settling again", async () => {
    const facilitator = fakeFacilitator(config, { verifies: true, settles: true });
    const app = createProviderApp(config, store, { facilitatorClient: facilitator.client });
    const address = "0x0000000000000000000000000000000000000001";
    const paymentId = "pay_paid_undelivered";
    const fingerprint = requestFingerprint({
      method: "GET",
      path: "/risk-report",
      address,
      payment: paymentRequirementFromConfig(config)
    });
    store.ensureRequiredPayment({
      address,
      requestFingerprint: fingerprint,
      payment: paymentRequirementFromConfig(config),
      paymentRequiredPayload: paymentRequirementFromConfig(config)
    });
    store.bindPaymentId({
      paymentId,
      requestFingerprint: fingerprint,
      paymentSignaturePayload: { test: true }
    });
    store.recordSettledPayment({
      paymentId,
      requestFingerprint: fingerprint,
      settlementResponse: { success: true, transaction: "0xalreadysettled", network: config.x402Network },
      txHash: "0xalreadysettled"
    });

    const unpaid = await app.request(`/risk-report?address=${address}`, {
      headers: { accept: "application/json" }
    });
    const paymentRequired = decodePaymentRequired(unpaid.headers.get("payment-required"));
    const response = await app.request(`/risk-report?address=${address}`, {
      headers: {
        accept: "application/json",
        "payment-signature": encodePaymentPayload(paymentRequired, paymentId)
      }
    });
    const body = (await response.json()) as Record<string, { address?: string }>;
    const order = store.getOrderByPaymentId(paymentId);
    const delivery = store.getDeliveryForOrder(order?.id ?? "");

    expect(response.status).toBe(200);
    expect(response.headers.get("x-risk-report-recovery")).toBe("paid-order-delivered");
    expect(body.report.address).toBe(address);
    expect(delivery?.paymentId).toBe(paymentId);
    expect(store.getOrderByPaymentId(paymentId)?.status).toBe("delivered");
    expect(facilitator.verifyCalls).toBe(0);
    expect(facilitator.settleCalls).toBe(0);
  });

  it("rejects the same payment id with a different request fingerprint", async () => {
    const facilitator = fakeFacilitator(config, { verifies: true, settles: true });
    const app = createProviderApp(config, store, { facilitatorClient: facilitator.client });
    const firstAddress = "0x0000000000000000000000000000000000000001";
    const secondAddress = "0x0000000000000000000000000000000000000002";
    const unpaid = await app.request(`/risk-report?address=${firstAddress}`, {
      headers: { accept: "application/json" }
    });
    const paymentRequired = decodePaymentRequired(unpaid.headers.get("payment-required"));
    const paymentId = "pay_conflict_request";

    await app.request(`/risk-report?address=${firstAddress}`, {
      headers: { accept: "application/json", "payment-signature": encodePaymentPayload(paymentRequired, paymentId) }
    });
    const conflict = await app.request(`/risk-report?address=${secondAddress}`, {
      headers: { accept: "application/json", "payment-signature": encodePaymentPayload(paymentRequired, paymentId) }
    });
    const body = await conflict.json();

    expect(conflict.status).toBe(409);
    expect(body).toMatchObject({ error: "payment_id_conflict" });
    expect(store.getOrderByPaymentId(paymentId)?.status).toBe("conflict");
    expect(facilitator.settleCalls).toBe(1);
  });

  it("rejects an expired payment id instead of silently reusing the stale order", async () => {
    const facilitator = fakeFacilitator(config, { verifies: true, settles: true });
    const app = createProviderApp(config, store, { facilitatorClient: facilitator.client });
    const address = "0x0000000000000000000000000000000000000001";
    const paymentId = "pay_expired_request";
    const fingerprint = requestFingerprint({
      method: "GET",
      path: "/risk-report",
      address,
      payment: paymentRequirementFromConfig(config)
    });
    store.ensureRequiredPayment({
      address,
      requestFingerprint: fingerprint,
      payment: paymentRequirementFromConfig(config),
      paymentRequiredPayload: paymentRequirementFromConfig(config),
      now: new Date("2026-05-31T00:00:00.000Z")
    });
    store.bindPaymentId({
      paymentId,
      requestFingerprint: fingerprint,
      paymentSignaturePayload: { test: true },
      now: new Date("2026-05-31T00:00:01.000Z")
    });

    const unpaid = await app.request(`/risk-report?address=${address}`, {
      headers: { accept: "application/json" }
    });
    const paymentRequired = decodePaymentRequired(unpaid.headers.get("payment-required"));
    const response = await app.request(`/risk-report?address=${address}`, {
      headers: {
        accept: "application/json",
        "payment-signature": encodePaymentPayload(paymentRequired, paymentId)
      }
    });
    const body = await response.json();

    expect(response.status).toBe(410);
    expect(body).toMatchObject({ error: "order_expired" });
    expect(store.getOrderByPaymentId(paymentId)?.status).toBe("expired");
    expect(facilitator.verifyCalls).toBe(0);
    expect(facilitator.settleCalls).toBe(0);
  });
});

function decodePaymentRequired(header: string | null): PaymentRequired {
  if (!header) {
    throw new Error("missing payment-required header");
  }
  return JSON.parse(Buffer.from(header, "base64url").toString("utf8")) as PaymentRequired;
}

function decodePaymentResponse(header: string | null): SettleResponse {
  if (!header) {
    throw new Error("missing payment-response header");
  }
  return JSON.parse(Buffer.from(header, "base64url").toString("utf8")) as SettleResponse;
}

function encodePaymentPayload(paymentRequired: PaymentRequired, paymentId?: string): string {
  const paymentPayload: PaymentPayload = {
    x402Version: paymentRequired.x402Version,
    resource: paymentRequired.resource,
    accepted: paymentRequired.accepts[0],
    payload: { test: "signed-payment-payload" },
    extensions: paymentId
      ? {
          [PAYMENT_IDENTIFIER]: {
            info: { required: false, id: paymentId }
          }
        }
      : undefined
  };
  return Buffer.from(JSON.stringify(paymentPayload)).toString("base64url");
}

function fakeFacilitator(
  config: DemoConfig,
  behavior: { verifies?: boolean; settles?: boolean; invalidReason?: string; invalidMessage?: string } = {}
): { client: FacilitatorClient; verifyCalls: number; settleCalls: number } {
  const facilitator = {
    verifyCalls: 0,
    settleCalls: 0,
    client: {
      async getSupported() {
        return {
          kinds: [{ x402Version: 2, scheme: "exact", network: config.x402Network as `${string}:${string}` }],
          extensions: [],
          signers: {}
        };
      },
      async verify() {
        facilitator.verifyCalls += 1;
        if (behavior.verifies) {
          return { isValid: true, payer: "0x00000000000000000000000000000000000000aa" };
        }
        return {
          isValid: false,
          invalidReason: behavior.invalidReason ?? "test",
          invalidMessage: behavior.invalidMessage ?? "test facilitator does not verify"
        };
      },
      async settle() {
        facilitator.settleCalls += 1;
        if (behavior.settles) {
          return {
            success: true,
            transaction: "0xtestsettlement",
            network: config.x402Network as `${string}:${string}`,
            payer: "0x00000000000000000000000000000000000000aa"
          };
        }
        return {
          success: false,
          errorReason: "test",
          errorMessage: "test facilitator does not settle",
          transaction: "",
          network: config.x402Network as `${string}:${string}`
        };
      }
    } satisfies FacilitatorClient
  };
  return facilitator;
}
