# Orderbook 虚拟流动性设计说明（Protocol MM）.zh-CN

## 1. 目标

在 `CTFExchange` 场景下实现：
- 协议可在多个盘口持续挂单（不预占真实资金）。
- 仅在成交时才消耗真实资金与风险预算。
- 始终保证协议偿付能力，不因“无限挂单”导致穿仓风险。

一句话：**挂单能力与结算能力解耦**。

---

## 2. 核心定义

1. `Quote Power`（挂单能力）
- 协议 MM 在订单簿可挂出的总深度能力。
- 不等于真实可支付资金，不做预冻结。

2. `Settlement Power`（结算能力）
- 协议 MM 对已成交头寸的真实承接能力。
- 必须受 vault 偿付能力与风险预算约束。

3. `ProtocolMM`
- 协议策略做市账户（risk-aware market maker）。
- 是否提供流动性由风险状态与做市策略共同决定，不承诺持续报价。

---

## 3. 为什么要用虚拟流动性

传统资金冻结模型：
- 资金只有 10,000 USDC，只能在少数盘口挂有限深度。

虚拟流动性模型：
- 可在无数盘口挂深度；
- 未成交订单不占资；
- 只有成交部分才进入资金与风险核算。

收益：
- 更平滑的盘口深度。
- 更好的用户成交体验。
- 资金利用率显著提升。

---

## 4. 总体架构

1. `CTFExchange`（交易层）
- 维护用户订单与 `ProtocolMM` 虚拟订单。
- 撮合时可按策略路由到不同流动性来源（用户/第三方MM/ProtocolMM）。

2. `Risk Engine`（风险层）
- 在成交准入时执行风险校验。
- 在状态更新时执行额度与健康度校验。

3. `Vault`（资产层）
- 提供真实偿付能力与预算锚点。

---

## 5. 关键机制：只成交占资

### 5.1 挂单阶段

- `ProtocolMM` 可以无限盘口挂单。
- 不冻结 `USDB/USDC`。
- 仅记录“可成交报价意图”。

### 5.2 成交准入检查（必须）

每笔拟与 `ProtocolMM` 成交前，计算成交后风险状态：
- `postTradeFreeEquity`
- `postTradeMarketExposure`
- `postTradeGlobalLiability`

仅当全部满足阈值才允许成交。

### 5.3 成交后状态更新

- 成交写入订单簿状态与MM风险账户。
- 更新 `usedCredit/exposure/freeEquity` 等风控状态。
- 真实资产记账由独立资产结算模块处理（不在本文档定义）。

---

## 6. 风控硬约束（建议）

以下三条建议作为硬门槛：

1. `postTradeFreeEquity >= minFreeEquity`
2. `postTradeMarketExposure <= marketExposureCap[marketId]`
3. `postTradeGlobalWorstCaseLiability <= vaultEquity - safetyBuffer`

解释：
- 第 1 条防止可用净值被吃空。
- 第 2 条防止单市场过度集中。
- 第 3 条保证终局兑付能力（预测市场核心）。

---

## 7. 预测市场专用风险口径

建议使用：
- `vaultEquity`：vault 当前总净值。
- `worstCaseLiability`：所有未结算市场的最坏兑付总负债。
- `freeEquity = vaultEquity - worstCaseLiability - safetyBuffer`。

说明：
- 不能只看账面净值，必须扣除未来可能兑付负债。

---

## 8. 做市状态机（建议）

原则：
- `ProtocolMM` 不承担强制连续做市义务；当风险状态恶化或策略判定不利时，可降档至零报价（不提供流动性）。

1. `Normal`
- 正常深度、正常点差。

2. `Throttled`
- 降低深度、加大点差。
- 触发条件：`freeEquity` 逼近阈值或波动升高。

3. `CloseOnly`
- 仅允许降低系统风险的成交方向。
- 禁止新增风险敞口。

4. `Paused`
- 停止 `ProtocolMM` 新成交。
- 仅允许治理恢复和必要结算。

---

## 9. 模块边界（避免耦合）

1. 本文档仅定义“虚拟流动性与风控准入”。
2. 资产会计、PnL 归集、份额净值更新属于独立模块。
3. 两类模块并行演进，不要求先后依赖。
4. 虚拟流动性模块对外只暴露“成交准入结果与风险状态”。

建议输出字段：
- `postFreeEquity`
- `postMarketExposure`
- `riskCheckHash`
- `mmStatus`

---

