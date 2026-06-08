import { planAuthorization } from "./adapters/index.mjs";

export function buildPurchaseIntent(input) {
  return {
    resource: input.precheck.resource,
    constraints: {
      maxPriceUsdc: input.args.maxPriceUsdc ?? null,
      expectedToken: input.args.expectedToken ?? null,
      expectedNetwork: input.args.expectedNetwork ?? null,
      expectedPayee: input.args.expectedPayee ?? null
    },
    quote: input.precheck.quote,
    status: input.precheck.status?.body ?? null,
    policy: input.precheck.policy,
    adapterOptions: input.args.adapterOptions ?? {}
  };
}

export function planPurchaseAuthorization(input) {
  if (!input.precheck.ok) {
    return {
      adapter: input.adapter,
      status: "blocked",
      createsPayment: false,
      reason: "precheck did not pass",
      nextAction: "stop_for_review"
    };
  }

  const intent = buildPurchaseIntent(input);
  return planAuthorization(input.adapter, intent);
}
