# 黑客松提交检查清单

本文是提交前给项目 owner / reviewer 使用的中文入口。公开仓库可以继续保留英文 README；中文 review 优先看本文件、`README.zh-CN.md` 和 `docs/design/project-brief.md`。

## 一句话项目定位

`caw-x402-agent-commerce` 不是一个新的垂直 Agent 应用，而是一套让现有 Agent Runtime 安全购买 x402 付费资源的 commerce execution layer。

核心链路：

```text
用户购买意图
  -> Agent Runtime 读取 skill
  -> 解析 x402 quote
  -> 检查金额 / token / network / payee / resource
  -> 生成最小权限 CAW Pact 授权计划
  -> 用户在 Cobo Wallet 批准 Pact
  -> Agent 使用 Pact 执行 scoped x402 payment
  -> Provider 交付结果
  -> 写入脱敏审计证据
```

## 当前可提交状态

- 代码可编译：`npm run check` 已通过。
- 自动化测试通过：backend 20 tests，agents 21 tests。
- 本地 provider 入口可响应：`/demo`、`/llms.txt`、`/risk-report` quote、`/orders/status`。
- `skill:precheck` 可在外部 Solana RPC 卡住时有限时间返回并 fail closed。
- 中文 README 已存在，适合作为 owner review 入口。
- GitHub public repo 已创建：`https://github.com/9526xu/caw-x402-agent-commerce`。
- Demo 录屏已放入 `demo/`：桌面端 `demo/demo.mp4`，移动端 `demo/demo_mobile.MP4`。
- 链上交易证据已放入 `README.md` 和 `demo/README.md`：Solana Devnet tx `3UCmerxaLzXYzzSuBXw3hr19W717N5zn792ig6LD1pcgxUT5Hd8P7fMtcwP6ncMdEdK8wyJAagfPkfkN8S3QdF9n`。

## Cobo 赛道规则映射

- **Agent 与资金操作场景**：Agent Runtime 通过 `skills/caw-x402-purchasing` 购买 x402 paid resource，不是普通钱包展示页。
- **资金相关操作通过 CAW 完成**：端到端付款路径先申请 CAW Pact，再使用 approved Pact 执行 x402 payment；关键实现见 `skills/caw-x402-purchasing/scripts/purchase-with-caw-fetch.mjs` 和 `agents/src/consumer/caw.ts`。
- **真实资金执行能力**：Demo 使用 Solana Devnet USDC 完成 x402 payment，提供 Solscan 交易哈希，不停留在 mockup。
- **CAW 价值体现**：CAW Pact 限定 chain、token、payee、amount、交易次数和时间窗口；项目在 CAW 外围补充 quote review、provider status recovery、duplicate payment guard 和 redacted audit evidence。
- **可运行 / 可演示原型**：仓库包含 provider、buyer executor、skill、browser demo console、录屏和测试命令，不是纯 PPT。

## 提交材料索引

- GitHub repo: `https://github.com/9526xu/caw-x402-agent-commerce`
- README: `README.md`
- 中文说明：`README.zh-CN.md`
- Demo 视频：`demo/demo.mp4`、`demo/demo_mobile.MP4`
- Demo evidence: `demo/README.md`
- CAW 关键代码：`agents/src/consumer/caw.ts`、`skills/caw-x402-purchasing/scripts/purchase-with-caw-fetch.mjs`
- CAW / x402 配置说明：`backend/.env.example`
- 测试网：Solana Devnet
- Transaction Hash: `3UCmerxaLzXYzzSuBXw3hr19W717N5zn792ig6LD1pcgxUT5Hd8P7fMtcwP6ncMdEdK8wyJAagfPkfkN8S3QdF9n`
- Agent Wallet 地址：提交前建议从 CAW Wallet / Solscan 交易详情 / 脱敏 audit evidence 中确认后补充，避免把 provider payee 或 facilitator fee payer 误写成 Agent Wallet。

## 截止前必须完成

1. 确认 Agent Wallet 地址。
   - 不要把 provider payee、Facilitator fee payer 或 token ATA 当作 Agent Wallet。
   - 最稳妥来源是 CAW 钱包页面、Pact / tx 记录、或脱敏 audit evidence。
   - 确认后补到 `README.md` 的 `Demo Evidence` 和提交页。

2. 准备提交页文案。
   - 标题建议：`CAW x402 Agent Commerce: Safe x402 Purchasing for Existing Agent Runtimes`
   - 一句话：`A reusable CAW-backed purchasing skill and executor that lets existing agents inspect x402 quotes, request least-privilege wallet authorization, execute scoped payments, recover delivery, and produce redacted audit evidence.`
   - 强调：CAW 是资金授权边界，不是装饰性集成。

3. 最后检查 GitHub 页面。
   - README 顶部能快速说明 Agentic Commerce 场景。
   - `Demo Evidence` 能直接打开录屏和 Solscan。
   - public repo 中没有 CAW credential、pact-scoped API key、raw payment payload、private key、seed phrase 或 reusable payment proof。

## 可选但建议完成

- 在提交页或视频里明确说：`/risk-report` 是 example paid resource，项目本体是可复用 purchasing capability。
- 准备一个安全 case：超预算拒绝、payee mismatch 拒绝，或已交付订单 recovery 不重复付款。
- 检查公开材料不包含：CAW credential、pact-scoped API key、raw payment payload、private key、seed phrase、reusable payment proof。

## 中文 / 英文策略

不建议把整个仓库改成中文。

推荐策略：

- 顶层 `README.md` 保持英文，方便黑客松评委、GitHub 访客和未来集成方快速理解。
- `README.zh-CN.md` 和本文作为中文 review 入口。
- 代码、目录、脚本、API 字段保持英文，减少工具和生态摩擦。
- 设计解释、提交检查、操作 runbook 可以中文，方便 owner 快速审查业务边界和安全边界。

如果时间只够做一件事，不要翻译全仓；优先刷新 evidence 和录视频。

## 提交前命令

```bash
npm run check
npm run test
```

本地 provider 已在 `4021` 运行时，可检查：

```bash
curl -i http://localhost:4021/llms.txt
curl -i 'http://localhost:4021/risk-report?address=0x0000000000000000000000000000000000000001'
npm run skill:precheck -- \
  --url 'http://localhost:4021/risk-report?address=0x0000000000000000000000000000000000000001' \
  --max-price-usdc 0.005
```

注意：`skill:precheck` 会检查 Solana recipient readiness。如果 `https://api.devnet.solana.com` 超时，结果应 fail closed；演示真实付款前需要换一个可用 RPC 或确认当前网络环境。
