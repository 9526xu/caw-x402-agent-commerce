export { paymentRequirementFromConfig } from "../shared/payment.js";
import { HTTPFacilitatorClient } from "@x402/core/server";
import type { FacilitatorClient, RoutesConfig } from "@x402/core/server";
import type { Network, PaymentPayload } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import {
  declarePaymentIdentifierExtension,
  extractPaymentIdentifier,
  paymentIdentifierResourceServerExtension,
  PAYMENT_IDENTIFIER
} from "@x402/extensions/payment-identifier";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { createPaywall, type PaywallProvider } from "@x402/paywall";
import { evmPaywall } from "@x402/paywall/evm";
import { svmPaywall } from "@x402/paywall/svm";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import type { MiddlewareHandler } from "hono";
import type { DemoConfig } from "../shared/config.js";
import { requestFingerprint } from "../shared/fingerprint.js";
import { paymentRequirementFromConfig } from "../shared/payment.js";
import { normalizeEvmAddress } from "./schema.js";
import type { ProviderStore } from "./store.js";

export function describeX402Boundary(): string {
  return "x402 seller middleware quotes unpaid requests, verifies signed payment payloads, settles them, and records paid deliveries server-side.";
}

export function createRiskReportPaymentRoutes(config: DemoConfig): RoutesConfig {
  const payment = paymentRequirementFromConfig(config);
  return {
    "GET /risk-report": {
      accepts: [
        {
          scheme: payment.scheme,
          price: paymentPrice(config),
          network: payment.network as Network,
          payTo: payment.payTo,
          maxTimeoutSeconds: 1800,
          extra: {
            priceUsdc: payment.priceUsdc,
            tokenSymbol: payment.tokenSymbol
          }
        }
      ],
      resource: `${config.providerBaseUrl}/risk-report`,
      description: "On-chain address risk report",
      mimeType: "application/json",
      unpaidResponseBody: () => ({
        contentType: "application/json",
        body: {
          error: "payment_required",
          message: "Payment is required before the risk report can be delivered."
        }
      }),
      extensions: {
        [PAYMENT_IDENTIFIER]: declarePaymentIdentifierExtension(false)
      }
    }
  };
}

function paymentPrice(config: DemoConfig): string | { asset: string; amount: string; extra: Record<string, string> } {
  if (!config.x402AssetAddress) {
    return `$${config.x402PriceUsdc}`;
  }

  return {
    asset: config.x402AssetAddress,
    amount: decimalToAtomicAmount(config.x402PriceUsdc, config.x402TokenDecimals),
    extra: {
      name: config.x402TokenSymbol,
      version: config.x402TokenVersion,
      priceUsdc: config.x402PriceUsdc,
      tokenSymbol: config.x402TokenSymbol
    }
  };
}

function decimalToAtomicAmount(decimalAmount: string, decimals: number): string {
  if (/[eE]/.test(decimalAmount) || !/^\d+(\.\d+)?$/.test(decimalAmount)) {
    throw new Error(`Invalid X402_PRICE_USDC: ${decimalAmount}`);
  }

  const [whole, fraction = ""] = decimalAmount.split(".");
  const atomic = `${whole}${fraction.padEnd(decimals, "0").slice(0, decimals)}`.replace(/^0+/, "");
  return atomic || "0";
}

export function createX402PaymentMiddleware(
  config: DemoConfig,
  store: ProviderStore,
  options: { facilitatorClient?: FacilitatorClient; syncFacilitatorOnStart?: boolean } = {}
): MiddlewareHandler {
  const baseFacilitatorClient =
    options.facilitatorClient ??
    new HTTPFacilitatorClient({
      url: config.x402FacilitatorUrl
    });
  const facilitatorClient =
    process.env.X402_DEBUG_PAYMENTS === "1" ? debugFacilitatorClient(baseFacilitatorClient) : baseFacilitatorClient;
  const resourceServer = new x402ResourceServer(facilitatorClient)
    .register(config.x402Network as Network, createExactScheme(config.x402Network))
    .registerExtension(paymentIdentifierResourceServerExtension)
    .onAfterVerify(async (context) => {
      const paymentId = extractPaymentIdentifier(context.paymentPayload as PaymentPayload);
      if (!paymentId) return;

      const order = store.getOrderByPaymentId(paymentId);
      if (!order) return;

      store.recordVerifiedPayment({
        paymentId,
        requestFingerprint: order.requestFingerprint,
        verificationResponse: context.result,
        payer: context.result.payer
      });
    })
    .onVerifyFailure(async (context) => {
      console.warn("[x402] verify failed", {
        message: context.error.message,
        network: context.requirements.network,
        amount: context.requirements.amount,
        asset: context.requirements.asset,
        payTo: context.requirements.payTo
      });
    })
    .onAfterSettle(async (context) => {
      const paymentId = extractPaymentIdentifier(context.paymentPayload as PaymentPayload);
      const order = paymentId ? store.getOrderByPaymentId(paymentId) : undefined;
      const fallbackFingerprint = paymentId ? undefined : requestFingerprintFromTransportContext(config, context.transportContext);
      const requestFingerprint = order?.requestFingerprint ?? fallbackFingerprint;
      if (!requestFingerprint) return;

      const responseBody = responseBodyFromTransportContext(context.transportContext);
      if (!responseBody) return;

      if (paymentId) {
        store.recordSettledDelivery({
          paymentId,
          requestFingerprint,
          settlementResponse: context.result,
          txHash: context.result.transaction,
          payer: context.result.payer,
          responseBody
        });
        return;
      }

      store.recordSettledDeliveryByFingerprint({
        requestFingerprint,
        settlementResponse: context.result,
        txHash: context.result.transaction,
        payer: context.result.payer,
        responseBody
      });
    })
    .onSettleFailure(async (context) => {
      console.warn("[x402] settle failed", {
        message: context.error.message,
        network: context.requirements.network,
        amount: context.requirements.amount,
        asset: context.requirements.asset,
        payTo: context.requirements.payTo
      });
    });

  return paymentMiddleware(
    createRiskReportPaymentRoutes(config),
    resourceServer,
    {
      appName: "x402 CAW Risk Report",
      testnet: true
    },
    createRiskReportPaywall(),
    options.syncFacilitatorOnStart ?? true
  );
}

