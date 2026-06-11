import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { Database as DatabaseConnection } from "better-sqlite3";
import type { PaymentRequirementSummary } from "../shared/types.js";
import { sha256Json } from "../shared/fingerprint.js";

export type RiskReportOrderRecord = {
  id: string;
  paymentId: string | null;
  requestAddress: string;
  resource: "/risk-report";
  requestFingerprint: string;
  price: string;
  network: string;
  token: string;
  payTo: string;
  status: "payment_required" | "paid" | "delivered" | "delivery_failed" | "conflict" | "expired";
  createdAt: string;
  paidAt: string | null;
  deliveredAt: string | null;
  expiresAt: string;
};

export type PaymentRecord = {
  id: string;
  orderId: string;
  paymentId: string | null;
  requestFingerprint: string;
  status: "required" | "signature_received" | "verified" | "settled" | "failed";
  price: string;
  network: string;
  token: string;
  payTo: string;
  payer: string | null;
  txHash: string | null;
  paymentRequiredPayload: string;
  paymentSignaturePayload: string | null;
  verificationResponse: string | null;
  settlementResponse: string | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
  settledAt: string | null;
};

export type RequiredPaymentLifecycle = {
  order: RiskReportOrderRecord;
  payment: PaymentRecord;
};

export type ReportDeliveryRecord = {
  id: string;
  orderId: string;
  paymentId: string | null;
  requestFingerprint: string;
  responseBody: string;
  responseHash: string;
  deliveredAt: string;
};

export type ProviderStore = {
  ensureRequiredPayment(input: {
    address: string;
    requestFingerprint: string;
    payment: PaymentRequirementSummary;
    paymentRequiredPayload: unknown;
    now?: Date;
  }): RequiredPaymentLifecycle;
  getOrderByFingerprint(requestFingerprint: string): RiskReportOrderRecord | undefined;
  getOrderByPaymentId(paymentId: string): RiskReportOrderRecord | undefined;
  getPaymentsForOrder(orderId: string): PaymentRecord[];
  bindPaymentId(input: {
    paymentId: string;
    requestFingerprint: string;
    paymentSignaturePayload: unknown;
    now?: Date;
  }): RiskReportOrderRecord;
  recordVerifiedPayment(input: {
    paymentId: string;
    requestFingerprint: string;
    verificationResponse: unknown;
    payer?: string;
    now?: Date;
  }): void;
  recordSettledDelivery(input: {
    paymentId: string;
    requestFingerprint: string;
    settlementResponse: unknown;
    txHash?: string;
    payer?: string;
    responseBody: string;
    now?: Date;
  }): ReportDeliveryRecord;
  recordSettledDeliveryByFingerprint(input: {
    requestFingerprint: string;
    settlementResponse: unknown;
    txHash?: string;
    payer?: string;
    responseBody: string;
    now?: Date;
  }): ReportDeliveryRecord;
  recordSettledPayment(input: {
    paymentId: string;
    requestFingerprint: string;
    settlementResponse: unknown;
    txHash?: string;
    payer?: string;
    now?: Date;
  }): void;
  recordSettledPaymentByFingerprint(input: {
    requestFingerprint: string;
    settlementResponse: unknown;
    txHash?: string;
    payer?: string;
    now?: Date;
  }): void;
  markConflict(paymentId: string, now?: Date): void;
  markExpired(orderId: string, now?: Date): void;
  getDeliveryForOrder(orderId: string): ReportDeliveryRecord | undefined;
  deliverPaidOrder(input: {
    orderId: string;
    paymentId: string | null;
    requestFingerprint: string;
    responseBody: unknown;
    now?: Date;
  }): ReportDeliveryRecord;
  close(): void;
};

export function createSqliteProviderStore(sqlitePath: string): ProviderStore {
  const db = new Database(sqlitePath);
  db.pragma("journal_mode = WAL");
  migrate(db);
  return new SqliteProviderStore(db);
}

class SqliteProviderStore implements ProviderStore {
  constructor(private readonly db: DatabaseConnection) {}

