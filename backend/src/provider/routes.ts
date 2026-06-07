import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import type { DemoConfig } from "../shared/config.js";
import { requestFingerprint } from "../shared/fingerprint.js";
import { generateRiskReport } from "./report.js";
import { normalizeEvmAddress } from "./schema.js";
import { dbPlan } from "./db.js";
import type { ProviderStore, RiskReportOrderRecord } from "./store.js";
import { createSqliteProviderStore } from "./store.js";
import {
  createX402PaymentMiddleware,
  describeX402Boundary,
  paymentIdFromHeader,
  paymentPayloadFromHeader,
  paymentRequirementFromConfig
} from "./x402.js";
import type { FacilitatorClient } from "@x402/core/server";

export function createProviderApp(
  config: DemoConfig,
  store: ProviderStore = createSqliteProviderStore(config.sqlitePath),
  options: { facilitatorClient?: FacilitatorClient; syncFacilitatorOnStart?: boolean } = {}
): Hono {
  const app = new Hono();

  app.get("/demo", (c) => {
    c.header("content-type", "text/html; charset=utf-8");
    return c.body(readDemoHtml());
  });

  app.get("/llms.txt", (c) => {
    c.header("content-type", "text/plain; charset=utf-8");
    return c.text(providerCapabilityManifest(config));
  });

  app.get("/orders/status", (c) => {
    const fingerprint = c.req.query("fingerprint");
    const paymentId = c.req.query("paymentId");

    if (!fingerprint && !paymentId) {
      return c.json({ error: "fingerprint or paymentId is required" }, 400);
    }

    if (fingerprint && paymentId) {
      return c.json({ error: "query by fingerprint or paymentId, not both" }, 400);
    }

    const order = paymentId ? store.getOrderByPaymentId(paymentId) : store.getOrderByFingerprint(fingerprint ?? "");
    if (!order) {
      return c.json(orderStatusNotFound({ fingerprint, paymentId }));
    }

    if (isExpired(order) && order.status !== "expired") {
      store.markExpired(order.id);
    }

    const currentOrder =
      paymentId && order.paymentId
        ? store.getOrderByPaymentId(order.paymentId) ?? order
        : store.getOrderByFingerprint(order.requestFingerprint) ?? order;
    const delivery = store.getDeliveryForOrder(currentOrder.id);

    return c.json(orderStatusResponse(currentOrder, delivery));
  });

  app.get("/health", (c) => {
    return c.json({
      status: "ok",
      stack: "typescript+hono+node",
      db: dbPlan(config),
      x402: describeX402Boundary()
    });
  });

  app.use("/risk-report", async (c, next) => {
    const rawAddress = c.req.query("address");
    if (!rawAddress) {
      return c.json({ error: "address is required" }, 400);
    }

    try {
      const address = normalizeEvmAddress(rawAddress);
      const payment = paymentRequirementFromConfig(config);
      const fingerprint = requestFingerprint({
        method: "GET",
        path: "/risk-report",
        address,
        payment
      });
      c.header("x-request-fingerprint", fingerprint);
      const paymentHeader = c.req.header("payment-signature") ?? c.req.header("x-payment");
      const paymentId = paymentIdFromHeader(paymentHeader);
      const existingByPaymentId = paymentId ? store.getOrderByPaymentId(paymentId) : undefined;

      if (paymentId && existingByPaymentId && existingByPaymentId.requestFingerprint !== fingerprint) {
        store.markConflict(paymentId);
        return c.json(
          {
            error: "payment_id_conflict",
            message: "The payment id is already bound to a different request fingerprint."
          },
          409
        );
      }

      if (existingByPaymentId && isExpired(existingByPaymentId)) {
        store.markExpired(existingByPaymentId.id);
        return c.json({ error: "order_expired", message: "The paid delivery cache has expired." }, 410);
      }

      if (existingByPaymentId?.status === "delivered") {
        const delivery = store.getDeliveryForOrder(existingByPaymentId.id);
        if (delivery) {
          c.header("x-risk-report-cache", "hit");
          return c.json(JSON.parse(delivery.responseBody));
        }
      }

      if (existingByPaymentId?.status === "paid") {
        const body = riskReportResponseBody(address, fingerprint, existingByPaymentId);
        store.deliverPaidOrder({
          orderId: existingByPaymentId.id,
          paymentId: paymentId ?? null,
          requestFingerprint: fingerprint,
          responseBody: body
        });
        c.header("x-risk-report-recovery", "paid-order-delivered");
        return c.json(body);
      }

      store.ensureRequiredPayment({
        address,
        requestFingerprint: fingerprint,
        payment,
        paymentRequiredPayload: payment
      });
      if (paymentId) {
        const paymentPayload = paymentPayloadFromHeader(paymentHeader);
        store.bindPaymentId({
          paymentId,
          requestFingerprint: fingerprint,
          paymentSignaturePayload: paymentPayload ?? { malformed: true }
        });
      }
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "invalid request" }, 400);
    }

    return next();
  });

  if (process.env.X402_DEBUG_PAYMENTS === "1") {
    app.use("/risk-report", async (c, next) => {
      const paymentHeader = c.req.header("payment-signature") ?? c.req.header("x-payment");
      const paymentPayload = paymentPayloadFromHeader(paymentHeader);
      await next();
      console.info("[x402] risk-report payment request", {
        hasPaymentSignature: Boolean(paymentHeader),
        payload: paymentPayload ? summarizePaymentPayload(paymentPayload) : undefined,
        responseStatus: c.res.status,
        paymentRequiredError: paymentRequiredErrorFromHeader(c.res.headers.get("payment-required")),
        hasPaymentRequired: Boolean(c.res.headers.get("payment-required")),
        hasPaymentResponse: Boolean(c.res.headers.get("payment-response"))
      });
    });
  }

  app.use("/risk-report", createX402PaymentMiddleware(config, store, options));

  app.get("/risk-report", (c) => {
    const rawAddress = c.req.query("address");
    if (!rawAddress) {
      return c.json({ error: "address is required" }, 400);
    }

    try {
      const address = normalizeEvmAddress(rawAddress);
      const payment = paymentRequirementFromConfig(config);
      const fingerprint = requestFingerprint({
        method: "GET",
        path: "/risk-report",
        address,
        payment
      });
      const lifecycle = store.ensureRequiredPayment({
        address,
        requestFingerprint: fingerprint,
        payment,
        paymentRequiredPayload: payment
      });
      return c.json(riskReportResponseBody(address, fingerprint, lifecycle.order));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "invalid request" }, 400);
    }
  });

  return app;
}

