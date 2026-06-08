const DEFAULT_MANDATE_ENDPOINT = "https://walletapi.fluxapay.xyz/api/mandates/create-intent";
const DEFAULT_PAYMENT_ENDPOINT = "https://walletapi.fluxapay.xyz/api/payment/x402V3Payment";

export function planFluxaX402V3Authorization(intent) {
  return {
    adapter: "fluxa-x402v3",
    status: "requires_user_authorization",
    createsPayment: false,
    authorizationObject: "signed_intent_mandate",
    endpoints: {
      mandate: intent.adapterOptions.mandateEndpoint ?? DEFAULT_MANDATE_ENDPOINT,
      payment: intent.adapterOptions.paymentEndpoint ?? DEFAULT_PAYMENT_ENDPOINT
    },
    summary: {
      resourceUrl: intent.resource.url,
      maxPriceUsdc: intent.constraints.maxPriceUsdc ?? null,
      token: intent.constraints.expectedToken ?? intent.quote.payment?.tokenSymbol ?? null,
      network: intent.constraints.expectedNetwork ?? intent.quote.payment?.network ?? null,
      payee: intent.constraints.expectedPayee ?? intent.quote.payment?.payTo ?? null,
      requestFingerprint: intent.quote.requestFingerprint ?? null
    },
    nextAction: "create_mandate_intent_only_after_explicit_user_approval"
  };
}