  ensureRequiredPayment(input: {
    address: string;
    requestFingerprint: string;
    payment: PaymentRequirementSummary;
    paymentRequiredPayload: unknown;
    now?: Date;
  }): RequiredPaymentLifecycle {
    const now = input.now ?? new Date();
    const existingOrder = this.getOrderByFingerprint(input.requestFingerprint);
    if (existingOrder) {
      const existingPayment = this.getPaymentsForOrder(existingOrder.id)[0];
      if (existingOrder.status === "expired" && !existingOrder.paymentId && existingPayment) {
        this.refreshExpiredRequiredPayment({
          orderId: existingOrder.id,
          paymentRecordId: existingPayment.id,
          paymentRequiredPayload: input.paymentRequiredPayload,
          now
        });
        return {
          order: this.getOrderByFingerprint(input.requestFingerprint) ?? existingOrder,
          payment: this.getPaymentsForOrder(existingOrder.id)[0] ?? existingPayment
        };
      }
      if (existingPayment) {
        return { order: existingOrder, payment: existingPayment };
      }
    }

    const order = existingOrder ?? createOrder(input, now);
    const paymentRecord = createPaymentRecord(order, input.paymentRequiredPayload, now);

    const transaction = this.db.transaction(() => {
      if (!existingOrder) {
        this.db
          .prepare(
            `insert into risk_report_orders (
              id, request_address, resource, request_fingerprint, price, network, token, pay_to,
              status, created_at, paid_at, delivered_at, expires_at
            ) values (
              @id, @requestAddress, @resource, @requestFingerprint, @price, @network, @token, @payTo,
              @status, @createdAt, @paidAt, @deliveredAt, @expiresAt
            )`
          )
          .run(order);
      }

      this.db
        .prepare(
          `insert into payment_records (
            id, order_id, request_fingerprint, status, price, network, token, pay_to,
            payment_required_payload, created_at, updated_at
          ) values (
            @id, @orderId, @requestFingerprint, @status, @price, @network, @token, @payTo,
            @paymentRequiredPayload, @createdAt, @updatedAt
          )`
        )
        .run(paymentRecord);
    });

    transaction();
    return { order, payment: paymentRecord };
  }

