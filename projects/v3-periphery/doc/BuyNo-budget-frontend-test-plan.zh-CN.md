# BuyNo 预算反推前端测试方案（给前端/前端AI）

## 1. 测试目标

验证前端在“用户输入预算 USDB（含手续费）”时，能够稳定得到可执行的 `buyNo` 参数，并在链上预检通过。

核心目标：

1. 预算反推结果正确：`amountIn`、`maxAmount`、`totalUserDebit` 一致。
2. 合约约束满足：`totalUserDebit < maxAmount`。
3. 账户约束可提前发现：余额/授权不足可前置拦截。
4. 在报价波动下具备可用性：重新报价后仍能快速重算。

命名约定（测试同样按此）：

1. `yesTokenAddress` 对应链上 `tokenIn`
2. `usdbAddress` 对应链上 `tokenOut`

---

## 2. 验收标准（必须满足）

1. 计算层：
   1. `totalUserDebit = (amountIn - amountOut) + fee`
   2. `fee = (amountIn - amountOut) * feeRatio / 1_000_000`
2. 参数层：
   1. `splitPositionParams.amount == exactInputSingleParams.amountIn`
   2. `transferParams.value == exactInputSingleParams.amountIn`
   3. `maxAmount == totalUserDebit + 1`
3. 交易前检查层：
   1. `USDB balance >= totalUserDebit`
   2. `USDB allowance >= totalUserDebit`
4. 合约预检层：
   1. `callStatic.buyNo(...)` 成功（同一组参数）

---

## 3. 测试分层

### A. 单元测试（纯函数）

目标：不依赖链，保证数学逻辑正确。

建议覆盖：

1. `calcDebit` 的整数除法行为（向下取整）。
2. `maxAmount = totalUserDebit + 1` 的边界意义。
3. 预算输入解析：
   1. `"3.2"`（显示值） -> `3200000`（USDB 6 位）
   2. 原始值 `BigNumber("3200000")` 直传

### B. 算法测试（二分搜索）

目标：验证“预算反推 amountIn”稳定性。

方法：mock `quoteExactInputSingle` 返回可控曲线（单调）。

断言：

1. 返回的 `amountIn` 是预算内最大可行值（或接近最大值）。
2. 把 `amountIn + 1` 再算一次时通常会超预算（或更接近上界）。

### C. 链上集成测试（只读）

目标：用真实 Base RPC 验证端到端计算和预检。

建议：

1. 固定 `blockTag` 做可复现回归。
2. 同时跑 `latest` 做实时健康检查。
3. `callStatic.buyNo` 必须通过。

### D. 主网灰度测试（小额真实交易）

目标：验证“真实扣款与预估扣款”一致。

步骤：

1. 先跑 `callStatic`。
2. 发小额交易。
3. 读取前后 `USDB balance/allowance` 差值。
4. 差值应接近 `totalUserDebit`（考虑整数舍入，通常应完全一致）。

---

## 4. 用例矩阵（前端最少跑这些）

1. 正常预算：`3.2`（你们已实测过，可作为回归基线）。
2. 边界预算：刚好触发 `< maxAmount`（验证 `+1` 必要性）。
3. 极小预算：小到无法成交时应返回“不可执行”。
4. 余额不足：预算可算出，但余额不足时前端拦截。
5. 授权不足：预算可算出，但 allowance 不足时前端引导授权。
6. 报价波动：首次计算后等待 10~30s 重新计算，结果应自洽。
7. deadline 过短：模拟超时后提示用户刷新报价。

---

## 5. 推荐测试方法（前端执行流程）

每次点击“确认买入 No”前，执行以下流水线：

1. `recommendBuyNoParamsByBudget(...)` 计算 patch 参数。
2. 读取链上余额和授权（USDB）。
3. 校验 `balance/allowance >= totalUserDebit`。
4. `callStatic.buyNo(...)` 预检。
5. 通过后再发真实交易。

这是最稳的线上策略。

---

