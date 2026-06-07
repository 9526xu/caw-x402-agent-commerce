# CAW x402 Purchasing Skill 实施文档

状态：实施前设计稿

## 1. 项目定位

本项目定位为 **CAW-backed x402 Purchasing Skill for Agent Runtimes**。

它不是重新开发一个垂直 Agent 应用，也不是只实现一个 x402 商家服务。它的核心是给 Codex、Claude Code 或其他 Agent Runtime 提供一套可复用的购买能力：Agent 能够审查 x402 paid resource，形成购买意图，在 CAW 授权边界内执行付款，恢复或获取交付结果，并生成安全审计记录。

一句话描述：

```text
A reusable purchasing skill that lets existing agents buy single-shot x402 paid resources through Cobo Agentic Wallet, with quote review, Pact-scoped authorization, duplicate-payment protection, delivery validation, and audit evidence.
```

## 2. 核心边界

本项目分成两层：

| 层级 | 说明 |
| --- | --- |
| Purchasing Capability | 通用能力层。负责 x402 quote 审查、Purchase Intent、CAW Pact、Provider status/recovery、付款执行、交付验收和审计。 |
| Example Paid Resource | 示例资源层。本仓库使用 `/risk-report` 作为可复现的 x402 paid resource，用于证明能力闭环。 |

`risk-report` 是示例产品，不是项目的全部能力边界。

MVP 支持：

- 单次购买。
- 固定价格。
- x402 paid resource。
- 同步 JSON 返回。
- 由用户或 demo system 提供明确 resource URL。

MVP 不支持开放式资源搜索和自动比价。

## 3. 目标用户与运行环境

目标用户是希望让 Agent 安全执行资金操作的开发者、黑客松评委和 Agent operator。

目标运行环境不是新建前端，而是现有 Agent Runtime：

```text
Codex / Claude Code / other Agent Runtime
  -> reads caw-x402-purchasing skill
  -> calls helper or consumer command
  -> calls provider agent-facing API
  -> uses CAW for authorization and payment
  -> writes audit evidence
```

## 4. MVP 输入

MVP 输入由三部分组成：

1. 用户购买意图。
2. 明确的 x402 paid resource URL。
3. 预算和约束。

示例：

```text
使用 caw-x402-purchasing skill，帮我购买这个 x402 paid resource：
http://localhost:4021/risk-report?address=0x0000000000000000000000000000000000000001

预算上限：0.005 USDC
只允许 Solana Devnet USDC
只允许当前 demo provider payee
先做 quote/precheck，不要直接付款
```

## 5. Provider Capability

Agent 不能把付款当作盲目转账。它应该先识别商家提供了哪些能力，再根据当前状态决定下一步调用什么。

MVP Provider Capability 最小集合：

| Capability | 作用 |
| --- | --- |
| Manifest | 面向 Agent 描述 provider 的 paid resources、status、recovery、payment constraints。 |
| Quote | 未付款访问 paid resource，返回 x402 payment requirement。 |
| Order Status | 查询某个 purchase/order/payment 当前状态。 |
| Paid Retry / Delivery | 携带 payment proof 获取结果；已交付时返回缓存交付。 |
| Recovery | 已付未交付时，允许 Agent 尝试恢复结果或获取失败原因，而不是再次付款。 |

### 5.1 Provider Capability Manifest

MVP 新增轻量 `llms.txt` 风格能力说明：

```text
GET /llms.txt
```

示例内容方向：

```md
# Risk Report Paid Resource Provider

## Paid Resources

- GET /risk-report?address={evm_address}
  - x402: required
  - content_type: application/json
  - purchase_type: single_shot_fixed_price_json
  - delivery: risk report JSON

## Capabilities

- Quote: GET /risk-report?address={evm_address} without payment
- Status: GET /orders/{order_id} or equivalent query endpoint
- Paid Retry: GET /risk-report?address={evm_address} with PAYMENT-SIGNATURE
- Recovery: check order status before attempting another payment

## Safety Rules For Agents

- Inspect quote before payment.
- Stop if amount, token, network, payee, or resource differs from user constraints.
- If status is paid or delivered, recover instead of paying again.
- If payment evidence exists but delivery failed, stop for review.
```

该 manifest 可以先是静态或半静态 Markdown，不需要引入复杂 discovery protocol。后续可以扩展为 `/.well-known/x402-capabilities.json`。

### 5.2 Order Status Endpoint

MVP 增加轻量状态查询能力，用于 Agent 在提交 Pact 或付款前查询 provider 侧状态。

建议 endpoint：