  private refreshExpiredRequiredPayment(input: {
    orderId: string;
    paymentRecordId: string;
    paymentRequiredPayload: unknown;
    now: Date;
  }): void {
    const expiresAt = new Date(input.now.getTime() + 60 * 60 * 1000).toISOString();
    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          `update risk_report_orders
           set status = 'payment_required',
               paid_at = null,
               delivered_at = null,
               expires_at = @expiresAt
           where id = @orderId`
        )
        .run({ orderId: input.orderId, expiresAt });
      this.db
        .prepare(
          `update payment_records
           set status = 'required',
               failure_reason = null,
               payment_required_payload = @paymentRequiredPayload,
               updated_at = @updatedAt,
               settled_at = null
           where id = @paymentRecordId`
        )
        .run({
          paymentRecordId: input.paymentRecordId,
          paymentRequiredPayload: JSON.stringify(input.paymentRequiredPayload),
          updatedAt: input.now.toISOString()
        });
    });

    transaction();
  }

  getOrderByFingerprint(requestFingerprint: string): RiskReportOrderRecord | undefined {
    const row = this.db
      .prepare("select * from risk_report_orders where request_fingerprint = ?")
      .get(requestFingerprint) as DbOrderRow | undefined;
    return row ? mapOrder(row) : undefined;
  }

  getOrderByPaymentId(paymentId: string): RiskReportOrderRecord | undefined {
    const row = this.db
      .prepare("select * from risk_report_orders where payment_id = ?")
      .get(paymentId) as DbOrderRow | undefined;
    return row ? mapOrder(row) : undefined;
  }

  getPaymentsForOrder(orderId: string): PaymentRecord[] {
    const rows = this.db
      .prepare("select * from payment_records where order_id = ? order by created_at asc")
      .all(orderId) as DbPaymentRow[];
    return rows.map(mapPayment);
  }

  bindPaymentId(input: {
    paymentId: string;
    requestFingerprint: string;
    paymentSignaturePayload: unknown;
    now?: Date;
  }): RiskReportOrderRecord {
    const now = input.now ?? new Date();
    const order = this.getOrderByFingerprint(input.requestFingerprint);
    if (!order) {
      throw new Error("payment order is missing");
    }

    this.db
      .prepare(
        `update risk_report_orders
         set payment_id = coalesce(payment_id, @paymentId)
         where id = @orderId`
      )
      .run({ paymentId: input.paymentId, orderId: order.id });
    this.db
      .prepare(
        `update payment_records
         set payment_id = @paymentId,
             status = 'signature_received',
             payment_signature_payload = @paymentSignaturePayload,
             updated_at = @updatedAt
         where order_id = @orderId`
      )
      .run({
        paymentId: input.paymentId,
        paymentSignaturePayload: JSON.stringify(input.paymentSignaturePayload),
        updatedAt: now.toISOString(),
        orderId: order.id
      });

    return this.getOrderByFingerprint(input.requestFingerprint) ?? order;
  }

  recordVerifiedPayment(input: {
    paymentId: string;
    requestFingerprint: string;
    verificationResponse: unknown;
    payer?: string;
    now?: Date;
  }): void {
    const now = input.now ?? new Date();
    this.db
      .prepare(
        `update payment_records
         set status = 'verified',
             payer = coalesce(@payer, payer),
             verification_response = @verificationResponse,
             updated_at = @updatedAt
         where payment_id = @paymentId and request_fingerprint = @requestFingerprint`
      )
      .run({
        paymentId: input.paymentId,
        requestFingerprint: input.requestFingerprint,
        payer: input.payer ?? null,
        verificationResponse: JSON.stringify(input.verificationResponse),
        updatedAt: now.toISOString()
      });
  }

  recordSettledDelivery(input: {
    paymentId: string;
    requestFingerprint: string;
    settlementResponse: unknown;
    txHash?: string;
    payer?: string;
    responseBody: string;
    now?: Date;
  }): ReportDeliveryRecord {
    const now = input.now ?? new Date();
    const order = this.getOrderByPaymentId(input.paymentId);
    if (!order || order.requestFingerprint !== input.requestFingerprint) {
      throw new Error("settled payment order is missing");
    }

    const delivery = createDeliveryRecord(
      {
        orderId: order.id,
        paymentId: input.paymentId,
        requestFingerprint: input.requestFingerprint,
        responseBody: input.responseBody
      },
      now
    );

    const transaction = this.db.transaction(() => {
      this.recordSettledPayment({ ...input, now });
      insertDelivery(this.db, delivery);
      this.db
        .prepare(
          `update risk_report_orders
           set status = 'delivered',
               delivered_at = @deliveredAt
           where id = @orderId`
        )
        .run({ orderId: order.id, deliveredAt: now.toISOString() });
    });

    transaction();
    return delivery;
  }

  recordSettledDeliveryByFingerprint(input: {
    requestFingerprint: string;
    settlementResponse: unknown;
    txHash?: string;
    payer?: string;
    responseBody: string;
    now?: Date;
  }): ReportDeliveryRecord {
    const now = input.now ?? new Date();
    const order = this.getOrderByFingerprint(input.requestFingerprint);
    if (!order) {
      throw new Error("settled payment order is missing");
    }

    const delivery = createDeliveryRecord(
      {
        orderId: order.id,
        paymentId: order.paymentId,
        requestFingerprint: input.requestFingerprint,
        responseBody: input.responseBody
      },
      now
    );

    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          `update payment_records
           set status = 'settled',
               payer = coalesce(@payer, payer),
               tx_hash = @txHash,
               settlement_response = @settlementResponse,
               updated_at = @updatedAt,
               settled_at = @settledAt
           where order_id = @orderId`
        )
        .run({
          orderId: order.id,
          payer: input.payer ?? null,
          txHash: input.txHash ?? null,
          settlementResponse: JSON.stringify(input.settlementResponse),
          updatedAt: now.toISOString(),
          settledAt: now.toISOString()
        });
      insertDelivery(this.db, delivery);
      this.db
        .prepare(
          `update risk_report_orders
           set status = 'delivered',
               paid_at = coalesce(paid_at, @paidAt),
               delivered_at = @deliveredAt
           where id = @orderId`
        )
        .run({ orderId: order.id, paidAt: now.toISOString(), deliveredAt: now.toISOString() });
    });

    transaction();
    return delivery;
  }

  recordSettledPayment(input: {
    paymentId: string;
    requestFingerprint: string;
    settlementResponse: unknown;
    txHash?: string;
    payer?: string;
    now?: Date;
  }): void {
    const now = input.now ?? new Date();
    const order = this.getOrderByPaymentId(input.paymentId);
    if (!order || order.requestFingerprint !== input.requestFingerprint) {
      throw new Error("settled payment order is missing");
    }

    this.db
      .prepare(
        `update payment_records
         set status = 'settled',
             payer = coalesce(@payer, payer),
             tx_hash = @txHash,
             settlement_response = @settlementResponse,
             updated_at = @updatedAt,
             settled_at = @settledAt
         where payment_id = @paymentId and request_fingerprint = @requestFingerprint`
      )
      .run({
        paymentId: input.paymentId,
        requestFingerprint: input.requestFingerprint,
        payer: input.payer ?? null,
        txHash: input.txHash ?? null,
        settlementResponse: JSON.stringify(input.settlementResponse),
        updatedAt: now.toISOString(),
        settledAt: now.toISOString()
      });
    this.db
      .prepare(
        `update risk_report_orders
         set status = 'paid',
             paid_at = coalesce(paid_at, @paidAt)
         where id = @orderId`
      )
      .run({ orderId: order.id, paidAt: now.toISOString() });
  }

  recordSettledPaymentByFingerprint(input: {
    requestFingerprint: string;
    settlementResponse: unknown;
    txHash?: string;
    payer?: string;
    now?: Date;
  }): void {
    const now = input.now ?? new Date();
    const order = this.getOrderByFingerprint(input.requestFingerprint);
    if (!order) {
      throw new Error("settled payment order is missing");
    }

    this.db
      .prepare(
        `update payment_records
         set status = 'settled',
             payer = coalesce(@payer, payer),
             tx_hash = coalesce(@txHash, tx_hash),
             settlement_response = @settlementResponse,
             updated_at = @updatedAt,
             settled_at = @settledAt
         where request_fingerprint = @requestFingerprint`
      )
      .run({
        requestFingerprint: input.requestFingerprint,
        payer: input.payer ?? null,
        txHash: input.txHash ?? null,
        settlementResponse: JSON.stringify(input.settlementResponse),
        updatedAt: now.toISOString(),
        settledAt: now.toISOString()
      });
    this.db
      .prepare(
        `update risk_report_orders
         set status = 'paid',
             paid_at = coalesce(paid_at, @paidAt)
         where id = @orderId`
      )
      .run({ orderId: order.id, paidAt: now.toISOString() });
  }

  markConflict(paymentId: string, now: Date = new Date()): void {
    this.db
      .prepare("update risk_report_orders set status = 'conflict' where payment_id = ?")
      .run(paymentId);
    this.db
      .prepare(
        `update payment_records
         set status = 'failed', failure_reason = 'payment_id_conflict', updated_at = ?
         where payment_id = ?`
      )
      .run(now.toISOString(), paymentId);
  }

  markExpired(orderId: string, now: Date = new Date()): void {
    this.db
      .prepare("update risk_report_orders set status = 'expired' where id = ?")
      .run(orderId);
    this.db
      .prepare(
        `update payment_records
         set status = 'failed', failure_reason = 'order_expired', updated_at = ?
         where order_id = ? and status != 'settled'`
      )
      .run(now.toISOString(), orderId);
  }

  getDeliveryForOrder(orderId: string): ReportDeliveryRecord | undefined {
    const row = this.db
      .prepare("select * from report_deliveries where order_id = ? order by delivered_at desc limit 1")
      .get(orderId) as DbDeliveryRow | undefined;
    return row ? mapDelivery(row) : undefined;
  }

  deliverPaidOrder(input: {
    orderId: string;
    paymentId: string | null;
    requestFingerprint: string;
    responseBody: unknown;
    now?: Date;
  }): ReportDeliveryRecord {
    const now = input.now ?? new Date();
    const delivery = createDeliveryRecord(
      {
        orderId: input.orderId,
        paymentId: input.paymentId,
        requestFingerprint: input.requestFingerprint,
        responseBody: JSON.stringify(input.responseBody)
      },
      now
    );

    const transaction = this.db.transaction(() => {
      insertDelivery(this.db, delivery);
      this.db
        .prepare(
          `update risk_report_orders
           set status = 'delivered',
               delivered_at = @deliveredAt
           where id = @orderId`
        )
        .run({ orderId: input.orderId, deliveredAt: now.toISOString() });
    });

    transaction();
    return delivery;
  }

  close(): void {
    this.db.close();
  }
}

