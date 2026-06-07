# 2026-06-01 x402 + CAW Live Test Evidence

状态：Solana Devnet x402 + CAW 真实付款链路已跑通。

记录原则：只记录可复验的非敏感数据；不记录 pact-scoped API key、raw secret-bearing Pact payload、raw `payment_signature_raw` 或完整本地 audit JSON。

注意：本文件记录的是 2026-06-01 的历史 live test。当时 Provider payee 误用了 CAW buyer Solana 地址，因此链上表现为自转账。当前 demo 默认 Provider payee 已修正为独立 Phantom Devnet seller 地址 `Fxvz4gTxj2NMECVDD4XM3d5BGfMSv2mViyh4JFHh6oKk`。

## 环境

| 项 | 值 |
| --- | --- |
| Repo | `/Users/xurujian/Documents/github/ai-web3-school-cohort-0` |
| Demo root | `experiments/x402-caw-risk-report` |
| 日期 | 2026-06-01 |
| Provider URL | `http://localhost:4021` |
| API | `GET /risk-report?address=0x0000000000000000000000000000000000000001` |
| Price | `0.005 USDC` |
| x402 facilitator | `https://x402.org/facilitator` |

## 参与地址与资产

| 角色 | 值 |
| --- | --- |
| CAW EVM address | `0x5ade5a9c8d8454dbf90838791e9a59de362fce8d` |
| CAW Solana address | `7kuW3nm9Yw7c3SAQEZpBsyVgNywpabJekeXjKuYt2Z4b` |
| Provider Solana payee | `7kuW3nm9Yw7c3SAQEZpBsyVgNywpabJekeXjKuYt2Z4b` |
| Solana Devnet x402 network | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` |
| CAW chain id | `SOLDEV_SOL` |
| CAW token id | `SOLDEV_SOL_USDC` |
| USDC mint | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |
| USDC decimals | `6` |

## Faucet 与余额

CAW faucet supported tokens:

| Chain | Token | Faucet amount | Daily limit |
| --- | --- | --- | --- |
| `SOLDEV_SOL` | `SOLDEV_SOL` | `0.05` | `0.1` |
| `SOLDEV_SOL` | `SOLDEV_SOL_USDC` | `0.01` | `0.02` |
| `SETH` | `SETH` | `0.01` | `0.02` |

Faucet deposits used in this test:

| Token | Amount | Request id | Transaction id / hash | Status |
| --- | --- | --- | --- | --- |
| `SOLDEV_SOL` | `0.05` | `faucet-cc47aa138bc544e387ababff91655c0f` | `3UAc4Ms7ghDwBL5gkNGyGgkC3zavSKRmvDiEd554h83rz494k7jLZi1H6odk24EHGuETWcLXPcvqWwWCKVwFhzmo` | `Success` |
| `SOLDEV_SOL_USDC` | `0.01` | `faucet-7fae1f84dec74d2d8de18f5f1737068a` | `4VmAPyyKPLstctCRyK5n71wvRFs2m43uCkC1PSNEYVTNSUNG8ypk8gsYLJWD2UvqVskPuVgVboBY3sPYEVtrSPW7` | `Success` |

Observed CAW balance after faucet:

| Token | Amount |
| --- | --- |
| `SOLDEV_SOL` | `0.05` |
| `SOLDEV_SOL_USDC` | `0.01` |

## Provider 启动参数

```bash
PROVIDER_PAY_TO_ADDRESS=7kuW3nm9Yw7c3SAQEZpBsyVgNywpabJekeXjKuYt2Z4b \
X402_NETWORK=solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1 \
X402_TOKEN_SYMBOL=USDC \
X402_PRICE_USDC=0.005 \
npm run provider
```

Provider 启动成功：

```text
Provider listening on http://localhost:4021
```

## x402 Unpaid Quote

请求：

```bash
curl -i \
  -H 'Accept: application/json' \
  'http://localhost:4021/risk-report?address=0x0000000000000000000000000000000000000001'
```

响应摘要：

| 字段 | 值 |
| --- | --- |
| HTTP status | `402 Payment Required` |
| Header | `PAYMENT-REQUIRED` |
| network | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` |
| asset | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |
| amount | `5000` raw units |
| token | `USDC` |
| payTo | `7kuW3nm9Yw7c3SAQEZpBsyVgNywpabJekeXjKuYt2Z4b` |
| feePayer | `CKPKJWNdJEqa81x7CkZ14BVPiY6y16Sxs7owznqtWYp5` |

CAW dry-run command:

```bash
caw fetch 83f8b559-5906-4c34-ab7f-3bc68b62714a \
  'http://localhost:4021/risk-report?address=0x0000000000000000000000000000000000000001' \
  --protocol x402 \
  --network solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1 \
  --asset 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU \
  --max-amount 5000 \
  --output full \
  --dry-run
```

