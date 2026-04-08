# CTFExchange + PnlSettlement 详细设计说明（Orderbook PnL 批量上链）.zh-CN

## 1. 文档目标

本文档用于定义在 `CTFExchange`（链下撮合、链上结算）模式下，如何通过独立 `PnlSettlement` 合约将已实现 PnL 安全归入 `tBLP/sBLP` 净值。

适用范围：
- 新交易主路径为 `CTFExchange`，不再依赖 `TradeManager`。
- PnL 归集采用“批量净额结算”而非逐笔链上实时结算。

不包含：
- 撮合引擎实现细节。
- 前端报价与撮合策略。

---

## 2. 背景与约束

历史上 `TradeManager` 采用逐笔 `_handlePnl`，适配 AMM 同步成交；迁移到 orderbook 后，成交发生在链下批次，无法沿用逐笔链上结算。

核心约束：
1. 需要继续把 PnL 反映到 `tBLP/sBLP` 净值。
2. 需要支持链下批量撮合后的链上净额落账。
3. 需要在批量模式下具备可审计和可止损能力。

---

## 3. 设计原则

1. 交易与结算解耦
- `CTFExchange` 负责交易真实性；`PnlSettlement` 负责资金归集正确性。

2. 只结算已实现 PnL
- 仅处理 closed/realized pnl，未实现 pnl 不直接写入 vault。

3. 小步可落地
- 先做批量净额 + 强风控，后续再加 Merkle 明细与挑战机制。

4. 风险预算驱动
- 所有限额由 `settlementRiskBudget` 推导，不使用固定魔法数字。

---

## 4. 总体架构

1. `CTFExchange`（交易层）
- 输入：用户签名订单、撮合结果。
- 输出：可审计成交事件（批次 id、价格、数量、费用、方向等）。

2. `Matcher/Sequencer`（链下聚合层）
- 读取成交事件，生成批次 `netPnl`。
- 形成 EIP-712 签名负载并提交到 `PnlSettlement`。

3. `PnlSettlement`（结算层）
- 验签、防重放、限额校验。
- 调用 `_applyPnl(netPnl)` 完成 vault 入账。

4. `tBLP/sBLP`（资产层）
- 承接最终资产变化，反映份额净值。

5. `TradeManager`（废弃层）
- orderbook 上线后不再承载交易主路径。

---

## 5. 关键变量定义与原因

### 5.1 核心变量

- `settlementRiskBudget`
  - 定义：当前可承受的结算风险预算（USDB 计价）。
  - 原因：批量结算是离散冲击，必须先定义“最多能承受多大损益波动”。

- `batchPnlLimit`
  - 定义：单批 `abs(netPnl)` 上限。
  - 原因：防单点故障（错误批次、被攻击批次）一次性穿透资金池。

- `dailyPnlLimit`
  - 定义：单日累计 `abs(netPnl)` 上限。
  - 原因：防“多批次小额持续错误”在日内累积失控。

- `dailyPnlUsed`
  - 定义：当前风控窗口已消耗额度。
  - 原因：用于实时计算是否超 `dailyPnlLimit`。

- `dailyWindowStart`
  - 定义：风控窗口起始时间戳。
  - 原因：明确日限额统计边界。

- `batchSettled[batchId]`
  - 定义：批次是否已结算。
  - 原因：防重放、幂等保证。

- `batchSettlerSigner`
  - 定义：批次签名公钥（建议多签管理）。
  - 原因：建立链下聚合结果到链上落账的信任边界。

- `paused`
  - 定义：结算总开关。
  - 原因：签名系统异常或对账异常时快速止损。

### 5.2 参数关系建议

- `batchPnlLimit <= settlementRiskBudget * 1%`
- `dailyPnlLimit <= settlementRiskBudget * 5%`
- `dailyPnlLimit >= 3 * batchPnlLimit`（避免过于频繁触发日限额）

---

## 6. 批次数据模型（建议）

`BatchPnl`：
- `uint256 batchId`
- `int256 netPnl`
- `uint256 tradeCount`
- `uint256 windowStart`
- `uint256 windowEnd`
- `uint256 deadline`
- `bytes32 tradesRoot`（可选，后续用于明细承诺）
- `bytes32 engineVersionHash`（可选，绑定撮合器版本）

EIP-712 domain：
- `name = PnlSettlement`
- `version = 1`
- `chainId`
- `verifyingContract`

---

## 7. 结算流程（时序）