function debugFacilitatorClient(client: FacilitatorClient): FacilitatorClient {
  return {
    async getSupported() {
      const result = await client.getSupported();
      console.info("[x402] facilitator supported", {
        kinds: result.kinds.map((kind) => ({
          x402Version: kind.x402Version,
          scheme: kind.scheme,
          network: kind.network
        })),
        extensions: result.extensions
      });
      return result;
    },
    async verify(paymentPayload, paymentRequirements) {
      const result = await client.verify(paymentPayload, paymentRequirements);
      console.info("[x402] facilitator verify", {
        isValid: result.isValid,
        invalidReason: result.invalidReason,
        invalidMessage: result.invalidMessage,
        payer: result.payer,
        requirement: summarizePaymentRequirement(paymentRequirements)
      });
      return result;
    },
    async settle(paymentPayload, paymentRequirements) {
      const result = await client.settle(paymentPayload, paymentRequirements);
      console.info("[x402] facilitator settle", {
        success: result.success,
        errorReason: result.errorReason,
        errorMessage: result.errorMessage,
        payer: result.payer,
        transaction: result.transaction,
        requirement: summarizePaymentRequirement(paymentRequirements)
      });
      return result;
    }
  };
}

function summarizePaymentRequirement(requirements: { network: string; amount?: string; asset?: string; payTo?: string }) {
  return {
    network: requirements.network,
    amount: requirements.amount,
    asset: requirements.asset,
    payTo: requirements.payTo
  };
}

function createRiskReportPaywall(): PaywallProvider {
  const paywall = createPaywall().withNetwork(evmPaywall).withNetwork(svmPaywall).build();
  return {
    generateHtml(paymentRequired, config) {
      return paywall
        .generateHtml(paymentRequired, config)
        .replace(/currentUrl:\s*"[^"]*"/, "currentUrl: window.location.href");
    }
  };
}

function createExactScheme(network: string): ExactEvmScheme | ExactSvmScheme {
  if (network.startsWith("solana:")) {
    return new ExactSvmScheme();
  }

  if (network.startsWith("eip155:")) {
    return new ExactEvmScheme();
  }

  throw new Error(`Unsupported X402_NETWORK for exact scheme: ${network}`);
}

export function paymentPayloadFromHeader(header: string | undefined): PaymentPayload | undefined {
  if (!header) return undefined;

  try {
    return JSON.parse(Buffer.from(header, "base64url").toString("utf8")) as PaymentPayload;
  } catch {
    return undefined;
  }
}

export function paymentIdFromHeader(header: string | undefined): string | undefined {
  const payload = paymentPayloadFromHeader(header);
  if (!payload) return undefined;
  return extractPaymentIdentifier(payload) ?? undefined;
}

function responseBodyFromTransportContext(context: unknown): string | undefined {
  if (!context || typeof context !== "object" || !("responseBody" in context)) {
    return undefined;
  }

  const responseBody = (context as { responseBody?: unknown }).responseBody;
  if (Buffer.isBuffer(responseBody)) {
    return responseBody.toString("utf8");
  }
  if (responseBody instanceof Uint8Array) {
    return Buffer.from(responseBody).toString("utf8");
  }
  if (typeof responseBody === "string") {
    return responseBody;
  }
  return undefined;
}

function requestFingerprintFromTransportContext(config: DemoConfig, context: unknown): string | undefined {
  const adapter = requestAdapterFromTransportContext(context);
  const rawAddress = adapter?.getQueryParam?.("address");
  const addressValue = Array.isArray(rawAddress) ? rawAddress[0] : rawAddress;
  if (!addressValue) return undefined;

  const address = normalizeEvmAddress(addressValue);
  return requestFingerprint({
    method: "GET",
    path: "/risk-report",
    address,
    payment: paymentRequirementFromConfig(config)
  });
}

function requestAdapterFromTransportContext(
  context: unknown
): { getQueryParam?: (name: string) => string | string[] | undefined } | undefined {
  if (!context || typeof context !== "object" || !("request" in context)) {
    return undefined;
  }

  const request = (context as { request?: unknown }).request;
  if (!request || typeof request !== "object" || !("adapter" in request)) {
    return undefined;
  }

  const adapter = (request as { adapter?: unknown }).adapter;
  if (!adapter || typeof adapter !== "object") {
    return undefined;
  }

  return adapter as { getQueryParam?: (name: string) => string | string[] | undefined };
}