function readDemoHtml(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  return readFileSync(path.resolve(currentDir, "../../../frontend/demo.html"), "utf8");
}

function paymentRequiredErrorFromHeader(header: string | null): string | undefined {
  if (!header) return undefined;

  try {
    const decoded = JSON.parse(Buffer.from(header, "base64url").toString("utf8")) as { error?: unknown };
    return typeof decoded.error === "string" ? decoded.error : undefined;
  } catch {
    return "unreadable-payment-required-header";
  }
}

function summarizePaymentPayload(payload: ReturnType<typeof paymentPayloadFromHeader>) {
  if (!payload) return undefined;
  return {
    x402Version: payload.x402Version,
    resourceUrl: payload.resource?.url,
    acceptedScheme: payload.accepted?.scheme,
    acceptedNetwork: payload.accepted?.network,
    acceptedAmount: payload.accepted?.amount,
    acceptedAsset: payload.accepted?.asset,
    acceptedPayTo: payload.accepted?.payTo,
    extensionKeys: payload.extensions ? Object.keys(payload.extensions) : []
  };
}

function riskReportResponseBody(address: string, requestFingerprint: string, order: RiskReportOrderRecord) {
  return {
    report: generateRiskReport(address),
    requestFingerprint,
    orderId: order.id
  };
}