function migrate(db: DatabaseConnection): void {
  db.exec(`
    create table if not exists risk_report_orders (
      id text primary key,
      payment_id text,
      request_address text not null,
      resource text not null,
      request_fingerprint text not null unique,
      price text not null,
      network text not null,
      token text not null,
      pay_to text not null,
      status text not null,
      created_at text not null,
      paid_at text,
      delivered_at text,
      expires_at text not null
    );

    create table if not exists payment_records (
      id text primary key,
      order_id text not null references risk_report_orders(id),
      payment_id text,
      request_fingerprint text not null,
      status text not null,
      price text not null,
      network text not null,
      token text not null,
      pay_to text not null,
      payer text,
      tx_hash text,
      payment_required_payload text not null,
      payment_signature_payload text,
      verification_response text,
      settlement_response text,
      failure_reason text,
      created_at text not null,
      updated_at text not null,
      settled_at text
    );

    create table if not exists report_deliveries (
      id text primary key,
      order_id text not null references risk_report_orders(id),
      payment_id text,
      request_fingerprint text not null,
      response_body text not null,
      response_hash text not null,
      delivered_at text not null
    );
  `);

  addColumnIfMissing(db, "risk_report_orders", "payment_id", "text");
  addColumnIfMissing(db, "payment_records", "payment_id", "text");
  addColumnIfMissing(db, "payment_records", "payer", "text");
  addColumnIfMissing(db, "payment_records", "tx_hash", "text");
  addColumnIfMissing(db, "payment_records", "payment_signature_payload", "text");
  addColumnIfMissing(db, "payment_records", "verification_response", "text");
  addColumnIfMissing(db, "payment_records", "settlement_response", "text");
  addColumnIfMissing(db, "payment_records", "failure_reason", "text");
  addColumnIfMissing(db, "payment_records", "settled_at", "text");
  db.exec("create unique index if not exists risk_report_orders_payment_id_idx on risk_report_orders(payment_id)");
}

