# BuyNo 前端预算模式接入说明（含可直接复制代码）

## 1. 背景：为什么需要这个脚本

`tradeManager.buyNo(...)` 的实际扣款不是 `amountIn`，而是：

```text
amountOut = Quoter.quoteExactInputSingle(amountIn)
userCost = amountIn - amountOut
fee = userCost * feeRatio / 1_000_000
totalUserDebit = userCost + fee
```

合约里校验为：

```solidity
require(totalUserDebit < maxAmount, "tmu");
```

所以如果前端只拿用户输入值直接塞 `amountIn` / `maxAmount`，会经常遇到：

1. `tmu`（`maxAmount` 不够）
2. USDB 余额不足（`totalUserDebit > balance`）
3. allowance 不足（`totalUserDebit > allowance`）

结论：前端应当把“用户输入预算（含手续费）”反推成可执行的 `amountIn` 和 `maxAmount`。

---

## 2. 这个脚本解决什么问题

输入（前端用户侧）：

1. 用户愿意支付的总 USDB（例如 `3.2`）
2. 市场相关地址与池参数（`pool`、`yesTokenAddress`、`usdbAddress`、`feeTier`、`sqrtPriceLimitX96`）

输出（用于组装 `buyNo`）：

1. `exactInputSingleParams.amountIn`
2. `splitPositionParams.amount`
3. `transferParams.value`
4. `maxAmount`（自动 `totalUserDebit + 1`，满足 `<` 校验）

---

## 3. 方法说明（前端 AI 需要知道的逻辑）

1. 读 `tradeManager.feeAdapter()`，再读 `feeAdapter.poolTotalFeeRatio(pool)`。
2. 调 `quoter.quoteExactInputSingle` 拿某个 `amountIn` 的 `amountOut`。
3. 用上面的公式算 `totalUserDebit`。
4. 对 `amountIn` 做二分搜索，找“在预算内可成交的最大 `amountIn`”。
5. 输出参数 patch 给 `buyNo`。

命名约定（建议前端统一）：

1. `yesTokenAddress` = `exactInputSingleParams.tokenIn`
2. `usdbAddress` = `exactInputSingleParams.tokenOut`
3. 历史兼容：脚本仍接受 `tokenIn/tokenOut`，但新接入统一用 `yesTokenAddress/usdbAddress`

---

## 4. 可直接复制的完整代码（单文件）

> 前端可直接把这段保存为 `buyno-budget-calculator.js`，不依赖仓库其他文件。

