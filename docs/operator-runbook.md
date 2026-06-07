# CAW x402 Operator Runbook

用途：给人类 operator 或其他 agent 执行 `x402 + CAW` live test 时使用。

安全原则：不要打印、提交或转发 pact-scoped API key、raw `payment_signature_raw`、raw `payment_required_raw`、钱包私钥、seed phrase 或完整私有 audit JSON。

## 1. 为什么 CAW 流程没有每次弹签名

网页钱包 x402 体验通常是：

```text
用户访问付费 API
  -> 收到 402 payment requirement
  -> 钱包弹出签名/付款确认
  -> 用户逐笔确认
  -> 发送付款 proof
  -> API 返回结果
```

CAW Pact 体验不同：

```text
用户先批准 Pact
  -> Pact 定义 chain/token/payee/amount/tx count/time window
  -> agent 在 Pact 范围内执行 caw fetch
  -> CAW policy engine 自动校验
  -> 符合 policy 则自动付款并重试 API
```

所以 `caw fetch` 没有再次弹签名，并不表示没有安全边界；安全边界前移到了 Pact 批准阶段。

这也意味着 Pact 必须尽量窄：

- chain allowlist 只放本次测试链。
- token allowlist 只放本次测试 token。
- destination allowlist 只放 Provider payee。
- amount cap 等于本次价格。
- `tx_count` 设为 `1`。
- `time_elapsed` 设为短窗口，例如 `1800` 秒。

如果希望每次操作仍然需要人工批准，应在 CAW policy 中使用 `always_review` 或合适的 `review_if` 阈值，而不是让 agent 拿到一个可自动执行的宽授权。

## 2. Provider 侧的 verify / handler / settle 边界

不管是浏览器 paywall 还是 CAW `caw fetch`，第二跳 paid retry 到达 Provider 后，x402 middleware 的核心顺序都是：

```text
onBeforeVerify
  -> facilitator verify
  -> onAfterVerify / onVerifyFailure
  -> business handler
  -> onVerifiedPaymentCanceled, if handler failed
  -> onBeforeSettle
  -> facilitator settle
  -> onAfterSettle / onSettleFailure
```

理解这个顺序很重要：

- `verify` 通过不等于已经最终收款成功，它表示支付凭证和链上交易可执行性通过了校验。
- business handler 会在 `settle` 前执行，所以真实业务不能只因为 handler 生成了响应就认为已完成交付。
- `onAfterSettle` 才适合做最终收款确认、delivery 标记、发货记录和审计。
- 如果 handler 在 verify 后失败，middleware 会触发 `onVerifiedPaymentCanceled`，业务系统应在这里释放预占资源或标记订单未交付。
- 如果 settle 失败，`onSettleFailure` 应记录失败原因并触发补偿或人工排查。

可以把它类比成 TCC：verify 前后做检查和预占，settle 成功后再确认交付。但库存、订单状态机、幂等和补偿逻辑仍然要由 Provider 自己实现，x402 middleware 只是提供生命周期 hook。

## 3. Facilitator 侧要观察什么

Provider 调 Facilitator 的核心能力是：

```text
verify(paymentPayload, paymentRequirements)
settle(paymentPayload, paymentRequirements)
```

`verify` 是支付凭证校验，不是真实结算。它可能会访问链/RPC 做模拟或读取链上状态，但不会写链、不会真实转账、不会消耗真实手续费。

`settle` 才是真实链上结算。成功后应返回 transaction signature / hash。

本 demo 的 Solana Devnet exact SVM 路径里：

```text
verify:
  decode Solana transaction
  -> 检查 feePayer / TransferChecked / mint / destination ATA / amount
  -> Facilitator fee payer 补签
  -> simulateTransaction

settle:
  再 verify 一次
  -> duplicate settlement check
  -> Facilitator fee payer 签名
  -> sendTransaction
  -> confirmTransaction
```

费用承担：