function addColumnIfMissing(db: DatabaseConnection, table: string, column: string, definition: string): void {
  const columns = db.prepare(`pragma table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((candidate) => candidate.name === column)) {
    db.exec(`alter table ${table} add column ${column} ${definition}`);
  }
}

function createOrder(
  input: {
    address: string;
    requestFingerprint: string;
    payment: PaymentRequirementSummary;
  },
  now: Date
): RiskReportOrderRecord {
  return {
    id: `rro_${randomUUID()}`,
    paymentId: null,
    requestAddress: input.address,
    resource: "/risk-report",
    requestFingerprint: input.requestFingerprint,
    price: input.payment.priceUsdc,
    network: input.payment.network,
    token: input.payment.tokenSymbol,
    payTo: input.payment.payTo,
    status: "payment_required",
    createdAt: now.toISOString(),
    paidAt: null,
    deliveredAt: null,
    expiresAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString()
  };
}

function createPaymentRecord(
  order: RiskReportOrderRecord,
  paymentRequiredPayload: unknown,
  now: Date
): PaymentRecord {
  return {
    id: `payrec_${randomUUID()}`,
    orderId: order.id,
    paymentId: order.paymentId,
    requestFingerprint: order.requestFingerprint,
    status: "required",
    price: order.price,
    network: order.network,
    token: order.token,
    payTo: order.payTo,
    payer: null,
    txHash: null,
    paymentRequiredPayload: JSON.stringify(paymentRequiredPayload),
    paymentSignaturePayload: null,
    verificationResponse: null,
    settlementResponse: null,
    failureReason: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    settledAt: null
  };
}

function createDeliveryRecord(
  input: {
    orderId: string;
    paymentId: string | null;
    requestFingerprint: string;
    responseBody: string;
  },
  now: Date
): ReportDeliveryRecord {
  return {
    id: `del_${randomUUID()}`,
    orderId: input.orderId,
    paymentId: input.paymentId,
    requestFingerprint: input.requestFingerprint,
    responseBody: input.responseBody,
    responseHash: sha256Json(JSON.parse(input.responseBody)),
    deliveredAt: now.toISOString()
  };
}

function insertDelivery(db: DatabaseConnection, delivery: ReportDeliveryRecord): void {
  db.prepare(
    `insert into report_deliveries (
      id, order_id, payment_id, request_fingerprint, response_body, response_hash, delivered_at
    ) values (
      @id, @orderId, @paymentId, @requestFingerprint, @responseBody, @responseHash, @deliveredAt
    )`
  ).run(delivery);
}

type DbOrderRow = {
  id: string;
  payment_id: string | null;
  request_address: string;
  resource: "/risk-report";
  request_fingerprint: string;
  price: string;
  network: string;
  token: string;
  pay_to: string;
  status: RiskReportOrderRecord["status"];
  created_at: string;
  paid_at: string | null;
  delivered_at: string | null;
  expires_at: string;
};

type DbPaymentRow = {
  id: string;
  order_id: string;
  payment_id: string | null;
  request_fingerprint: string;
  status: PaymentRecord["status"];
  price: string;
  network: string;
  token: string;
  pay_to: string;
  payer: string | null;
  tx_hash: string | null;
  payment_required_payload: string;
  payment_signature_payload: string | null;
  verification_response: string | null;
  settlement_response: string | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
  settled_at: string | null;
};

type DbDeliveryRow = {
  id: string;
  order_id: string;
  payment_id: string | null;
  request_fingerprint: string;
  response_body: string;
  response_hash: string;
  delivered_at: string;
};

function mapOrder(row: DbOrderRow): RiskReportOrderRecord {
  return {
    id: row.id,
    paymentId: row.payment_id,
    requestAddress: row.request_address,
    resource: row.resource,
    requestFingerprint: row.request_fingerprint,
    price: row.price,
    network: row.network,
    token: row.token,
    payTo: row.pay_to,
    status: row.status,
    createdAt: row.created_at,
    paidAt: row.paid_at,
    deliveredAt: row.delivered_at,
    expiresAt: row.expires_at
  };
}

function mapPayment(row: DbPaymentRow): PaymentRecord {
  return {
    id: row.id,
    orderId: row.order_id,
    paymentId: row.payment_id,
    requestFingerprint: row.request_fingerprint,
    status: row.status,
    price: row.price,
    network: row.network,
    token: row.token,
    payTo: row.pay_to,
    payer: row.payer,
    txHash: row.tx_hash,
    paymentRequiredPayload: row.payment_required_payload,
    paymentSignaturePayload: row.payment_signature_payload,
    verificationResponse: row.verification_response,
    settlementResponse: row.settlement_response,
    failureReason: row.failure_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    settledAt: row.settled_at
  };
}

function mapDelivery(row: DbDeliveryRow): ReportDeliveryRecord {
  return {
    id: row.id,
    orderId: row.order_id,
    paymentId: row.payment_id,
    requestFingerprint: row.request_fingerprint,
    responseBody: row.response_body,
    responseHash: row.response_hash,
    deliveredAt: row.delivered_at
  };
}
