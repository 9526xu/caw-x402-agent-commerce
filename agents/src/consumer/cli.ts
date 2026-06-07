import { loadConfig } from "../shared/config.js";
import { runConsumerTask } from "./task.js";

type CliArgs = {
  address: string;
  apiUrl?: string;
  maxPriceUsdc: string;
  expectedPayTo?: string;
  expectedNetwork?: string;
  expectedTokenSymbol?: string;
  expectedResource: "/risk-report";
  precheckOnly: boolean;
};

async function main(): Promise<void> {
  const config = loadConfig();
  const args = parseArgs(process.argv.slice(2));
  const result = await runConsumerTask(
    {
      address: args.address,
      apiUrl: args.apiUrl,
      maxPriceUsdc: args.maxPriceUsdc,
      expectedPayTo: args.expectedPayTo ?? config.providerPayToAddress,
      expectedNetwork: args.expectedNetwork ?? config.x402Network,
      expectedTokenSymbol: args.expectedTokenSymbol ?? config.x402TokenSymbol,
      expectedResource: args.expectedResource
    },
    { config, precheckOnly: args.precheckOnly }
  );

  console.log(JSON.stringify(result, null, 2));
  if (result.precheck.status === "failed" || (result.status && result.status !== "succeeded")) {
    process.exitCode = 2;
  }
}

function parseArgs(args: string[]): CliArgs {
  const address = readOption(args, "--address");
  if (!address) {
    throw new Error("Missing required --address");
  }
  return {
    address,
    apiUrl: readOption(args, "--api"),
    maxPriceUsdc: readOption(args, "--max-price-usdc") ?? "0.005",
    expectedPayTo: readOption(args, "--expected-payee"),
    expectedNetwork: readOption(args, "--expected-network"),
    expectedTokenSymbol: readOption(args, "--expected-token"),
    expectedResource: "/risk-report",
    precheckOnly: args.includes("--precheck-only")
  };
}

function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