## 10. 第三方做市商兼容设计（MM Credit Engine）

目标：
- 支持第三方 MM 接入并使用“虚拟流动性”能力。
- 保证每个 MM 风险隔离，避免单个 MM 风险传染到全局。

### 10.1 账户与风险隔离

每个 MM 建立独立风险账户：
- `mmCollateral`：该 MM 的实缴保证金。
- `mmCreditLimit`：授予该 MM 的虚拟流动性额度。
- `mmUsedCredit`：已成交占用的信用额度。
- `mmStatus`：`Normal/Throttled/CloseOnly/Paused`。

原则：
- 不允许多个 MM 共用一套信用池。
- MM 风险优先在自身账户内闭环，不直接动用协议 vault。

### 10.2 双层额度模型

1. 全局额度：
- `globalMmCreditCap`：所有第三方 MM 的信用总上限。

2. 单 MM 额度：
- `perMmCreditCap[mm]`：单 MM 总上限。
- `perMarketCap[mm][marketId]`：单 MM 单市场上限（建议必配）。

约束关系：
- `sum(mmUsedCredit) <= globalMmCreditCap`
- `mmUsedCredit <= perMmCreditCap[mm]`
- `mmMarketExposure <= perMarketCap[mm][marketId]`

### 10.3 成交准入风控检查（第三方 MM）

每笔拟撮合到某 MM 前执行：
1. 计算 `postTradeUsedCredit`。
2. 计算 `postTradeMarketExposure`。
3. 校验以下条件：
- `postTradeUsedCredit <= perMmCreditCap[mm]`
- `postTradeUsedCredit <= mmCollateral * leverageFactor + grantedCredit`
- `postTradeMarketExposure <= perMarketCap[mm][marketId]`

任一失败：
- 拒绝该 MM 本笔成交（可继续尝试下一个 MM 或 ProtocolMM）。

### 10.4 损失吸收路径

建议 waterfall：
1. 用该 MM 的保证金与风险准备金吸收亏损。
2. 不足部分触发该 MM `CloseOnly/Paused` 与减仓流程。
3. 若有事先约定的 backstop fund，再进入 backstop。
4. 最后才考虑系统级应急（治理介入）。

说明：
- 第三方 MM 的损失不应默认由 LP vault 兜底。

### 10.5 撮合优先级（可配置）

建议顺序：
1. 用户对用户（真实流动性）
2. 第三方 MM
3. ProtocolMM（可选参与）

收益：
- 降低协议自营风险占用（当 ProtocolMM 进入风险收缩状态时可直接不参与）。
- 提升第三方流动性参与激励。

### 10.6 接口建议（最小集合）

- `registerMM(address mm, uint256 collateral, bytes config)`
- `setMmCaps(address mm, uint256 perMmCap, uint256[] perMarketCaps)`
- `preTradeRiskCheck(address mm, TradeDelta delta) returns (bool ok, uint8 reason)`
- `onTradeMatched(address mm, TradeDelta delta)`（更新 `mmUsedCredit`）
- `settleMmBatch(address mm, int256 mmPnlDelta)`
- `getMmHealth(address mm)`（返回健康度与状态）

---

## 11. 测试清单（必须）

1. 无限挂单能力测试
- 1,000+ 盘口挂单，未成交时不占资。

2. 成交占资测试
- 仅成交部分进入风险和结算计算。

3. 风控拦截测试
- 任一硬约束不满足时拒绝成交。

4. 状态机测试
- `Normal -> Throttled -> CloseOnly -> Paused` 迁移正确。

5. 极端波动测试
- 单市场突发成交、跨市场连锁成交下仍满足偿付约束。

6. 对账守恒测试
- `vaultPnlDelta = -traderPnlDelta + feeDelta - rebateDelta` 始终成立。

---

## 12. 上线建议（最小版本）

阶段 A：
1. 上线 `ProtocolMM` 虚拟挂单能力。
2. 上线成交准入三条硬约束。

阶段 B：
1. 接入状态机自动降档（Throttled/CloseOnly）。
2. 接入第三方 MM 信用额度体系（MM Credit Engine）。

阶段 C：
1. 引入更精细的 market 分桶预算。
2. 引入回测驱动的动态点差与深度控制。

---

## 13. 一句话总结

虚拟流动性不是“无限承担风险”，而是“无限挂单意图 + 有限结算承载能力”。在 orderbook 中，只要把成交前风险检查与批次结算风控做实，就可以同时获得深度与安全性。