```text
GET /orders/status?fingerprint=<requestFingerprint>
GET /orders/status?paymentId=<paymentId>
```

支持两个查询入口：

| Query | 用途 |
| --- | --- |
| `fingerprint` | 判断同一个 Purchase Intent 是否已经被该 provider 处理过。适合付款前检查。 |
| `paymentId` | 判断某个 payment proof/payment identifier 是否已经绑定到订单、支付或交付。适合 paid retry/recovery。 |

`orderId` 可以作为响应字段返回给 operator 或 audit 使用，但不作为 Agent 的第一查询入口，因为 Agent 在付款前未必知道 provider order id。

响应结构方向：

```json
{
  "status": "not_found | payment_required | paid | delivered | conflict | expired",
  "orderId": "rro_...",
  "paymentId": "pay_...",
  "requestFingerprint": "sha256:...",
  "resource": "/risk-report",
  "payment": {
    "amount": "0.005",
    "token": "USDC",
    "network": "solana:...",
    "payee": "Fxvz..."
  },
  "delivery": {
    "available": true,
    "hash": "sha256:...",
    "recovery": "paid_retry | cached_delivery | manual_review"
  },
  "agentAdvice": {
    "nextAction": "quote | submit_pact | pay | recover | use_cached_delivery | stop_for_review",
    "reason": "Already delivered; do not pay again."
  }
}
```

设计原则：

- Provider 返回事实状态和轻量建议；Agent 仍然必须执行自己的 policy check。
- 响应不返回 raw payment payload、pact-scoped key、CAW credential 或可重放 payment proof。
- 如果查询不到记录，返回 `not_found`，Agent 可以继续 quote/precheck。
- 如果状态为 `paid` 或 `delivered`，Agent 必须优先 recovery/cache，不应直接发起新付款。

## 6. Agent Decision Layer

Agent Decision Layer 根据用户意图、Provider Capability Manifest、x402 quote、Provider status、CAW/Pact 状态和历史证据决定下一步动作。

第一版状态机：

```text
requested
-> manifest_checked
-> quoted
-> provider_status_checked
-> intent_planned
-> pact_submitted
-> pact_approved
-> payment_executed
-> delivered / delivery_recovered
-> validated
-> audited
```

失败和分支：

```text
quote_mismatch -> stopped
already_paid -> recovery
already_delivered -> delivered_from_cache
payment_failed -> audit_failed
delivery_failed -> manual_review
conflict -> manual_review
```

`provider_status_checked` 必须发生在 `pact_submitted` 之前。如果 provider 或本地/CAW/链上证据显示该 purchase 已付款或可恢复，Agent 不应提交新 Pact 或发起新付款。

## 7. Purchase Intent

Purchase Intent 分为通用字段和示例资源字段。

### 7.1 通用 Purchase Intent

通用字段表达这笔购买是否被允许：

```json
{
  "resourceUrl": "http://localhost:4021/risk-report?address=0x...",
  "method": "GET",
  "purchaseType": "single_shot_fixed_price_json",
  "maxBudget": {
    "amount": "0.005",
    "token": "USDC"
  },
  "quote": {
    "amount": "0.005",
    "token": "USDC",
    "network": "solana:...",
    "payee": "Fxvz...",
    "resource": "/risk-report"
  },
  "constraints": {
    "allowedPayee": "Fxvz...",
    "allowedNetwork": "solana:...",
    "allowedToken": "USDC",
    "expiresInSeconds": 1800
  }
}
```

### 7.2 示例资源字段

`risk-report` 示例资源附加自己的业务字段和验收规则：

```json
{
  "example": "risk_report",
  "subject": {
    "type": "evm_address",
    "address": "0x..."
  },
  "validation": {
    "requiredFields": ["riskScore", "riskLevel", "labels", "generatedAt"],
    "addressMustMatch": true,
    "riskLevelAllowedValues": ["low", "medium", "high", "unknown"]
  }
}
```

Purchasing Skill 依赖通用 Purchase Intent；示例资源验收由 scenario policy profile 处理。

## 8. Policy-driven Pact Generation

CAW Pact 生成不是固定命令模板。它应该由三类输入共同决定：

```text
User intent + x402 quote + Provider Capability Manifest
```

MVP 使用 policy-driven 结构：

```text
Universal Safety Policy
+ Provider Capability Policy
+ risk_report_purchase Completion Conditions
= CAW PactSpec Draft
```

### 8.1 Universal Safety Policy

所有场景都需要：

