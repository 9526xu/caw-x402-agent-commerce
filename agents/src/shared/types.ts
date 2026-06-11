export type RiskLevel = "low" | "medium" | "high" | "unknown";

export type RiskReport = {
  address: string;
  riskScore: number;
  riskLevel: RiskLevel;
  labels: string[];
  generatedAt: string;
  method: "deterministic-mock-v1";
};

export type PaymentRequirementSummary = {
  scheme: "exact";
  priceUsdc: string;
  network: string;
  tokenSymbol: string;
  payTo: string;
  resource: "/risk-report";
  expiresAt?: string;
};

export type PrecheckResult =
  | { status: "passed"; checks: string[] }
  | { status: "failed"; checks: string[]; reason: string };

export type PactAuditSummary = {
  pactId?: string;
  status: "not_created" | "submitted" | "active" | "failed" | "timeout";
  policySummary?: {
    network: string;
    tokenSymbol: string;
    payTo: string;
    maxPriceUsdc: string;
    resource: "/risk-report";
    completion: string[];
  };
  credential: "not_available" | "available_redacted";
  reason?: string;
};

export type PaymentAuditSummary =
  | {
      status: "not_attempted" | "failed" | "policy_denied";
      reason: string;
      paymentId?: string;
      cawReference?: string;
    }
  | {
      status: "submitted" | "settled";
      paymentId: string;
      paymentProof: "available_redacted";
      cawReference?: string;
      transaction?: string;
      settlement?: {
        network?: string;
        txId?: string;
        tx_id?: string;
        transaction?: string;
        payer?: string;
      };
    };

export type AuditRecord = {
  taskId: string;
  requestedAddress: string;
  api: string;
  userRequest?: {
    address: string;
    maxPriceUsdc: string;
  };
  pact?: PactAuditSummary;
  paymentRequirement?: PaymentRequirementSummary;
  precheck?: PrecheckResult;
  payment?: PaymentAuditSummary;
  report?: {
    hash: string;
    riskLevel: RiskLevel;
    generatedAt: string;
  };
  validation?: {
    status: "passed" | "failed";
    checks: string[];
    reason?: string;
  };
};