- buyer / CAW wallet 支付 `0.005 USDC`。
- Facilitator 的 `feePayer` 支付 Solana transaction fee。
- quote 中的 `extra.feePayer` 是 Facilitator 代付手续费地址，不是 Provider payee。

和 EVM exact 的主要区别：

| 项 | Solana exact SVM | EVM exact |
| --- | --- | --- |
| 支付凭证 | 用户签 Solana transaction / transfer payload | 用户签 EIP-712 authorization |
| 结算动作 | 发 Solana transaction | 调 ERC-20 token contract |
| 代付方式 | Facilitator 作为 `feePayer` 补签 | Facilitator EOA 发交易并付 ETH gas |
| verify | 模拟 Solana transaction | 验 EIP-712 签名并可选模拟合约调用 |
| settle | `sendTransaction` + `confirmTransaction` | 合约调用 + receipt |

因此排障时：

- `transaction_simulation_failed` 发生在 verify 阶段，说明支付凭证或链状态还不能安全结算。
- `BlockhashNotFound` 通常是 Solana recent blockhash 过期。
- `InvalidAccountData` 常见原因是收款方 USDC ATA 不存在或状态不对。
- settle 成功后，再去看 Provider `onAfterSettle`、SQLite delivery、CAW tx、Solana Explorer。

## 4. 这次 Solana Devnet 的最小配置

| 项 | 值 |
| --- | --- |
| x402 network | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` |
| CAW chain id | `SOLDEV_SOL` |
| CAW token id | `SOLDEV_SOL_USDC` |
| USDC mint | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |
| CAW buyer address | `7kuW3nm9Yw7c3SAQEZpBsyVgNywpabJekeXjKuYt2Z4b` |
| Provider payee | `Fxvz4gTxj2NMECVDD4XM3d5BGfMSv2mViyh4JFHh6oKk` |
| Max amount | `0.005 USDC` |
| Raw amount | `5000` |

## 5. 可观察层次

### 5.1 Provider 日志

启动 Provider：

```bash
cd experiments/x402-caw-risk-report

PROVIDER_PAY_TO_ADDRESS=Fxvz4gTxj2NMECVDD4XM3d5BGfMSv2mViyh4JFHh6oKk \
X402_NETWORK=solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1 \
X402_TOKEN_SYMBOL=USDC \
X402_PRICE_USDC=0.005 \
npm run provider
```

Provider 控制台会显示启动状态和运行错误。当前 demo 没有详细 request log；如需更细粒度观察，应优先查看 x402 headers、CAW tx record 和 SQLite。

### 5.2 x402 unpaid quote

```bash
curl -i \
  -H 'Accept: application/json' \
  'http://localhost:4021/risk-report?address=0x0000000000000000000000000000000000000001'
```

检查：

- HTTP status 是 `402 Payment Required`。
- 响应中有 `PAYMENT-REQUIRED` header。
- 响应中有 `X-Request-Fingerprint` header，用它查询 Provider status，不要猜 fingerprint。
- 解码 header 后应看到 network、asset、amount、payTo。

不要把完整 `PAYMENT-REQUIRED` base64 payload 直接写入公开文档；它通常不是钱包 secret，但可能包含运行上下文，文档只记录摘要。

### 5.3 CAW dry-run

dry-run 只读取 402 challenge，不调用付款 API：

```bash
caw fetch <pact-id> \
  'http://localhost:4021/risk-report?address=0x0000000000000000000000000000000000000001' \
  --protocol x402 \
  --network solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1 \
  --asset 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU \
  --max-amount 5000 \
  --output full \
  --dry-run \
  -v