- 限制 amount。
- 限制 token。
- 限制 network。
- 限制 payee。
- 限制有效期。
- 限制交易次数。
- 如果存在可恢复 payment/delivery evidence，禁止重复付款。
- 敏感凭证和可重放支付证明必须 redacted。

### 8.2 Provider Capability Policy

由 manifest 和 provider status 决定：

- paid resource path 必须在 manifest 中。
- status/recovery capability 如果可用，必须先调用。
- paid retry endpoint 必须匹配 manifest。
- quote 不得偏离 manifest 声明的 payment/resource constraints。

### 8.3 `risk_report_purchase` Profile

MVP 只实现一个 scenario policy profile：

- 返回目标地址必须与用户请求一致。
- 返回内容必须是 JSON。
- 必须包含 `riskScore`、`riskLevel`、`labels`、`generatedAt`。
- `riskLevel` 必须属于 `low`、`medium`、`high`、`unknown`。
- 必须存在 payment response、CAW tx evidence 或等价 settlement evidence。
- 必须写入 Audit Record。

## 9. Duplicate Payment Guard

重复支付防线不应只依赖单一来源。MVP 采用多方证据：

| Evidence | 作用 |
| --- | --- |
| Provider Order | 商家侧是否已经 accepted payment、paid、delivered、conflict、expired。 |
| Agent-side state/audit | Agent 是否已经提交 Pact、执行付款、拿到 payment evidence 或 delivery evidence。 |
| CAW evidence | Pact 状态、tx 状态、request id、payment id、recent txs。 |
| Chain evidence | transaction hash/signature，作为资金动作证明。 |

决策规则：

- 已 delivered：直接 recovery/cache，不再付款。
- 已 paid 但未 delivered：先 recovery，不再直接付款。
- 已 pact_submitted 或 approved：继续原流程，不重复提交 Pact。
- 同一 payment id 绑定不同 purchase fingerprint：标记 conflict，进入人工复核。
- quote 的 amount/token/network/payee/resource 改变：视为新 Purchase Intent，必须重新展示并重新授权。
- 本地记录缺失但 CAW/链上显示已付款：补写 evidence，停止新付款，优先 recovery。

## 10. Skill 交付形态

新增 repo-local skill：

```text
.agents/skills/caw-x402-purchasing/SKILL.md
```

Skill 内容应包含：

- 使用场景和触发条件。
- Agent workflow。
- Provider manifest 读取规则。
- quote-first / precheck-first 规则。
- Provider status/recovery 优先规则。
- Purchase Intent 和 PactSpec draft 生成规则。
- CAW 敏感信息 redaction 规则。
- Duplicate Payment Guard。
- Audit Record 要求。
- Invocation templates。

## 11. Invocation Templates

默认采用两阶段安全调用。

### 11.1 Precheck / Quote Review

只解析和校验，不付款：

```bash
npm run consumer -- \
  --precheck-only \
  --address <target_address> \
  --api <paid_resource_api> \
  --max-price-usdc <budget> \
  --expected-payee <allowed_payee> \
  --expected-token USDC \
  --expected-network <allowed_network>
```

### 11.2 Full Payment Flow

只有 quote、policy、Provider status、CAW authorization 都通过后才运行：

```bash
npm run consumer -- \
  --address <target_address> \
  --api <paid_resource_api> \
  --max-price-usdc <budget> \
  --expected-payee <allowed_payee> \
  --expected-token USDC \
  --expected-network <allowed_network>
```

第一版可以复用现有 `experiments/x402-caw-risk-report` consumer flow 作为 demo executor。后续如果要支持更多 paid resources，再泛化为通用 purchasing executor。

## 12. Helper / Executor 策略

MVP 不重写新的付款执行器。当前策略：

- Skill 规定 Agent 如何安全调用。
- 现有 consumer flow 负责实际 x402/CAW 付款闭环。
- 如有必要，补充少量 helper 做确定性动作。

候选 helper：

| Helper | 作用 |
| --- | --- |
| quote | 输入 paid resource URL，输出 x402 quote summary 和 purchase fingerprint。 |
| plan-purchase | 输入用户约束和 quote summary，输出 Purchase Intent、policy profile、allow/deny decision。 |
| record-result | 写入 Agent-side purchase state 和 Audit Record。 |

## 13. Audit Record

Audit Record 是安全摘要和可验证证据，不是原始秘密 dump。

应该记录：

- user request。
- paid resource URL。
- provider manifest summary / version。
- x402 quote summary。
- provider order/status result。
- purchase intent。
- policy profile。
- CAW Pact summary。
- duplicate payment guard decision。
- payment status。
- tx/payment response summary。
- delivery hash / result summary。
- validation result。
- stopped/manual review reason。