## 6. 可直接复制的测试代码模板（Vitest/Jest 风格）

```js
import { describe, it, expect } from "vitest";
import { ethers } from "ethers";
import { recommendBuyNoParamsByBudget } from "../util/buyno-budget-calculator";

const RPC = "https://mainnet.base.org";
const provider = new ethers.providers.JsonRpcProvider(RPC);

const CASE = {
  tradeManager: "0x4a8793AE855AE40A00504D61d2ac4074B5214669",
  quoter: "0xCC0980f0dE44AAf8d7A5b8f5c0bA478714ec0E20",
  pool: "0x7b9121F042b649FcbFe8F9d75a5a8D1435879FFf",
  yesTokenAddress: "0x94592347AfAdbFaE185BB3B1a80f8781Ed3c1845",
  usdbAddress: "0x89401d7C5F5Cf4936F10418B9C536f97b0bCf71B",
  feeTier: 2500,
  sqrtPriceLimitX96: "2507794810551837812222381260800",
};

describe("buyNo budget calculator", () => {
  it("budget=3.2 should return self-consistent params", async () => {
    const result = await recommendBuyNoParamsByBudget({
      providerOrRpc: provider,
      ...CASE,
      budget: "3.2",
    });

    const amountIn = ethers.BigNumber.from(result.patch.exactInputSingleParams.amountIn);
    const amountSplit = ethers.BigNumber.from(result.patch.splitPositionParams.amount);
    const amountTransfer = ethers.BigNumber.from(result.patch.transferParams.value);
    const maxAmount = ethers.BigNumber.from(result.patch.maxAmount);
    const totalDebit = ethers.BigNumber.from(result.quote.totalUserDebitRaw);

    expect(amountIn.gt(0)).toBe(true);
    expect(amountSplit.eq(amountIn)).toBe(true);
    expect(amountTransfer.eq(amountIn)).toBe(true);
    expect(maxAmount.eq(totalDebit.add(1))).toBe(true);
    expect(totalDebit.lt(maxAmount)).toBe(true);
  });
});
```

---

## 7. 链上预检模板（前端可作为 E2E）

```js
const TRADE_MANAGER_ABI = [
  "function buyNo((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96),(address collateralToken,bytes32 parentCollectionId,bytes32 conditionId,uint256[] partition,uint256 amount),(address from,address to,uint256 id,uint256 value,bytes data),uint256 noPositionId,address ERC1155Factory,address pool,uint256 maxAmount,address receiver,(address owner,address spender,uint256 value,uint256 deadline,uint8 v,bytes32 r,bytes32 s) permitparams) external",
];

async function preflightBuyNo({
  provider,
  tradeManagerAddress,
  fromAddress,
  params,
}) {
  const tm = new ethers.Contract(tradeManagerAddress, TRADE_MANAGER_ABI, provider);
  await tm.callStatic.buyNo(
    params.exactInputSingleParams,
    params.splitPositionParams,
    params.transferParams,
    params.noPositionId,
    params.ERC1155Factory,
    params.pool,
    params.maxAmount,
    params.receiver,
    params.permitParams,
    { from: fromAddress }
  );
  return true;
}
```

---

## 8. 常见失败与定位

1. `tmu`：`maxAmount` 太小，通常没做 `+1` 或报价过期。
2. `ERC20: transfer amount exceeds balance`：余额不足。
3. `ERC20: insufficient allowance`：授权不足。
4. `TTO`（deadline）：前端参数过期。
5. `CALL_EXCEPTION`（quoter）：池状态或参数不匹配，检查 `yesTokenAddress/usdbAddress/fee/pool/sqrtPriceLimitX96`。

---

## 9. 回归建议

每次前端改动后至少回归：

1. `budget=3.2`（历史基准）
2. `budget=3.82`（边界接近余额场景）
3. 余额不足场景
4. 授权不足场景

建议接入 CI 的 nightly 只读链上测试（`callStatic` + 计算一致性），避免线上回归。
