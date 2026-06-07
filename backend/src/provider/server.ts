import { serve } from "@hono/node-server";
import { loadConfig } from "../shared/config.js";
import { createProviderApp } from "./routes.js";

const config = loadConfig();
const app = createProviderApp(config);

serve({ fetch: app.fetch, port: config.port });

console.log(`Provider listening on ${config.providerBaseUrl}`);