禁止记录：

- CAW credential。
- pact-scoped API key。
- raw payment payload。
- private key / seed phrase。
- 可重放的完整 payment proof。

## 14. Demo Provider

当前 Demo Provider 是 `experiments/x402-caw-risk-report`。

它用于提供可复现的 Example Paid Resource：

```text
GET /risk-report?address=<evm_address>
```

计划改造：

- 增加 `/llms.txt` Provider Capability Manifest。
- 增加轻量 order/status 查询能力。
- 明确 paid retry 和 recovery 语义。
- 保留现有 x402 quote、payment middleware、delivery persistence、cache/recovery、conflict handling。

## 15. Demo Interaction Pattern

演示时避免展示成手动命令 walkthrough。推荐流程：

1. 打开 Codex 或 Claude Code。
2. 确认 repo 中存在 `caw-x402-purchasing` skill。
3. 输入购买意图和约束。
4. Agent 读取 Skill 和 Provider Manifest。
5. Agent 先执行 precheck/quote review。
6. Agent 展示 quote、Provider status、Purchase Intent、Pact summary。
7. CAW Pact 获批后，Agent 执行付款。
8. Agent paid retry 或 recovery。
9. Agent 验收结果并输出 audit path。

## 16. Demo 视频脚本

建议 3-5 分钟视频分成 3 个片段。

### 片段 1：Agent 获得购买技能

- 展示 repo-local skill。
- 展示 Provider `/llms.txt`。
- 说明 Provider 是 example paid resource，核心能力是 Purchasing Skill。

### 片段 2：成功购买路径

- 用户给出 paid resource URL 和预算。
- Agent quote-first。
- Agent 生成 Purchase Intent 和 Pact summary。
- CAW Pact approval。
- Agent 付款、获取 risk report、验收、输出 audit。

### 片段 3：安全能力

根据稳定性选择 1 个或 2 个：

- over-budget / payee mismatch 被拒付。
- already delivered 直接 recovery/cache，不重复付款。
- paid but delivery failed 进入 manual review，不再自动付款。
- audit JSON 中敏感信息 redacted。

## 17. 验证标准

MVP 完成时至少验证：

- Provider `/llms.txt` 可访问，内容能指导 Agent 使用 quote/status/recovery。
- 未付款访问 paid resource 返回 x402 quote。
- precheck 能拒绝预算、payee、token、network 不匹配。
- Provider status 能表达 unpaid/paid/delivered/conflict/expired 中的关键状态。
- 已 delivered 的 purchase 不重复付款。
- 已 paid 未 delivered 时优先 recovery。
- 成功路径输出 report、payment summary、delivery validation 和 audit record。
- Audit Record 不包含敏感凭证或可重放 payment proof。

## 18. Non-goals

MVP 不做：

- 全网搜索 paid resource。
- 多 provider 比价。
- 世界杯或其他额外 paid resource。
- A2A economy。
- ERC-8183 escrow。
- autonomous trading。
- 投资、博彩或交易建议。
- refund capability。
- 浏览器 UI / dashboard。
- 动态计费。
- 订阅。
- 批量购买。
- 任意 HTML、文件下载或异步长任务交付。
- 生产级资金托管和风控系统。

## 19. Implementation Checklist

### Documentation

- [ ] 更新 README 主定位为 `CAW x402 Purchasing Skill for Agent Runtimes`。
- [ ] 将 `risk-report` 描述为 Example Paid Resource。
- [ ] 增加 Demo 视频脚本或 submission guide。

### Skill

- [ ] 新增 `.agents/skills/caw-x402-purchasing/SKILL.md`。
- [ ] 写入 Agent workflow、状态机、安全规则和 invocation templates。
- [ ] 明确敏感信息 redaction 和 quote-first 规则。

### Provider

- [ ] 新增 `/llms.txt`。
- [ ] 新增或整理 order/status 查询能力。
- [ ] 明确 recovery 行为。
- [ ] 保持已实现的 cache、paid recovery、payment id conflict、expired handling。

### Agent / Consumer

- [ ] 在 skill 中复用现有 consumer flow 作为 demo executor。
- [ ] 评估是否需要 `quote`、`plan-purchase`、`record-result` helper。
- [ ] 确认 precheck-only 和 full flow 的 invocation templates 可运行。

### Verification

- [ ] 运行 check/test。
- [ ] 验证成功路径。
- [ ] 验证至少一个拒付路径。
- [ ] 验证至少一个重复支付防线。
- [ ] 验证 audit redaction。