```js
import { ethers } from "ethers";

const FEE_SCALE = ethers.BigNumber.from("1000000");
const ONE = ethers.BigNumber.from(1);
const ZERO = ethers.BigNumber.from(0);

const QUOTER_ABI = [
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) external returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)",
];
const TRADE_MANAGER_ABI = ["function feeAdapter() external view returns (address)"];
const FEE_ADAPTER_ABI = [
  "function poolTotalFeeRatio(address pool) external view returns (uint256)",
];
const ERC20_ABI = ["function decimals() external view returns (uint8)"];

function toBn(v) {
  if (ethers.BigNumber.isBigNumber(v)) return v;
  return ethers.BigNumber.from(String(v));
}

function toProvider(providerOrRpc) {
  if (typeof providerOrRpc === "string") {
    return new ethers.providers.JsonRpcProvider(providerOrRpc);
  }
  if (providerOrRpc && typeof providerOrRpc.getBlockNumber === "function") {
    return providerOrRpc;
  }
  throw new Error("providerOrRpc 必须是 RPC URL 或 ethers provider");
}

function parseBudgetRaw(budget, decimals) {
  if (budget === undefined || budget === null) {
    throw new Error("budget 必填");
  }
  if (typeof budget === "string" || typeof budget === "number") {
    return ethers.utils.parseUnits(String(budget), decimals);
  }
  return toBn(budget); // 已经是原始精度值
}

function calcDebit(amountIn, amountOut, feeRatio) {
  if (amountOut.gt(amountIn)) {
    throw new Error("报价异常：amountOut > amountIn");
  }
  const userCost = amountIn.sub(amountOut);
  const feeAmount = userCost.mul(feeRatio).div(FEE_SCALE);
  const totalUserDebit = userCost.add(feeAmount);
  return { userCost, feeAmount, totalUserDebit };
}

function isCallException(err) {
  const msg = String(err?.message || "");
  return err?.code === "CALL_EXCEPTION" || msg.includes("CALL_EXCEPTION");
}

async function quoteExactInputSingle({
  provider,
  quoterAddress,
  yesTokenAddress,
  usdbAddress,
  amountIn,
  feeTier,
  sqrtPriceLimitX96,
  blockTag,
}) {
  const quoter = new ethers.Contract(quoterAddress, QUOTER_ABI, provider);
  const overrides = blockTag !== undefined ? { blockTag } : {};
  const quoted = await quoter.callStatic.quoteExactInputSingle(
    {
      tokenIn: yesTokenAddress,
      tokenOut: usdbAddress,
      amountIn,
      fee: Number(feeTier),
      sqrtPriceLimitX96: toBn(sqrtPriceLimitX96),
    },
    overrides
  );
  return quoted.amountOut || quoted[0];
}

/**
 * 预算反推 buyNo 参数
 * @param {Object} options
 * @param {string|ethers.providers.Provider} options.providerOrRpc
 * @param {string} options.tradeManager
 * @param {string} options.quoter
 * @param {string} options.pool
 * @param {string} options.yesTokenAddress
 * @param {string} options.usdbAddress
 * @param {number} [options.feeTier=2500]
 * @param {string|number|BigNumber} [options.sqrtPriceLimitX96=0]
 * @param {string|number|BigNumber} options.budget 用户预算（推荐传人类可读值，如 "3.2"）
 * @param {number} [options.maxIterations=48]
 * @param {number} [options.blockTag]
 */
export async function recommendBuyNoParamsByBudget(options) {
  const {
    providerOrRpc,
    tradeManager,
    quoter,
    pool,
    yesTokenAddress,
    usdbAddress,
    feeTier = 2500,
    sqrtPriceLimitX96 = 0,
    budget,
    maxIterations = 48,
    blockTag,
  } = options;

  if (!tradeManager || !quoter || !pool || !yesTokenAddress || !usdbAddress) {
    throw new Error("tradeManager/quoter/pool/yesTokenAddress/usdbAddress 必填");
  }

  const provider = toProvider(providerOrRpc);
  const tokenOutContract = new ethers.Contract(usdbAddress, ERC20_ABI, provider);
  const tokenOutDecimals = await tokenOutContract.decimals(
    blockTag !== undefined ? { blockTag } : {}
  );
  const budgetRaw = parseBudgetRaw(budget, tokenOutDecimals);
  if (budgetRaw.lte(ZERO)) throw new Error("budget 必须 > 0");

  const tm = new ethers.Contract(tradeManager, TRADE_MANAGER_ABI, provider);
  const feeAdapter = await tm.feeAdapter(
    blockTag !== undefined ? { blockTag } : {}
  );
  const feeAdapterContract = new ethers.Contract(
    feeAdapter,
    FEE_ADAPTER_ABI,
    provider
  );
  const feeRatio = await feeAdapterContract.poolTotalFeeRatio(
    pool,
    blockTag !== undefined ? { blockTag } : {}
  );

  const cache = new Map();
  async function evaluate(amountIn) {
    const key = amountIn.toString();
    if (cache.has(key)) return cache.get(key);
    let value;
    try {
      const amountOut = await quoteExactInputSingle({
        provider,
        quoterAddress: quoter,
        yesTokenAddress,
        usdbAddress,
        amountIn,
        feeTier,
        sqrtPriceLimitX96,
        blockTag,
      });
      const debit = calcDebit(amountIn, amountOut, feeRatio);
      value = { valid: true, amountIn, amountOut, ...debit };
    } catch (err) {
      if (!isCallException(err)) throw err;
      value = { valid: false, amountIn };
    }
    cache.set(key, value);
    return value;
  }

  // 扩区间 + 二分，找预算内最大的 amountIn
  let low = ONE;
  let lowEval = await evaluate(low);
  if (!lowEval.valid) {
    throw new Error("amountIn=1 就无法报价，无法计算");
  }

  let high = budgetRaw.gt(ONE) ? budgetRaw : ONE;
  let highEval = await evaluate(high);
  let grow = 0;
  while (highEval.valid && highEval.totalUserDebit.lte(budgetRaw) && grow < 30) {
    low = high;
    lowEval = highEval;
    high = high.mul(2);
    highEval = await evaluate(high);
    grow += 1;
  }

  let best = lowEval.totalUserDebit.lte(budgetRaw) ? lowEval : null;
  for (let i = 0; i < Number(maxIterations); i += 1) {
    if (high.lte(low.add(ONE))) break;
    const mid = low.add(high).div(2);
    const midEval = await evaluate(mid);
    if (!midEval.valid) {
      high = mid;
      continue;
    }
    if (midEval.totalUserDebit.lte(budgetRaw)) {
      low = mid;
      best = midEval;
    } else {
      high = mid;
    }
  }

  if (!best) {
    throw new Error("预算内找不到可执行 amountIn");
  }

  const amountInStr = best.amountIn.toString();
  const totalUserDebitStr = best.totalUserDebit.toString();

  return {
    meta: {
      tokenOutDecimals: Number(tokenOutDecimals),
      feeRatio: feeRatio.toString(),
      feeAdapter,
      budgetRaw: budgetRaw.toString(),
      budgetDisplay: ethers.utils.formatUnits(budgetRaw, tokenOutDecimals),
    },
    quote: {
      amountOutRaw: best.amountOut.toString(),
      userCostRaw: best.userCost.toString(),
      feeAmountRaw: best.feeAmount.toString(),
      totalUserDebitRaw: totalUserDebitStr,
      totalUserDebitDisplay: ethers.utils.formatUnits(
        best.totalUserDebit,
        tokenOutDecimals
      ),
    },
    // 直接 patch 到 buyNo 参数
    patch: {
      exactInputSingleParams: {
        amountIn: amountInStr,
        amountOutMinimum: "0",
      },
      splitPositionParams: {
        amount: amountInStr,
      },
      transferParams: {
        value: amountInStr,
      },
      // 合约 require(totalUserDebit < maxAmount)
      maxAmount: best.totalUserDebit.add(ONE).toString(),
    },
  };
}
```