1. `CTFExchange` 产生批次成交事件。
2. `Matcher` 聚合批次 realized pnl，得到 `netPnl`。
3. `Matcher` 构造 `BatchPnl`，签名后发链上交易。
4. `PnlSettlement.settleBatchPnl` 执行：
- 检查 `paused`
- 检查 `deadline`
- 检查 `batchSettled[batchId] == false`
- 验签
- 校验 `abs(netPnl) <= batchPnlLimit`
- 校验 `dailyPnlUsed + abs(netPnl) <= dailyPnlLimit`
- 标记批次已结算
- 调用 `_applyPnl(netPnl)`
- 更新 `dailyPnlUsed`
- 发事件 `BatchPnlSettled`

---

## 8. `_applyPnl` 会计规则

定义：
- `tBLPPnl = netPnl * riskCoefficient / 1e18`
- `sBLPPnl = netPnl - tBLPPnl`

行为：
1. `netPnl < 0`（用户亏，LP 赚）
- `mint` 到 `tBLP/sBLP`
- 调用 `distributePnl`

2. `netPnl > 0`（用户赚，LP 亏）
- 从 `tBLP/sBLP` `burn`
- 调用 `reclaimPnl`

3. `netPnl == 0`
- 只记事件，不做资产变更。

安全建议：
- 在 `netPnl > 0` 路径增加“可扣减余额”检查，防止异常 burn 触发不可恢复状态。

---

## 9. 失败与异常处理

1. 验签失败
- 直接回滚，批次不标记已结算。

2. 超过单批限额
- 直接回滚，需拆批或人工审批调整。

3. 超过单日限额
- 直接回滚，触发告警；建议进入 `paused` 或 close-only。

4. deadline 过期
- 直接回滚，要求重新签名并重提。

5. 链下对账不一致
- 立即 `paused=true`，停止新结算，执行人工对账流程。

---

## 10. 参考方案拆解（GMX 与 GNS 分开）

### 10.1 GMX 方案（执行时结算，池子实时记账）

定位：
- GMX 更接近“每次执行交易就更新资金池状态”，不是独立批量净额结算合约。
- V2 是请求-执行分离，V1/V2 都是“realized pnl 在减仓/平仓时入池”。

关键流程（简化）：
1. 用户先提交请求（开仓/平仓/改单），请求上链。
2. keeper 在可执行条件满足时执行请求，并带入 oracle 参数。
3. 执行上下文中写入价格，执行结束后清理临时价格。
4. 在减仓/平仓路径计算 realized pnl，并直接更新 pool 资产：
- 用户盈利：池子减少（LP 承担损失）。
- 用户亏损：池子增加（LP 获益）。
5. LP token 价格由池子价值计算得到；池子价值同时受未实现 pnl 影响，并有 pnl cap 约束。

关键状态/机制：
- `request -> execute` 两步结构。
- 执行期 oracle 价格上下文（set/clear）。
- 池子资产与仓位状态在一次执行交易内同步更新。
- `max pnl factor` 类参数限制 trader pnl 对池子的冲击上限。

优点：
- PnL 与交易执行原子绑定，账务清晰。
- 不需要额外批次签名聚合信任。

代价：
- 对执行器、oracle、合约路径一致性要求高。
- 对“链下撮合后统一净额结算”场景不够贴合。

对本项目可直接借鉴：
1. 正负 pnl 对 vault 的双向记账语义（你已具备）。
2. 执行价/估值价隔离思路（防止结算价污染）。
3. pnl cap 参数化风控（可映射为 `batchPnlLimit/dailyPnlLimit` 上层约束）。

参考：
- https://github.com/gmx-io/gmx-synthetics
- https://docs.gmx.io/docs/security/

### 10.2 GNS 方案（epoch/feed 聚合，作用于 vault 定价）

定位：
- GNS 更接近“PnL 聚合后再影响 vault”，不是每笔交易都直接改 vault 资产。
- 适合异步、批次化、oracle 驱动的结算环境。

关键流程（简化）：
1. 系统周期性请求 open pnl 数据（feed 请求）。
2. 多次回答满足阈值后，更新当前 epoch 的 open pnl 视图。
3. gToken 侧通过累计变量（如 per-token 累计项）将 pnl/奖励折算到份额定价。
4. 提款路径受 epoch 与锁定规则约束，防止在关键更新窗口前跑。

关键状态/机制：
- `epoch` 周期与请求计数。
- open pnl feed 的最小回答数/容忍偏差。
- vault 定价累积变量（不是逐笔交易直接改池子）。
- timelock 与参数治理流程。