Dry-run 结果：CAW 识别到唯一可接受 payment option：

```text
network=solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1
asset=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
amount=5000
```

## CAW Pact

成功付款使用的 Pact：

| 字段 | 值 |
| --- | --- |
| pact_id | `33555f5a-11c3-44dd-ab15-e6dc1650bcc4` |
| approval_id | `b9431e35-9976-4839-91b0-7702bc84d3f9` |
| status | `active` during payment |
| activated_at | `2026-06-01T14:51:32.298484Z` |
| expires_at | `2026-06-01T15:21:32.298484Z` |
| chain allowlist | `SOLDEV_SOL` |
| token allowlist | `SOLDEV_SOL_USDC` |
| destination allowlist | `7kuW3nm9Yw7c3SAQEZpBsyVgNywpabJekeXjKuYt2Z4b` |
| max amount | `0.005 USDC` |
| tx count | `1` |

未使用的第二个 Pact：

| 字段 | 值 |
| --- | --- |
| pact_id | `76511f8c-4123-496e-9286-f7bfe078883b` |
| approval_id | `5da88263-e533-4139-9a03-0bd1e8f313ca` |
| purpose | 用于修复 Provider 落库 fallback 后二次 live verify |
| payment executed | `no` |

## 真实 caw fetch 付款

命令：

```bash
caw fetch 33555f5a-11c3-44dd-ab15-e6dc1650bcc4 \
  'http://localhost:4021/risk-report?address=0x0000000000000000000000000000000000000001' \
  --protocol x402 \
  --network solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1 \
  --asset 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU \
  --max-amount 5000 \
  --output full
```

结果摘要：

| 字段 | 值 |
| --- | --- |
| HTTP status | `200` |
| Response header | `Payment-Response` |
| payer | `7kuW3nm9Yw7c3SAQEZpBsyVgNywpabJekeXjKuYt2Z4b` |
| network | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` |
| transaction | `3F9P5SRxuwt2EKzVF5YaTeWVGW2i63ZoABqyLFwQC2z66XqrcUWAkCveDXfm9AE7Z9vssRD3XbS2nBHsvzFg7MQY` |

返回 report 摘要：

| 字段 | 值 |
| --- | --- |
| address | `0x0000000000000000000000000000000000000001` |
| riskScore | `11` |
| riskLevel | `low` |
| labels | `low-observed-risk` |
| generatedAt | `2026-06-01T14:52:38.269Z` |
| method | `deterministic-mock-v1` |
| requestFingerprint | `sha256:0b284b5835c2104497096324b63d571bd5fcb01e11de70c98615566e32a9c6fe` |
| orderId | `rro_9a6c6805-b703-4de5-96e9-e79a98ce28a5` |

CAW transaction record:

| 字段 | 值 |
| --- | --- |
| CAW tx id | `a1c12836-6682-4b28-8b39-06e17654df8a` |
| request_type | `x402_payment` |
| type | `transfer` |
| status | `Success` |
| sub_status | `completed` |
| chain_id | `SOLDEV_SOL` |
| token_id | `SOLDEV_SOL_USDC` |
| amount | `0.005` |
| src_address | `7kuW3nm9Yw7c3SAQEZpBsyVgNywpabJekeXjKuYt2Z4b` |
| dst_address | `7kuW3nm9Yw7c3SAQEZpBsyVgNywpabJekeXjKuYt2Z4b` |
| created_at | `2026-06-01T14:52:23.093341Z` |
| updated_at | `2026-06-01T14:52:24.273064Z` |

## Provider SQLite Evidence

第一次 live payment 成功发生在 Provider 落库 fallback 修复之前，因此当时本地 SQLite 只记录了 unpaid order 和 required payment：

| Table | ID | Status | Note |
| --- | --- | --- | --- |
| `risk_report_orders` | `rro_9a6c6805-b703-4de5-96e9-e79a98ce28a5` | `payment_required` | 已生成 unpaid order |
| `payment_records` | `payrec_2162bebf-9d57-4177-aaf7-73cee73c8ce4` | `required` | 未收到 demo payment id，旧逻辑无法落 settlement |
| `report_deliveries` | none | none | 旧逻辑未写入 delivery |

对应修复：

- 当 x402 payload 没有 demo `payment-identifier` extension 时，Provider 从 HTTP transport context 读取 `address` query。
- Provider 按 method/path/address/payment requirement 重算 request fingerprint。
- Provider 按 fingerprint 将 settlement 和 delivered report 写入 `payment_records` 与 `report_deliveries`。
- 自动化测试 `settles and records delivery when the payment payload has no payment identifier` 已覆盖该路径。

## 验证命令

```bash
npm run check
npm run test
```

验证结果：

```text
Test Files  7 passed
Tests       28 passed
```