---

## 5. 前端接入示例（直接组装 buyNo）

```js
import { ethers } from "ethers";
import { recommendBuyNoParamsByBudget } from "./buyno-budget-calculator";

async function buildBuyNoTxData({
  rpcUrl,
  userBudget, // 例如 "3.2"
  market,     // 后端返回的市场参数对象
  userAddress
}) {
  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);

  const calc = await recommendBuyNoParamsByBudget({
    providerOrRpc: provider,
    tradeManager: market.vault,                 // TradeManager
    quoter: market.quoter_v2,
    pool: market.pool_address,
    yesTokenAddress: market.yes_token_address,  // 对应 buyNo 的 tokenIn
    usdbAddress: market.usdb_address,           // 对应 buyNo 的 tokenOut
    feeTier: Number(market.fee),                // 2500
    sqrtPriceLimitX96: market.sqrtPriceLimitX96 || "0",
    budget: userBudget,
  });

  return {
    exactInputSingleParams: {
      tokenIn: market.yes_token_address,
      tokenOut: market.usdb_address,
      fee: Number(market.fee),
      recipient: market.vault,
      deadline: Math.floor(Date.now() / 1000) + 3600,
      amountIn: calc.patch.exactInputSingleParams.amountIn,
      amountOutMinimum: calc.patch.exactInputSingleParams.amountOutMinimum,
      sqrtPriceLimitX96: market.sqrtPriceLimitX96 || "0",
    },
    splitPositionParams: {
      collateralToken: market.usdb_address,
      parentCollectionId: market.parent_collection_id,
      conditionId: market.condition_id,
      partition: [1, 2],
      amount: calc.patch.splitPositionParams.amount,
    },
    transferParams: {
      from: market.vault,
      to: market.wrapped1155factory,
      id: market.transfer_token_id, // 由后端返回（不要前端猜）
      value: calc.patch.transferParams.value,
      data: market.calldatabytes,
    },
    noPositionId: market.noposition_id,
    ERC1155Factory: market.wrapped1155factory,
    pool: market.pool_address,
    maxAmount: calc.patch.maxAmount,
    receiver: userAddress,
    permitParams: {
      owner: userAddress,
      spender: ethers.constants.AddressZero,
      value: 0,
      deadline: 0,
      v: 0,
      r: ethers.constants.HashZero,
      s: ethers.constants.HashZero,
    },
    debug: calc, // 可上报日志
  };
}
```

---

## 6. 完整发送示例（可选）

```js
import { ethers } from "ethers";

const TRADE_MANAGER_ABI = [
  "function buyNo((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96),(address collateralToken,bytes32 parentCollectionId,bytes32 conditionId,uint256[] partition,uint256 amount),(address from,address to,uint256 id,uint256 value,bytes data),uint256 noPositionId,address ERC1155Factory,address pool,uint256 maxAmount,address receiver,(address owner,address spender,uint256 value,uint256 deadline,uint8 v,bytes32 r,bytes32 s) permitparams) external",
];

export async function sendBuyNo({
  rpcUrl,
  privateKey,
  tradeManagerAddress,
  params, // buildBuyNoTxData 的返回值
}) {
  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
  const signer = new ethers.Wallet(privateKey, provider);
  const tm = new ethers.Contract(tradeManagerAddress, TRADE_MANAGER_ABI, signer);

  // 预检：先静态模拟，避免直接发失败交易
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
    { from: signer.address }
  );

  const gas = await tm.estimateGas.buyNo(
    params.exactInputSingleParams,
    params.splitPositionParams,
    params.transferParams,
    params.noPositionId,
    params.ERC1155Factory,
    params.pool,
    params.maxAmount,
    params.receiver,
    params.permitParams,
    { from: signer.address }
  );

  const tx = await tm.buyNo(
    params.exactInputSingleParams,
    params.splitPositionParams,
    params.transferParams,
    params.noPositionId,
    params.ERC1155Factory,
    params.pool,
    params.maxAmount,
    params.receiver,
    params.permitParams,
    { gasLimit: gas.mul(120).div(100) }
  );

  return tx; // tx.hash
}
```

---

## 7. 实战注意事项

1. `maxAmount` 必须按 `<` 规则留 1（`totalUserDebit + 1`）。
2. 报价是实时的，点击“确认”前可重新计算一次。
3. 交易前建议检查：
   1. `USDB balance >= totalUserDebit`
   2. `USDB allowance >= totalUserDebit`
4. `deadline` 不要过短（建议 10~60 分钟）。
5. `amountOutMinimum` 如果设置为 0，成交确定性高但滑点保护弱；可按业务设置最小值。

---

## 8. 参考结论（2026-04-15 Base 主网实测）

在该市场参数下，预算 `3.2 USDB` 反推得到的一组参数已真实上链成功（状态 1），可作为逻辑正确性的证明样例。