优点：
- 天然适配异步聚合与批次更新。
- 能把估值更新、提款安全、治理流程系统化。

代价：
- 机制复杂，运维和参数管理成本高。
- 调参与监控要求高，开发周期更长。

对本项目可直接借鉴：
1. 批次化/周期化更新思想（你当前 `BatchPnl` 就是轻量版）。
2. 关键窗口保护（deadline、暂停、提款窗口可后续扩展）。
3. 治理参数变更走 timelock。

参考：
- https://docs.gains.trade/developer/technical-reference/contracts/core/gtokenopenpnlfeed
- https://docs.gains.trade/liquidity-farming-pools/gtoken-vaults
- https://docs.gains.trade/liquidity-farming-pools/gtoken-vaults/upgrades-updates-and-timelocks

### 10.3 两者对比与本方案选择

GMX 型：
- 更偏“执行即结算”。
- 适合 onchain 执行主导的交易路径。

GNS 型：
- 更偏“聚合后定价/结算”。
- 适合异步、批处理、强治理场景。

本项目当前选择 `CTFExchange + PnlSettlement` 的原因：
1. 交易在链下撮合，天然更接近 GNS 的“聚合后更新”范式。
2. 你已具备 `_handlePnl` 语义，适合做轻量聚合结算而非重写整套执行引擎。
3. 可以先做 MVP（批次净额 + 强风控），后续再加 GNS 式 epoch/挑战扩展。

---

## 11. 安全模型与威胁清单

1. 签名密钥泄露
- 风险：恶意提交虚假 `netPnl`。
- 缓解：多签托管 signer、快速轮换、`paused` 应急。

2. 批次重放
- 风险：重复入账。
- 缓解：`batchSettled` 一次性消费。

3. 参数配置失误
- 风险：风控失效或频繁误杀。
- 缓解：参数更新走 timelock + 双人复核 + dry-run 脚本。

4. 链下聚合器 bug
- 风险：系统性错误定价。
- 缓解：双通道对账、阈值告警、超限自动停止。

5. 短时极端波动
- 风险：单日大量 pnl 变化。
- 缓解：收紧 `settlementRiskBudget`，触发 close-only。

---

## 12. 监控与运维 Runbook

### 12.1 关键指标

- `batch_settle_success_rate`
- `batch_settle_revert_rate`
- `daily_pnl_used_ratio = dailyPnlUsed / dailyPnlLimit`
- `abs_net_pnl_p95`（批次绝对 pnl 的 p95）
- `signer_key_rotation_age`

### 12.2 告警阈值建议

- `daily_pnl_used_ratio > 80%`：黄色告警。
- `daily_pnl_used_ratio > 95%`：红色告警并评估暂停。
- 连续 3 个批次验签失败：红色告警。

### 12.3 应急步骤

1. `paused = true`
2. 冻结批次提交机器人
3. 拉取最近 N 批链下明细与链上事件对账
4. 明确 root cause 后重启并调整参数

---

## 13. 测试计划（最低要求）

1. 单元测试
- 正负 `netPnl` 分摊正确性。
- `batchId` 重放保护。
- `deadline`、验签、限额边界。

2. 属性测试
- 随机批次序列下 `dailyPnlUsed` 不越界。
- 结算顺序改变不影响最终累计结果（可交换性场景）。

3. 对账回放
- 使用历史成交数据回放 1,000+ 批次。
- 对比链下聚合结果与链上入账一致性。

4. 故障注入
- 模拟 signer 失效、聚合器异常、超限批次、重放攻击。

---

## 14. 上线步骤（一次性切换）

### 阶段 A（准备）
1. 部署 `PnlSettlement`。
2. 配置 `settlementRiskBudget / batchPnlLimit / dailyPnlLimit / signer`。
3. 完成 `CTFExchange -> PnlSettlement` 联调与压测。

### 阶段 B（切换）
1. 新交易入口切到 `CTFExchange`。
2. `PnlSettlement` 成为唯一 pnl 入账路径。
3. `TradeManager` 交易路径关闭。

### 阶段 C（收敛）
1. `TradeManager` 标记 deprecated。
2. 保留审计查询能力，按计划移除历史路径。

---

## 15. 参数建议（初始）

- `settlementRiskBudget`: vault 可用净值的 60%~80%
- `batchPnlLimit`: `settlementRiskBudget` 的 0.5%~1%
- `dailyPnlLimit`: `settlementRiskBudget` 的 3%~5%
- `deadline`: 5~15 分钟
- signer: 至少 2/3 多签

