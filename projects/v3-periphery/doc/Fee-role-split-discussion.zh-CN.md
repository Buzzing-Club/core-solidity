# Fee 角色分成讨论（不含动态 Fee）

## 1. 目标
- 当前先按固定总费率执行：`总 fee = 1%`（即每笔成交额的 1%）。
- 本文仅讨论固定 fee 在不同角色之间如何分成，不包含动态 fee。

## 2. 当前共识
- 总费率：`1%`。
- 动态 fee：本阶段不启用、不纳入分账口径。
- 需要明确的角色：
  - `creator`
  - `protocol`
  - `LP`
  - `buffer`
  - `referrer`（可选）
  - `feeRebate`

## 3. 建议的分账口径
- 先统一使用比例基数：`10000`（便于表示百分比，10000 = 100%）。
- 则总费 1% 在链上按角色比例切分，要求：
  - `creatorShare + protocolShare + LPShare + bufferShare + referShare + feeRebateShare = 10000`

## 4. 可选分成方案（用于讨论）

### 方案 A（均衡）
- creator: `1800`（18%）
- protocol: `1800`（18%）
- LP: `3800`（38%）
- buffer: `1000`（10%）
- referrer: `800`（8%）
- feeRebate: `800`（8%）

### 方案 B（偏 LP 激励）
- creator: `1400`（14%）
- protocol: `1400`（14%）
- LP: `5200`（52%）
- buffer: `1000`（10%）
- referrer: `500`（5%）
- feeRebate: `500`（5%）

### 方案 C（偏协议收入）
- creator: `1200`（12%）
- protocol: `3000`（30%）
- LP: `3200`（32%）
- buffer: `1000`（10%）
- referrer: `800`（8%）
- feeRebate: `800`（8%）

## 5. 链上配置建议（按你们现有脚本口径）
- 固定总 fee：`setPoolTotalFeeRatio(pool, 10000)`（表示 100% 分账基数）。
- 角色分账：
  - `setPoolRole(pool, "creator", creatorAddress, creatorShare)`
  - `setPoolRole(pool, "protocol", protocolAddress, protocolShare)`
  - `setPoolRole(pool, "LP", lpAddress, lpShare)`
  - `setPoolRole(pool, "buffer", bufferAddress, bufferShare)`
  - `setPoolRole(pool, "feeRebate", feeRebateAddress, feeRebateShare)`
- 推荐分账（如启用）：
  - `setPoolReferShare(pool, referShare)`

## 6. 需要你确认的决策项
- 是否启用 `referrer` 分账（启用/不启用）。
- `feeRebate` 是否固定启用（建议启用）。
- 六个角色各自比例（按 10000 基数）。
- `LP` 与 `buffer` 地址是否按池子维度配置，还是全局统一。

## 7. 建议下一步
- 先选一个方案作为试运行（建议 A 或 B）。
- 上链后抽样核对 10~20 笔交易的 fee 分账结果（角色到账金额是否符合比例）。
