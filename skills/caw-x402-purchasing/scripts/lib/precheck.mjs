import { evaluatePolicy, checkRecipientReadiness } from "./policy.mjs";
import { fetchQuote } from "./quote.mjs";
import { fetchManifest, fetchStatus, normalizeBaseUrl } from "./status.mjs";

export async function runPurchasePrecheck(args) {
  const resourceUrl = new URL(args.url);
  const baseUrl = args.baseUrl ? normalizeBaseUrl(args.baseUrl) : `${resourceUrl.protocol}//${resourceUrl.host}`;
  const manifest = await fetchManifest(baseUrl);
  const quote = await fetchQuote(resourceUrl);
  const status = quote.requestFingerprint ? await fetchStatus(baseUrl, { fingerprint: quote.requestFingerprint }) : undefined;
  const recipientReadiness = await checkRecipientReadiness(quote.payment, args);
  const policy = evaluatePolicy(quote.payment, args, recipientReadiness);

  const ok = quote.httpStatus === 402 && policy.status === "passed";
  return {
    ok,
    stage: "precheck",
    checkedAt: new Date().toISOString(),
    resource: {
      url: resourceUrl.toString(),
      method: "GET"
    },
    manifest,
    quote,
    status,
    recipientReadiness,
    policy,
    nextAction: nextAction({ ok, status })
  };
}

function nextAction(input) {
  if (!input.ok) return "stop_for_review";
  const status = input.status?.body?.status;
  if (status === "delivered") return "use_cached_delivery";
  if (status === "paid") return "recover_delivery";
  if (status === "payment_required" || status === "not_found") return "show_quote_and_plan_authorization";
  return "show_quote_and_plan_authorization";
}
