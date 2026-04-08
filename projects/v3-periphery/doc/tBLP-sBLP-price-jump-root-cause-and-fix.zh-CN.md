# tBLP/sBLP 价格跳变问题复盘

## 1. 问题摘要

在 Base 主网运行中，观察到以下现象：

- 大额 `LPDeposit` 后，`shareToAssetsPrice` 没有立刻更新。
- 随后一次很小的 `PnlDistributed`（例如 `assets=17963`）却触发了接近 `0.654 -> 0.9999` 的价格跳变。
- 用户侧出现 `maxWithdraw` 显著高于池子真实 `totalAssets` 的情况，造成“可提现余额看起来不合理”。

这不是单一“小额 PnL 放大”的问题，而是「`deposit` 对 `accPnlPerToken` 的稀释 + 价格延迟刷新」叠加造成的表现。

## 2. 链上证据（本次事件）

关键交易：

- 低价阶段大额入金（约 0.654 价格）：  
  `0x0e2eb76b4885e91e132b11a425cfe315b7a48fdca3cf0e19bccf7288a8e775a3`
- 后续小额入金（已接近 1.0 价格）：  
  `0x87292db4c4fd9048efe0d7f22834451c83922f2f384a2b3c770c165917c0e220`
- 中间触发价格更新的交易：  
  `0x40d2f0eabec8239c34a83c785389aacf63e0e648b1cb07c8c6938c6dfdcbb000`

该中间交易中可见：

- `tBLP.ShareToAssetsPriceUpdated(999955951860828829)`
- `tBLP.PnlDistributed(sender=TradeManager, assets=17963)`

说明：真正让价格“显示跳变”的触发点是这笔 `PnlDistributed`，但跳变主因并不只来自 `17963`。

## 3. 根因拆解

### 3.1 当前定价与状态更新路径

在 `tBLP/sBLP` 中：

1. `deposit/mint/withdraw/redeem` 会走 `scaleVariables(...)`。
2. 当 `accPnlPerToken < 0` 时，`scaleVariables` 执行：
   - `accPnlPerToken = accPnlPerToken * supply / (supply ± shares)`
3. 但 `deposit/mint/withdraw/redeem` 本身不调用 `updateShareToAssetsPrice()`。
4. `shareToAssetsPrice` 只在 `distributePnl/reclaimPnl` 中更新并发事件。

### 3.2 为什么“小 pnl 看起来引发大跳变”

当时池子早期 `totalSupply` 极小（约 2 tBLP）时发生了大额入金：

- 大额 `deposit` 铸出大量 shares（约 15278 tBLP）
- 由于 `scaleVariables` 用 `supply/(supply+shares)`，负 `accPnlPerToken` 被极大稀释，已经接近 0
- 但价格变量未即时刷新，外部读到的还是旧价附近
- 后续任意一次 `PnlDistributed` 触发刷新，就会把“之前已发生的稀释结果”一次性反映出来

因此表现成：小额 `assets` 触发了大幅跳变。  
本质上是“延迟显化”，不是“17963 本身把价格直接拉满”。

## 4. 为什么 `maxWithdraw` 会不合理

当前实现里：

- `maxWithdraw(owner)` -> `_convertToAssets(maxRedeem(owner), Down)`
- `_convertToAssets` 依赖 `shareToAssetsPrice`

而 `shareToAssetsPrice` 在本次路径下已被上述机制抬高，因此会出现：

- `maxWithdraw(user)` 显著大于 `totalAssets`（池子真实 USDB 资产）

这会导致前端和用户感知出现“可提资产异常偏高”。

## 5. 定位结论

该问题属于经济逻辑/记账口径不一致，不是单纯前端展示问题。  
它与经典 ERC4626 donation inflation 不是完全同类，但属于 share 价值可被结构性重塑的风险范畴。

## 6. 已执行的迁移动作（本次处理）

为隔离旧状态，已完成：

- 部署新 `tBLPProxy`: `0x1DBC025A07c904F876946C98dfa3B36dAc365Ca3`
- 部署新 `sBLPProxy`: `0x360A3417a4192B6D49a31c1AcabB59E10Da29dfB`
- 新 vault `pnlHandler` 已设置为 `tradeManagerProxy`
- `TradeManager` 已升级并通过 `setBLPVaults` 切到新 vault

（具体交易与状态信息见部署输出与 `deploy/state/base.resume-buzzing.base-mainnet.json`）

