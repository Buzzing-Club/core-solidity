# TradeManager2 `addLiquidity` 新增参数说明（中文）

## 1. 背景
`TradeManager2` 的 `addLiquidity` 增加了若干参数，用于：
- 记录“非 auth 归属者”的初始仓位；
- 解决链下计算导致的 USDB 资金需求不确定问题（由调用方显式传入）。

## 2. 函数签名变化

当前 `addLiquidity` 签名：

```solidity
function addLiquidity(
    MintParams calldata mintParams,
    SplitPositionParams calldata splitPositionParmas,
    ERC1155TransferParams calldata transferParmas,
    address ERC1155Factory,
    address poolAddress,
    bool isYes,
    uint256 initialTokenAmount,
    uint256 initialUsdCost,
    uint256 usdbForLiquidity
)
```

相比旧版本，新增了 4 个参数：
- `isYes`
- `initialTokenAmount`
- `initialUsdCost`
- `usdbForLiquidity`

## 3. 新参数含义

### 3.1 `isYes`（bool）
- 含义：本次新增流动性对应的初始仓位方向。
- `true`：记录到 `UserYesPosition`
- `false`：记录到 `UserNoPosition`

### 3.2 `initialTokenAmount`（uint256）
- 含义：本次初始仓位的 token 数量（链下计算后传入）。
- 用途：在 `recipient` 非 auth 时，累计写入用户仓位数量。

### 3.3 `initialUsdCost`（uint256）
- 含义：本次初始仓位对应的成本（USD/USDB 口径，链下计算后传入）。
- 用途：在 `recipient` 非 auth 时，累计写入用户仓位成本。

### 3.4 `usdbForLiquidity`（uint256）
- 含义：除 `splitPositionParmas.amount` 之外，NPM mint 流动性还需要的 USDB 数量（链下计算后传入）。
- 用途：补齐资金，避免仅 mint `splitPositionParmas.amount` 导致 LP 侧 USDB 不足。

## 4. 合约内行为变化

### 4.1 USDB mint 逻辑
由原来的：

```solidity
mint(splitPositionParmas.amount)
```

改为：

```solidity
mint(splitPositionParmas.amount + usdbForLiquidity)
```

### 4.2 初始仓位写入逻辑（仅非 auth 归属者）
当 `wards[mintParams.recipient] != 1` 时：
- `isYes == true`：
  - `userYesPositions[recipient][poolAddress].yesTokenAmount += initialTokenAmount`
  - `userYesPositions[recipient][poolAddress].usdSpent += initialUsdCost`
- `isYes == false`：
  - `userNoPositions[recipient][poolAddress].noTokenAmount += initialTokenAmount`
  - `userNoPositions[recipient][poolAddress].usdSpent += initialUsdCost`

> 当前是“直接累加”策略，不做“是否初始为 0”判断。

## 5. 调用方责任（链下）
调用 `addLiquidity` 前，调用方需要在链下准备并传入：
1. 仓位方向：`isYes`
2. 初始数量：`initialTokenAmount`
3. 初始成本：`initialUsdCost`
4. LP 额外所需 USDB：`usdbForLiquidity`

如果链下估算偏小，可能在后续步骤出现资金不足导致交易回滚。

## 6. 兼容性影响
- 该函数 ABI 已变化，所有调用方（前端、脚本、后端服务）必须同步升级参数。
- 旧调用方式将无法直接调用新函数签名。

## 7. 建议
- 在链下封装统一计算模块，避免不同调用方口径不一致。
- 为新增参数增加调用前校验与日志，便于排查资金不足或仓位偏差问题。
