# TradeManager2 优化日志（V2）

## 目标
- 新建 `TradeManager2`，缓解主合约字节码体积压力。
- 保持与 `TradeManager` 一致的**存储布局**、**事件定义**、**public/external 接口**。
- 在不改变核心行为的前提下减少 bytecode 体积。

## 变更文件
- `contracts/TradeManager2.sol`
- `hardhat.config.ts`

## 兼容性检查
对 `TradeManager.sol` 与 `TradeManager2.sol` 做了声明级自动对比，结果如下：
- public/external 函数签名差异：`0`
- event 声明差异：`0`
- 存储声明差异：`0`

说明：在“声明层面”满足你提出的兼容约束。

## V1 改动（本次 V2 之前已完成）
1. 基于 `TradeManager` 复制创建 `TradeManager2`，并修改合约名：
   - `contract tradeManager2 is Initializable`
2. 新增统一 `permit + transferFrom` 逻辑的 helper：
   - `_pullTokenWithOptionalPermit(...)`
3. 新增统一 tick 差值计算 helper：
   - `_absTickDelta(...)`
4. 新增统一 fee 结算/分发 helper：
   - `_settlePoolFees(...)`
5. 在以下函数中替换重复逻辑：
   - `buyYes`
   - `sellYes`
   - `buyNo`
   - `sellNo`
6. 在 `hardhat.config.ts` 中为 `contracts/TradeManager2.sol` 添加编译 override。

## V2 增量改动（本轮）
1. `_checkaddress` 增加同币种保护：
   - `require(tokenIn != tokenOut, "sameToken");`
   - 并移除排序后冗余的 `require(token0 < token1)`。
2. 新增交易后风控检查 helper：
   - `_postTradeExposureChecks(pool)`，内部封装：
     - `_updateExposure(pool)`
     - `_exposureCheck()`
3. 在以下函数中复用 `_postTradeExposureChecks(pool)`，减少重复代码：
   - `buyYes`
   - `sellYes`
   - `buyNo`
   - `sellNo`
4. 合并 exposure 差值计算：
   - 新增 `_exposureDiffs(pool)`，统一返回：
     - `yesAmountDiff`
     - `noAmountDiff`
     - `usdDiff`
   - `_exposureCalculate` 与 `exposureCalculate` 复用该 helper，去除重复 mapping 读取与计算。

## 体积对比
对比 artifact：
- `artifacts/contracts/TradeManager.sol/tradeManager.json`
- `artifacts/contracts/TradeManager2.sol/tradeManager2.json`

### 当前结果（V2）
- `TradeManager`：
  - Creation bytecode：`24218` bytes
  - Deployed bytecode：`24023` bytes
- `TradeManager2`：
  - Creation bytecode：`21323` bytes
  - Deployed bytecode：`21128` bytes

### 差值（TradeManager2 - TradeManager）
- Creation：`-2895` bytes
- Deployed：`-2895` bytes

### V1 到 V2 的增量收益
- V1 `TradeManager2` deployed：`21229` bytes
- V2 `TradeManager2` deployed：`21128` bytes
- V2 额外减少：`101` bytes

## 构建说明
- 添加 `TradeManager2` 编译 override 后，`hardhat compile` 可通过。
- 当前仅有 warning（未使用参数、可收紧 mutability），不影响编译产物与体积统计。
