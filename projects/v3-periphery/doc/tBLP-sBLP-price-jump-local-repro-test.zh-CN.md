# tBLP/sBLP 价格跳变本地复现测试文档（链上场景模拟）

## 1. 目标

本测试用于在本地 Hardhat 环境复现链上同类现象：

- 初始 `totalSupply` 很小
- `shareToAssetsPrice` 先处于明显低位（不要求精确等于某个值）
- 一笔大额 `LPDeposit` 发生后，价格变量未即时刷新
- 随后一笔极小 `distributePnl(17963)` 触发 `shareToAssetsPrice` 跳到接近 `1.0`

这份文档只描述“复现现象”，不包含修复方案讨论。

## 2. 链上场景映射（用于对齐测试意图）

- 低价阶段大额入金：`0x0e2eb76b4885e91e132b11a425cfe315b7a48fdca3cf0e19bccf7288a8e775a3`
- 后续小额入金：`0x87292db4c4fd9048efe0d7f22834451c83922f2f384a2b3c770c165917c0e220`
- 触发价格刷新交易：`0x40d2f0eabec8239c34a83c785389aacf63e0e648b1cb07c8c6938c6dfdcbb000`

本地不要求字节级还原交易，只还原状态演化路径。

## 3. 测试环境

- 项目：`projects/v3-periphery`
- 测试框架：Hardhat + Mocha
- 关键 fixture：`test/fixtures/cleanDeploy.fixture.js`

执行命令：

```bash
yarn test test/trade/blp.price-jump.repro.spec.js
```

## 4. 复现脚本（可直接作为测试文件）

直接使用仓库内现成脚本：

- `test/trade/blp.price-jump.repro.spec.js`

该脚本会直接打印你关心的 USDC 数值：

- `userDepositUSDC`
- `withdrawableBeforeRefreshUSDC`
- `withdrawableAfterRefreshUSDC`

## 5. 预期结果

通过标准（任意一次运行满足以下条件即可）：

- 用户 `deposit` 数值明确可见（本脚本参数为 `9999.000000 USDC`）
- `lowPrice` 位于低价区间（例如 `< 0.8e18`，且大于 0）
- 大额 `LPDeposit` 后：
  - `shareToAssetsPrice` 仍保持入金前的低价（不刷新）
  - `AccPnlPerToken()` 已接近 `1.0e18`
- 执行 `distributePnl(17963)` 后：
  - `shareToAssetsPrice` 跳到接近 `1.0e18`
  - 同一地址 `maxWithdraw` 显著抬升（约 1.4x 以上），并打印为 USDC 数值

## 6. 示例实测数值（一次本地运行）

- 用户 `deposit`: `9999.000000 USDC`
- 刷新前可 `withdraw`: `9998.999999 USDC`
- 刷新后可 `withdraw`: `15288.316876 USDC`

说明：脚本日志里会直接输出以下字段，便于你核对：

- `userDepositUSDC`
- `withdrawableBeforeRefreshUSDC`
- `withdrawableAfterRefreshUSDC`

## 7. 失败排查

- 如果 `lowPrice` 没进入低价区间：检查第 2 步是否先把 `tBLP` 供给压到很小（2 USDB），以及 `reclaimPnl` 是否成功执行。
- 如果 `LPDeposit` 后价格已经变化：检查是否有额外路径调用了 `distributePnl/reclaimPnl`。
- 如果 `distributePnl(17963)` 后不跳变：检查调用者是否为 `pnlHandler`（测试里应 impersonate `tradeManager`）。
