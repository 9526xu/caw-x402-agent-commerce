# 2026-06-01 x402 + CAW Live Test 问题复盘

状态：已跑通 Solana Devnet 真实付款链路；Provider 落库补丁已实现并由自动化测试覆盖。

## 结论

这次 live test 最终选择 `Solana Devnet + USDC` 路线跑通，而不是继续卡在 Ethereum Sepolia。

关键原因：

- CAW 当前支持 `SOLDEV_SOL` 和 `SOLDEV_SOL_USDC`。
- x402 官方 facilitator 支持 Solana Devnet `exact` scheme。
- CAW 的 `SOLDEV_SOL_USDC` mint 与 x402 SVM 默认 Solana Devnet USDC mint 一致。

跑通后的真实链路是：

```text
Provider /risk-report
  -> 402 Payment Required
  -> CAW Pact policy check
  -> CAW x402 payment
  -> Solana Devnet settlement
  -> retry /risk-report with payment proof
  -> HTTP 200 + Payment-Response + risk report body
```

## 问题清单

| 问题 | 现象 | 根因 | 处理 |
| --- | --- | --- | --- |
| Base Sepolia 路线失败 | `caw fetch` dry-run 能读 quote，但真实支付报 `token_not_mapped` | CAW 支持 Base Sepolia chain，但 CAW x402 adapter 当前未映射 Base Sepolia USDC | 放弃 Base Sepolia 作为当前 live path |
| Ethereum Sepolia 路线失败 | Provider 启动时报 facilitator 不支持 `eip155:11155111` | 官方 x402 facilitator 不支持 Ethereum Sepolia `exact` | 搜索多个 facilitator，未找到可验证可用的 Ethereum Sepolia overlap |
| Provider 初始只支持 EVM | Solana network 配置无法直接运行 | 代码只注册了 `ExactEvmScheme` | 新增 `@x402/svm`，按 `X402_NETWORK` 前缀选择 EVM/SVM exact scheme |
| CAW chain id 与 x402 network id 不一致 | Pact policy 不能直接用 `solana:...` | x402 使用 CAIP-2 network，CAW policy 使用 Cobo chain/token id | 增加映射：`solana:EtWTRAB... + USDC -> SOLDEV_SOL + SOLDEV_SOL_USDC` |
| Solana payee 不能大小写归一 | 原 precheck 对 payee 统一 `.toLowerCase()` | EVM 地址大小写可忽略，Solana base58 地址大小写敏感 | precheck 改为仅 EVM 地址忽略大小写，其他地址精确比较 |
| Provider 落库未记录真实 CAW settlement | 第一次真实 `caw fetch` 成功返回 200，但 SQLite 中 order/payment 仍是 `payment_required/required` | CAW 原生 x402 payment payload 没有携带 demo 的可选 `payment-identifier` extension；旧代码只按 payment id 关联 order | 增加 fallback：无 payment id 时从 HTTP query 重算 request fingerprint，并按 fingerprint 记录 settled delivery |
| Provider payee 与 CAW buyer 地址相同 | CAW tx record 中 `src_address` 和 `dst_address` 都是 `7kuW...` | 早期 live test 为了尽快验证协议链路，误用了 CAW Solana 地址作为 Provider 收款地址 | 当前默认 Provider payee 已改为独立 Phantom Devnet seller 地址 `Fxvz4g...`，后续 Pact destination 应使用该地址 |
| Solana seller 测试钱包选择耗时 | 尝试 Rabby 和 MetaMask 后，才找到可直接用于 Solana Devnet 的 Phantom 地址 | Rabby 更偏 EVM 钱包；MetaMask 虽有 Solana 相关能力入口，但在本次测试中没有找到清晰的 Solana 测试网络添加/切换路径 | 使用 Phantom 作为 Provider seller 测试钱包；开启 Phantom Testnet Mode 后可直接使用 Solana Devnet 地址 |
| 本地 sandbox 影响 provider 启动 | `tsx` 在 sandbox 中创建 IPC pipe 报 `EPERM` | 本地执行环境限制 Unix pipe/listen | 用已批准的非沙箱 `npm run provider` 启动本地 Provider |
| 网络访问需要升级权限 | npm install / curl / caw 联网在 sandbox 中 DNS 失败 | sandbox network restricted | 对必要联网命令使用 escalated 权限 |

## 当前代码改动

- Provider 支持 `eip155:*` 与 `solana:*` exact scheme。
- Provider 支持显式 asset/mint quote：`X402_ASSET_ADDRESS`、`X402_TOKEN_VERSION`、`X402_TOKEN_DECIMALS`。
- Consumer Pact spec 会把 x402 network/token 映射为 CAW policy chain/token id。
- Consumer precheck 修复 Solana payee 大小写敏感。
- Provider settlement hook 支持无 payment id 的 CAW 原生 x402 payload。
- 新增测试覆盖：
  - CAW Solana policy id 映射。
  - EVM/Solana payee 比较规则。
  - 无 `payment-identifier` 时 Provider 仍能记录 settlement/delivery。

## 后续注意

- 不要把 `caw pact status` 输出中的 `api_key`、raw pact payload、raw payment payload、`payment_signature_raw` 写入 git。
- `caw tx list` 的完整 JSON 中包含 raw payment fields，文档只记录可公开复验的 ID、地址、金额、状态和链上交易签名。
- 第二个 Pact `76511f8c-4123-496e-9286-f7bfe078883b` 是为了修复后再次 live verify 准备的，尚未用于付款；如不再测试，可在 CAW app 中忽略或清理。
- 若需要独立 Solana Devnet seller 地址，优先用 Phantom Testnet Mode；不要把 CAW buyer 地址临时当成 Provider payee。
