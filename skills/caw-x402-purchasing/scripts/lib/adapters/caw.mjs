export function planCawAuthorization(intent) {
  return {
    adapter: "caw",
    status: "ready_to_submit_pact_request",
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
    nextAction: "submit_pact_request_and_prompt_cobo_wallet_approval"
  };
}