function providerCapabilityManifest(config: DemoConfig): string {
  const payment = paymentRequirementFromConfig(config);
  return `# CAW x402 Purchasing Skill Provider

## Provider

- name: x402 CAW Risk Report Demo Provider
- role: Example Paid Resource provider for agent runtimes
- base_url: ${config.providerBaseUrl}

## Paid Resources

- GET /risk-report?address={evm_address}
  - x402: required
  - content_type: application/json
  - purchase_type: single_shot_fixed_price_json
  - delivery: risk report JSON
  - resource: ${payment.resource}
  - amount: ${payment.priceUsdc}
  - token: ${payment.tokenSymbol}
  - network: ${payment.network}
  - payee: ${payment.payTo}

## Agent-Facing Capabilities

- Manifest: GET /llms.txt
- Quote: GET /risk-report?address={evm_address} without PAYMENT-SIGNATURE
- Quote Fingerprint: unpaid quote includes X-Request-Fingerprint
- Order Status: GET /orders/status?fingerprint={requestFingerprint}
- Payment Status: GET /orders/status?paymentId={x402PaymentIdentifier}
- Paid Retry / Delivery: GET /risk-report?address={evm_address} with PAYMENT-SIGNATURE
- Recovery: check /orders/status before any new Pact or payment
- Note: CAW tx record ids are payment evidence, but they are not Provider paymentId values unless explicitly mapped by the provider.

## Safety Rules For Agents

- Read this manifest before planning a purchase.
- Run quote/precheck before Pact submission or payment.
- Stop if amount, token, network, payee, or resource differs from user constraints.
- Query /orders/status before submitting a new Pact.
- If status is paid or delivered, recover or use cached delivery instead of paying again.
- If status is conflict, expired, or delivery_failed, stop for manual review or a fresh quote as advised.
- Never log CAW credentials, pact-scoped API keys, raw payment payloads, private keys, seed phrases, or replayable payment proofs.
`;
}

function orderStatusNotFound(input: { fingerprint?: string; paymentId?: string }) {
  return {
    status: "not_found",
    orderId: null,
    paymentId: input.paymentId ?? null,
    requestFingerprint: input.fingerprint ?? null,
    resource: "/risk-report",
    payment: null,
    delivery: {
      available: false,
      hash: null,
      recovery: "none"
    },
    agentAdvice: {
      nextAction: "quote",
      reason: "No provider order was found; run quote/precheck before Pact submission."
    }
  };
}

function orderStatusResponse(order: RiskReportOrderRecord, delivery?: { responseHash: string }) {
  const deliveryAvailable = Boolean(delivery);
  return {
    status: order.status,
    orderId: order.id,
    paymentId: order.paymentId,
    requestFingerprint: order.requestFingerprint,
    resource: order.resource,
    payment: {
      amount: order.price,
      token: order.token,
      network: order.network,
      payee: order.payTo
    },
    delivery: {
      available: deliveryAvailable,
      hash: delivery?.responseHash ?? null,
      recovery: deliveryRecovery(order.status, deliveryAvailable)
    },
    agentAdvice: agentAdvice(order.status, deliveryAvailable)
  };
}

function deliveryRecovery(status: RiskReportOrderRecord["status"], deliveryAvailable: boolean): string {
  if (deliveryAvailable) return "cached_delivery";
  if (status === "paid") return "paid_retry";
  if (status === "delivered") return "cached_delivery_missing";
  if (status === "delivery_failed") return "manual_review";
  return "none";
}

function agentAdvice(status: RiskReportOrderRecord["status"], deliveryAvailable: boolean) {
  if (deliveryAvailable) {
    return {
      nextAction: "use_cached_delivery",
      reason: "Already delivered; do not pay again."
    };
  }

  if (status === "paid") {
    return {
      nextAction: "recover",
      reason: "Payment is already settled; retry delivery recovery instead of paying again."
    };
  }

  if (status === "payment_required") {
    return {
      nextAction: "submit_pact",
      reason: "Provider has a payment-required order; continue only after quote and policy checks pass."
    };
  }

  if (status === "expired") {
    return {
      nextAction: "quote",
      reason: "The provider order expired; request a fresh quote before any new authorization."
    };
  }

  return {
    nextAction: "stop_for_review",
    reason: `Provider order status is ${status}; do not issue a new payment automatically.`
  };
}

function isExpired(order: RiskReportOrderRecord, now: Date = new Date()): boolean {
  return Date.parse(order.expiresAt) <= now.getTime();
}
