import { planCawAuthorization } from "./caw.mjs";
import { planFluxaX402V3Authorization } from "./fluxa-x402v3.mjs";

export function planAuthorization(adapterName, intent) {
  if (adapterName === "caw") {
    return planCawAuthorization(intent);
  }
  if (adapterName === "fluxa-x402v3") {
    return planFluxaX402V3Authorization(intent);
  }
  throw new Error(`Unsupported wallet adapter: ${adapterName}`);
}