---

## 16. 实施备注

1. 命名已与旧 `TradeManager.availableFunds` 解耦。
2. 如需更强可审计性，优先新增 `tradesRoot` 与离线证明归档。
3. 若未来引入未实现 pnl 影响净值，可在当前设计上叠加“估值层”，不影响结算层接口。

---

## 17. 一句话总结

在 `CTFExchange` 主路径下，采用独立 `PnlSettlement` 做“批量净额 PnL 上链 + 强风控限额”是当前复杂度最低、可审计性强、且可逐步增强的落地方案。

---

## 18. Prediction Market LP Vault 专章（建议采用）

本章定义“预测市场场景下”的专用口径与规则，避免直接照搬 perp 逻辑。

### 18.1 会计口径（必须统一）

定义：
- `traderPnlDelta`：交易用户侧的净 pnl 变化（正值表示用户盈利）。
- `vaultPnlDelta`：LP vault 侧的净资产变化（正值表示 LP 盈利）。

约束关系：
- `vaultPnlDelta = - traderPnlDelta + feeDelta - rebateDelta`

要求：
- 任何批次上链前，必须能在链下对账系统中验证上述守恒关系。

### 18.2 批次类型拆分（不要混合）

建议至少区分两类批次：

1. `TRADE_BATCH`
- 来源：二级市场买卖与平仓产生的 realized pnl。
- 特征：高频、小额、连续。
- 风控：严格受 `batchPnlLimit/dailyPnlLimit` 约束。

2. `RESOLUTION_BATCH`
- 来源：市场最终判定（YES/NO 兑付）产生的终局 pnl。
- 特征：低频、可能大额、事件驱动。
- 风控：建议走“专用结算通道”，不与普通交易批次共享日限额配额。

说明：
- `RESOLUTION_BATCH` 本质是系统必须履行的兑付结算，不建议被普通 `dailyPnlLimit` 直接阻断。

### 18.3 预测市场风险预算模型

建议变量：
- `vaultEquity`：tBLP+sBLP 总净值。
- `worstCaseLiability`：所有未结算市场在最坏情形下的总兑付负债。
- `safetyBuffer`：治理设定安全垫（应对延迟、手续费波动、执行摩擦）。
- `freeEquity = vaultEquity - worstCaseLiability - safetyBuffer`
- `settlementRiskBudget = max(freeEquity, 0)`

解释：
- perp 模型常用“池子净值”即可做主风控；预测市场必须额外扣除“未来可能兑付负债”，否则会高估可承受风险。

### 18.4 限额规则（按批次类型）

对 `TRADE_BATCH`：
- `abs(netPnl) <= batchPnlLimit`
- `dailyPnlUsed + abs(netPnl) <= dailyPnlLimit`
- 超限即回滚，必要时进入 `paused/close-only`。

对 `RESOLUTION_BATCH`：
- 不走普通 `dailyPnlLimit` 共享池。
- 走独立额度：`resolutionPnlLimit`（可选）+ 人工/多签确认流。
- 必要时允许分片结算（按 market 或 tranche）以避免单笔过大失败。

### 18.5 结算与提现联动

核心原则：
- 提现能力应基于 `freeEquity`，而不是仅看 `vaultEquity`。

建议规则：
1. 若 `freeEquity <= 0`，暂停普通提现，仅保留应急/治理路径。
2. 临近重大市场结算窗口时，提高 `safetyBuffer` 或引入提现冷却期。
3. 对大额提现增加额外审核或延迟执行，避免结算前流动性被抽离。

### 18.6 `PnlSettlement` 扩展字段建议

在 `BatchPnl` 增加：
- `uint8 batchType`（`1=TRADE_BATCH, 2=RESOLUTION_BATCH`）
- `bytes32 marketGroupId`（可选，按事件组或 market 分桶）
- `uint256 liabilitySnapshot`（可选，提交时的负债快照）

在事件 `BatchPnlSettled` 增加：
- `batchType`
- `riskBudgetUsed`
- `postFreeEquity`

### 18.7 最低测试矩阵（预测市场特化）

1. `TRADE_BATCH` 连续 1,000 批回放，验证日限额触发行为。
2. `RESOLUTION_BATCH` 大额结算分片，验证总量守恒与顺序无关性。
3. 在 `freeEquity` 降至临界值时，验证提现限制与结算优先级。
4. 交叉场景：同日发生大量交易批次 + 事件结算批次，验证额度隔离不互相污染。
