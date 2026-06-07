import path from "node:path";

export type DemoConfig = {
  port: number;
  providerBaseUrl: string;
  providerPayToAddress: string;
  x402Network: string;
  x402PriceUsdc: string;
  x402TokenSymbol: string;
  x402TokenVersion: string;
  x402TokenDecimals: number;
  x402AssetAddress?: string;
  x402FacilitatorUrl: string;
  cawApiBaseUrl: string;
  cawWalletId: string;
  cawAgentCredential: string;
  sqlitePath: string;
  auditDir: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): DemoConfig {
  return {
    port: parsePort(env.PORT),
    providerBaseUrl: env.PROVIDER_BASE_URL ?? "http://localhost:4021",
    providerPayToAddress: env.PROVIDER_PAY_TO_ADDRESS ?? "Fxvz4gTxj2NMECVDD4XM3d5BGfMSv2mViyh4JFHh6oKk",
    x402Network: env.X402_NETWORK ?? "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    x402PriceUsdc: env.X402_PRICE_USDC ?? "0.005",
    x402TokenSymbol: env.X402_TOKEN_SYMBOL ?? "USDC",
    x402TokenVersion: env.X402_TOKEN_VERSION ?? "2",
    x402TokenDecimals: parseTokenDecimals(env.X402_TOKEN_DECIMALS),
    x402AssetAddress: env.X402_ASSET_ADDRESS,
    x402FacilitatorUrl: env.X402_FACILITATOR_URL ?? "https://x402.org/facilitator",
    cawApiBaseUrl: env.CAW_API_BASE_URL ?? "https://api.example.invalid",
    cawWalletId: env.CAW_WALLET_ID ?? "replace-with-wallet-id",
    cawAgentCredential: env.CAW_AGENT_CREDENTIAL ?? "replace-with-agent-credential",
    sqlitePath: path.resolve(env.SQLITE_PATH ?? "./data/risk-report-demo.sqlite"),
    auditDir: path.resolve(env.AUDIT_DIR ?? "./audits")
  };
}

function parseTokenDecimals(value: string | undefined): number {
  const decimals = Number(value ?? "6");
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error(`Invalid X402_TOKEN_DECIMALS: ${value}`);
  }
  return decimals;
}

function parsePort(value: string | undefined): number {
  const port = Number(value ?? "4021");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: ${value}`);
  }
  return port;
}