```

用它确认：

- CAW 看到了哪个 payment option。
- network 是否匹配。
- asset/mint 是否匹配。
- amount 是否在 `--max-amount` 内。

### 5.4 CAW Pact 状态与生命周期事件

查看 Pact：

```bash
caw pact show --pact-id <pact-id>
```

注意：`pact show/status` 可能输出 pact-scoped API key。只在本机看，不要复制到文档或聊天里。

查看 Pact 生命周期事件：

```bash
caw pact events --pact-id <pact-id> --limit 50
```

它用于确认：

- submitted
- approved
- activated
- completed / expired / revoked

### 5.5 真实 CAW x402 fetch

真实付款命令：

```bash
caw fetch <approved-pact-id> \
  'http://localhost:4021/risk-report?address=0x0000000000000000000000000000000000000001' \
  --protocol x402 \
  --network solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1 \
  --asset 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU \
  --max-amount 5000 \
  --output full \
  -v
```

成功时应看到：

- HTTP status `200`。
- `Payment-Response` header。
- response body 中包含 report、request fingerprint、order id。

`-v` 会增加 CLI debug 信息。不要把 verbose 输出完整贴到公开文档；先人工检查是否含 raw payment fields。

### 5.6 CAW tx list / tx get

查看最近交易：

```bash
caw tx list \
  --chain-id SOLDEV_SOL \
  --token-id SOLDEV_SOL_USDC \
  --type transfer \
  --limit 10
```

查看单笔交易：

```bash
caw tx get --tx-id <caw-tx-id>
```

或如果有 request id：

```bash
caw tx get --request-id <request-id>
```

`tx get` 会包含 status、amount、fee、policy evaluation 等信息。完整输出可能包含 raw x402 fields，不要原样提交。

注意：CAW tx id 是支付证据，不等于 Provider `/orders/status?paymentId=...` 的 `paymentId`。Provider payment id 指 x402 `payment-identifier` extension；如果 CAW 原生 x402 payload 没带这个 extension，Provider 应按 `X-Request-Fingerprint` / request fingerprint 恢复。

建议公开记录字段：

- CAW tx id
- pact id
- chain id
- token id
- amount
- src address
- dst address
- status / sub_status
- transaction signature/hash
- created_at / updated_at

### 5.7 Solana explorer

如果拿到 Solana transaction signature，可以用：

```text
https://explorer.solana.com/tx/<signature>?cluster=devnet
```

本次成功付款的 transaction signature：

```text
3F9P5SRxuwt2EKzVF5YaTeWVGW2i63ZoABqyLFwQC2z66XqrcUWAkCveDXfm9AE7Z9vssRD3XbS2nBHsvzFg7MQY
```

### 5.8 Provider SQLite

查看表：

```bash
sqlite3 data/risk-report-demo.sqlite '.tables'
```

查看 order：

```bash
sqlite3 data/risk-report-demo.sqlite \
  'select id, request_fingerprint, request_address, status, network, token, pay_to, created_at, paid_at, delivered_at from risk_report_orders order by created_at desc limit 5;'
```

查看 payment：

```bash
sqlite3 data/risk-report-demo.sqlite \
  'select id, order_id, status, network, token, pay_to, payer, tx_hash, created_at, updated_at, settled_at from payment_records order by created_at desc limit 5;'
```

查看 delivery：

```bash
sqlite3 data/risk-report-demo.sqlite \
  'select id, order_id, payment_id, request_fingerprint, response_hash, delivered_at from report_deliveries order by delivered_at desc limit 5;'
