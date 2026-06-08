export function planCawAuthorization(intent) {
  return {
    adapter: "caw",
    status: "requires_user_approval",
    createsPayment: false,
    authorizationObject: "caw_pact",
    summary: {
      resourceUrl: intent.resource.url,
      maxPriceUsdc: intent.constraints.maxPriceUsdc ?? null,
      token: intent.constraints.expectedToken ?? intent.quote.payment?.tokenSymbol ?? null,
      network: intent.constraints.expectedNetwork ?? intent.quote.payment?.network ?? null,
      payee: intent.constraints.expectedPayee ?? intent.quote.payment?.payTo ?? null,
      requestFingerprint: intent.quote.requestFingerprint ?? null
    },
    nextAction: "show_pact_summary_and_stop_for_user_approval"
  };
}