```

SQLite 只提交 schema/code，不提交 `data/*.sqlite`。

## 6. 给其他 agent 的执行流程

### 6.1 必须遵守的安全规则

其他 agent 执行前必须确认：

- 不打印 pact-scoped API key。
- 不打印 raw `payment_signature_raw`。
- 不提交 `data/`、`audits/`、`.env`。
- 不创建超过一次付款、超过 `0.005 USDC` 或超过 30 分钟的 Pact。
- 不在未 dry-run 的情况下直接真实付款。

### 6.2 执行步骤

1. 检查当前钱包和地址：

```bash
caw wallet current
caw address list
caw wallet balance --chain-id SOLDEV_SOL --limit 20
```

2. 如余额不足，领取 faucet：

```bash
caw faucet deposit \
  --address 7kuW3nm9Yw7c3SAQEZpBsyVgNywpabJekeXjKuYt2Z4b \
  --token-id SOLDEV_SOL

caw faucet deposit \
  --address 7kuW3nm9Yw7c3SAQEZpBsyVgNywpabJekeXjKuYt2Z4b \
  --token-id SOLDEV_SOL_USDC
```

3. 启动 Provider：

```bash
PROVIDER_PAY_TO_ADDRESS=Fxvz4gTxj2NMECVDD4XM3d5BGfMSv2mViyh4JFHh6oKk \
X402_NETWORK=solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1 \
X402_TOKEN_SYMBOL=USDC \
X402_PRICE_USDC=0.005 \
npm run provider
```

4. 读取 unpaid quote：

```bash
curl -i \
  -H 'Accept: application/json' \
  'http://localhost:4021/risk-report?address=0x0000000000000000000000000000000000000001'
```

5. 提交最小权限 Pact，等待用户在 CAW app 批准。

Pact policy 必须使用 CAW id：

```json
{
  "chain_in": ["SOLDEV_SOL"],
  "token_in": [{"chain_id": "SOLDEV_SOL", "token_id": "SOLDEV_SOL_USDC"}],
  "destination_address_in": [{
    "chain_id": "SOLDEV_SOL",
    "address": "Fxvz4gTxj2NMECVDD4XM3d5BGfMSv2mViyh4JFHh6oKk"
  }]
}
```

6. Pact active 后，先 dry-run：

```bash
caw fetch <pact-id> \
  'http://localhost:4021/risk-report?address=0x0000000000000000000000000000000000000001' \
  --protocol x402 \
  --network solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1 \
  --asset 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU \
  --max-amount 5000 \
  --output full \
  --dry-run
```

7. dry-run 匹配后，真实付款：

```bash
caw fetch <pact-id> \
  'http://localhost:4021/risk-report?address=0x0000000000000000000000000000000000000001' \
  --protocol x402 \
  --network solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1 \
  --asset 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU \
  --max-amount 5000 \
  --output full
```

8. 验证结果：

```bash
caw tx list --chain-id SOLDEV_SOL --token-id SOLDEV_SOL_USDC --type transfer --limit 10
sqlite3 data/risk-report-demo.sqlite 'select id, status, network, token, pay_to, paid_at, delivered_at from risk_report_orders order by created_at desc limit 5;'
sqlite3 data/risk-report-demo.sqlite 'select id, status, payer, tx_hash, settled_at from payment_records order by created_at desc limit 5;'
sqlite3 data/risk-report-demo.sqlite 'select id, order_id, response_hash, delivered_at from report_deliveries order by delivered_at desc limit 5;'
```

## 7. 失败时先看哪里

| 现象 | 优先检查 |
| --- | --- |
| Provider 启动失败 | `X402_NETWORK` 是否与注册 scheme 匹配；facilitator 是否支持该 network |
| `caw fetch --dry-run` 没有 payment option | network / asset / amount filter 是否过窄 |
| `token_not_mapped` | CAW x402 adapter 是否支持该 chain/token |
| CAW policy denial | Pact policy 的 CAW `chain_id` / `token_id` / destination / amount 是否匹配 |
| `caw fetch` 非零退出或只输出 `{}` | 先查 CAW Pact progress、`caw tx list/get` 和 Provider status，确认是否已经付款，禁止直接重试 |
| CAW tx `Success` 但 Provider 仍 402 | Provider 是否收到 paid retry；`X402_DEBUG_PAYMENTS=1` 下看 `hasPaymentSignature`、verify/settle failure、`Payment-Response`；不要把 CAW tx id 当 `/orders/status?paymentId` |
| HTTP 200 但 SQLite 没 delivery | 是否运行了包含 fingerprint fallback 的新代码；检查 provider tests |
| 看不到链上交易 | 先查 `caw tx list/get`，再用 transaction signature 打开 Solana Explorer |
