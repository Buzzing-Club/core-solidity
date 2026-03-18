# Frontend 询价流程说明（buyYes / buyNo）

本文给前端对接使用，口径与当前合约一致（`TradeManager.sol` / `TradeManager2.sol` 当前实现）。

## 1. 背景和口径

当前 `buyNo` 的扣款口径：

- `userCost = amountIn - amountOut`
- `fee = userCost * feeRatio / 1e6`（`feeRatio` 来自 `feeAdapter.poolTotalFeeRatio(pool)`）
- `totalDebit = userCost + fee`

其中：

- `amountIn`：`buyNo` 内部用于 split/sell 的目标数量（同 `params.amountIn`）
- `amountOut`：把 YES 卖回池子换回的 USDB（`quoteExactInputSingle` 得到）
- 用户实际从钱包被扣的是 `totalDebit`

`buyYes` 口径更简单：

- 用户输入预算 `budget`
- 先扣手续费得到净输入 `amountInAfterFee`
- 用 `amountInAfterFee` 去 quoter 询价 YES 输出

---

## 2. buyNo 询价流程（推荐）

目标：用户输入总预算 `budgetUSDB`（例如 100U），最终链上实际扣款 `totalDebit` 贴近且不超过预算。

### 2.1 流程思路

1. 读取池费率  
   `feeRatio = feeAdapter.poolTotalFeeRatio(pool)`（例如 10000 = 1%）

2. 设定“用于 userCost 的目标预算”（固定口径）  
   前端直接预留固定 fee：  
   `targetUserCost = budgetUSDB - reservedFee`（例如 100 - 1 = 99）

3. 用二分搜索找 `targetAmount`（即 `params.amountIn`）  
   每次试一个 `mid`，调用 quoter：
   - `amountOut = quoteExactInputSingle(YES -> USDB, amountIn=mid)`
   - `userCost(mid) = mid - amountOut`
   - 若 `userCost(mid) <= targetUserCost`，向更大区间搜索；否则向更小区间搜索

4. 得到 `targetAmount` 后，链下回算最终扣款  
   - `userCost = targetAmount - amountOut`
   - `fee = userCost * feeRatio / 1e6`
   - `totalDebit = userCost + fee`
   - 校验 `totalDebit <= budgetUSDB`

5. 把 `targetAmount` 作为 `buyNo` 的核心输入去构建交易参数。

### 2.2 为什么可行

`userCost(mid)` 随 `mid` 单调上升（在正常交易区间下），二分可以快速收敛；  
再加上 `fee` 是 `userCost` 的线性函数，所以 `totalDebit` 也可控，最终能稳定逼近预算。

### 2.3 注意事项

- 前端务必以 `feeAdapter.poolTotalFeeRatio(pool)` 为准，不要写死费率。
- 如果某市场 `YES` token decimals 与 USDB decimals 不一致，前端展示要做单位转换，但扣款公式不变。
- quoter 若偶发 revert，需要做重试/降档（减小 amountIn）再继续搜索。

---

## 3. buyYes 询价流程（简单）

目标：用户输入总预算 `budgetUSDB`，先扣 fee 后再询价。

### 3.1 公式

- `fee = budgetUSDB * feeRatio / 1e6`
- `amountInAfterFee = budgetUSDB - fee`

然后用：

- `quoteExactInputSingle(USDB -> YES, amountIn = amountInAfterFee)`

得到 `amountOutYes`，用于前端展示与下单参数构建。

### 3.2 要点

- `buyYes` 询价不需要二分，单次 quoter 即可。


---

## 4. 可直接使用的参考脚本（与代码同名）

脚本文件：

- `scripts/buyno-quote-budget.js`

该脚本实现了：

- 输入预算与预留 fee
- 二分查找 `targetAmount`
- 回算 `userCost / fee / totalDebit`
- 输出是否 `totalDebit <= budget`

### 4.1 关键变量命名（与脚本一致）

- `usdToPay`：用户输入总预算（USDB）
- `reservedFee`：前端预留手续费（USDB）
- `targetUserCost`：用于二分搜索的目标成本（`usdToPay - reservedFee`）
- `amountMin` / `amountMax`：二分搜索上下界
- `targetAmount`：最终用于 `buyNo(params.amountIn)` 的数量
- `amountOut`：YES -> USDB 的 quoter 输出
- `userCost`：`targetAmount - amountOut`
- `feeAmount`：`userCost * feeRatio / 1e6`
- `totalDebit`：`userCost + feeAmount`

### 4.2 脚本函数流程（与代码一一对应）

1. `getAmountRange(...)`  
   先找到能覆盖 `targetUserCost` 的 `[amountMin, amountMax]`。

2. `getTargetAmount(...)`  
   在区间内二分，找到满足成本约束的 `targetAmount`。

3. `getCurrentUsd(...)`  
   每次二分时计算当前 `userCost`（脚本里命名 `currentUsd`）。

4. 最终回算  
   用 `targetAmount` 再算一次 `amountOut / userCost / feeAmount / totalDebit`，并校验预算。

### 4.3 运行方式（推荐环境变量）

```bash
# Windows PowerShell 示例
$env:BUDGET='100'
$env:RESERVE_FEE='1'
$env:TRADEMANAGER='0x...'
$env:POOL='0x...'
$env:YESTOKEN='0x...'
$env:USDB='0x...'
$env:QUOTER='0x...'
$env:FEETIER='2500'
yarn workspace @pancakeswap/v3-periphery hardhat run ./scripts/buyno-quote-budget.js --network basetestnet
```

---

## 5. 前端落地建议（最小实现）

1. 用户输入 `budgetUSDB`
2. 读取 `feeRatio`
3. `buyNo`：
   - 先算 `targetUserCost`（固定预留 fee）
   - 二分求 `targetAmount`
   - 回算 `totalDebit`
   - 展示“预计扣款/手续费/误差”
4. `buyYes`：
   - `amountInAfterFee = budget - budget*feeRatio/1e6`
   - 单次 quoter
5. 提交交易前再做一次 quick quote，避免价格短时变化导致超预算。

---

## 6. 示例（你提供市场）

在你提供的市场上，`feeRatio=1%` 时：

- `budget=100`, `reservedFee=1`  
  结果可得到 `totalDebit≈99.99`（小于 100）

- `budget=200`, `reservedFee=2`  
  结果可得到 `totalDebit≈199.98`（小于 200）

说明该流程在当前流动性下可用，且满足“贴近预算但不超预算”。

---

## 7. 附录：完整脚本（带注释）

下面代码与 `scripts/buyno-quote-budget.js` 对齐，并在关键步骤增加注释，方便前端直接理解与迁移。

```js
const { ethers } = require('hardhat');

// fee 比例精度，合约里是 1e6
const FEE_SCALE = ethers.BigNumber.from('1000000');
const ZERO = ethers.BigNumber.from('0');

// QuoterV2: exact input single
const QUOTER_ABI = [
  'function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)'
];

// TradeManager: 读取 feeAdapter 地址
const TM_ABI = [
  'function feeAdapter() external view returns (address)'
];

// FeeAdapter: 读取 pool 的总 fee ratio
const FEE_ADAPTER_ABI = [
  'function poolTotalFeeRatio(address pool) external view returns (uint256)'
];

const ERC20_ABI = [
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)'
];

// 从命令行读取参数：--xxx
function getArg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1];
  return fallback;
}

// 从环境变量读取参数
function getEnv(names, fallback = undefined) {
  for (const n of names) {
    const v = process.env[n];
    if (v !== undefined && v !== '') return v;
  }
  return fallback;
}

// 优先读环境变量，再读命令行；支持驼峰/小写多种别名
function getArgAny(names, fallback = undefined) {
  const envNames = names.map((n) => n.replace(/[A-Z]/g, (m) => `_${m}`).toUpperCase());
  const fromEnv = getEnv(envNames);
  if (fromEnv !== undefined) return fromEnv;
  for (const n of names) {
    const v = getArg(n);
    if (v !== undefined) return v;
  }
  return fallback;
}

function requireArgAny(names) {
  const v = getArgAny(names);
  if (!v) throw new Error(`missing --${names.join(' or --')}`);
  return v;
}

function absDiff(a, b) {
  return a.gte(b) ? a.sub(b) : b.sub(a);
}

// 核心询价：输入 YES，输出 USDB
async function quoteExactInputSingle(Quoter, tokenIn, tokenOut, fee, amountIn) {
  const params = {
    tokenIn,
    tokenOut,
    amountIn,
    fee: Number(fee),
    // 不加限价，保持和现有流程一致
    sqrtPriceLimitX96: 0,
  };
  const q = await Quoter.callStatic.quoteExactInputSingle(params);
  return q.amountOut;
}

// currentUsd = userCost = amountIn - amountOut
async function getCurrentUsd(Quoter, yesToken, usdb, feeTier, amountIn) {
  const amountOut = await quoteExactInputSingle(Quoter, yesToken, usdb, feeTier, amountIn);
  if (amountIn.lte(amountOut)) return ZERO;
  return amountIn.sub(amountOut);
}

// 先找二分区间 [amountMin, amountMax]
async function getAmountRange(Quoter, yesToken, usdb, feeTier, targetUserCost) {
  let amountMin = ZERO;
  let amountMax = targetUserCost;

  // 如果上界成本还不够，就指数扩容上界
  let currentUsdAtMax = await getCurrentUsd(Quoter, yesToken, usdb, feeTier, amountMax);
  let tries = 0;
  while (currentUsdAtMax.lt(targetUserCost) && tries < 20) {
    amountMax = amountMax.mul(2);
    currentUsdAtMax = await getCurrentUsd(Quoter, yesToken, usdb, feeTier, amountMax);
    tries += 1;
  }

  return { amountMin, amountMax };
}

// 在区间内二分找到 targetAmount（buyNo 用到的 amountIn）
async function getTargetAmount(Quoter, yesToken, usdb, feeTier, targetUserCost, amountMin, amountMax, maxIter) {
  let low = amountMin;
  let high = amountMax;

  for (let i = 0; i < maxIter; i += 1) {
    if (high.lte(low.add(1))) break;
    const mid = low.add(high).div(2);
    const currentUsd = await getCurrentUsd(Quoter, yesToken, usdb, feeTier, mid);
    if (currentUsd.lte(targetUserCost)) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return low;
}

async function main() {
  const network = await ethers.provider.getNetwork();

  // 1) 用户输入
  const usdToPayStr = getArgAny(['budget', 'usdToPay'], '100');
  const reservedFeeStr = getArgAny(['reservefee', 'reserveFee', 'reservedFee'], '1');

  // 2) 市场配置
  const quoterAddress = requireArgAny(['quoter']);
  const tradeManagerAddress = requireArgAny(['trademanager', 'tradeManager']);
  const poolAddress = requireArgAny(['pool']);
  const yesTokenAddress = requireArgAny(['yestoken', 'yesToken', 'erc20addr']);
  const usdbAddress = requireArgAny(['usdb', 'usdbAddress']);
  const feeTier = getArgAny(['feetier', 'feeTier'], '2500');
  const maxIter = Number(getArgAny(['maxiter', 'maxIter'], '40'));

  const usdbToken = new ethers.Contract(usdbAddress, ERC20_ABI, ethers.provider);
  const yesToken = new ethers.Contract(yesTokenAddress, ERC20_ABI, ethers.provider);
  const usdbDecimals = await usdbToken.decimals();
  const yesTokenDecimals = await yesToken.decimals();
  // 前端展示/脚本显示精度，可按你们习惯覆盖
  const amountInDecimals = Number(getArgAny(['amountindecimals', 'amountInDecimals'], String(usdbDecimals)));
  const usdbSymbol = await usdbToken.symbol().catch(() => 'USDB');
  const yesTokenSymbol = await yesToken.symbol().catch(() => 'YES');

  const usdToPay = ethers.utils.parseUnits(usdToPayStr, usdbDecimals);
  const reservedFee = ethers.utils.parseUnits(reservedFeeStr, usdbDecimals);
  if (reservedFee.gte(usdToPay)) {
    throw new Error('reservedFee must be < usdToPay');
  }

  // 3) 固定口径：从预算中先预留 fee，得到目标成本
  const targetUserCost = usdToPay.sub(reservedFee);

  // 4) 读取链上 fee 配置
  const tradeManager = new ethers.Contract(tradeManagerAddress, TM_ABI, ethers.provider);
  const feeAdapterAddress = await tradeManager.feeAdapter();
  const feeAdapter = new ethers.Contract(feeAdapterAddress, FEE_ADAPTER_ABI, ethers.provider);
  const feeRatio = await feeAdapter.poolTotalFeeRatio(poolAddress);

  // 5) 通过 quoter + 二分找 targetAmount
  const Quoter = new ethers.Contract(quoterAddress, QUOTER_ABI, ethers.provider);
  const { amountMin, amountMax } = await getAmountRange(
    Quoter,
    yesTokenAddress,
    usdbAddress,
    feeTier,
    targetUserCost
  );
  const targetAmount = await getTargetAmount(
    Quoter,
    yesTokenAddress,
    usdbAddress,
    feeTier,
    targetUserCost,
    amountMin,
    amountMax,
    maxIter
  );

  // 6) 回算最终扣款
  const amountOut = await quoteExactInputSingle(Quoter, yesTokenAddress, usdbAddress, feeTier, targetAmount);
  const userCost = targetAmount.sub(amountOut);
  const feeAmount = userCost.mul(feeRatio).div(FEE_SCALE);
  const totalDebit = userCost.add(feeAmount);

  // 7) 输出给前端核对
  console.log('--- buyNo quote (frontend flow) ---');
  console.log('network:', network.name, 'chainId=', Number(network.chainId));
  console.log('pool:', poolAddress);
  console.log('tradeManager:', tradeManagerAddress);
  console.log('feeAdapter:', feeAdapterAddress);
  console.log('feeRatio:', feeRatio.toString(), '(scale=1e6)');

  console.log('usdToPay:', ethers.utils.formatUnits(usdToPay, usdbDecimals), usdbSymbol);
  console.log('reservedFee:', ethers.utils.formatUnits(reservedFee, usdbDecimals), usdbSymbol);
  console.log('targetUserCost:', ethers.utils.formatUnits(targetUserCost, usdbDecimals), usdbSymbol);

  console.log('yesTokenDecimals(onchain):', yesTokenDecimals);
  console.log('amountInDecimals(usedByScript):', amountInDecimals);
  console.log('amountRange amountMin:', ethers.utils.formatUnits(amountMin, amountInDecimals), yesTokenSymbol);
  console.log('amountRange amountMax:', ethers.utils.formatUnits(amountMax, amountInDecimals), yesTokenSymbol);
  console.log('targetAmount:', ethers.utils.formatUnits(targetAmount, amountInDecimals), yesTokenSymbol);

  console.log('amountOut(USDB):', ethers.utils.formatUnits(amountOut, usdbDecimals), usdbSymbol);
  console.log('userCost = targetAmount - amountOut:', ethers.utils.formatUnits(userCost, usdbDecimals), usdbSymbol);
  console.log('fee = userCost * feeRatio / 1e6:', ethers.utils.formatUnits(feeAmount, usdbDecimals), usdbSymbol);
  console.log('totalDebit = userCost + fee:', ethers.utils.formatUnits(totalDebit, usdbDecimals), usdbSymbol);
  console.log('withinBudget(totalDebit <= usdToPay):', totalDebit.lte(usdToPay));
  console.log('budgetDiff:', ethers.utils.formatUnits(absDiff(usdToPay, totalDebit), usdbDecimals), usdbSymbol);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

### 7.2 buyYes 询价完整代码（带注释）

下面是 `buyYes` 对应的完整脚本逻辑，核心是“先扣 fee，再用净额询价”。

```js
const { ethers } = require('hardhat');

const FEE_SCALE = ethers.BigNumber.from('1000000');

const QUOTER_ABI = [
  'function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)'
];

const TM_ABI = [
  'function feeAdapter() external view returns (address)'
];

const FEE_ADAPTER_ABI = [
  'function poolTotalFeeRatio(address pool) external view returns (uint256)'
];

const ERC20_ABI = [
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)'
];

function getArg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1];
  return fallback;
}

function getEnv(names, fallback = undefined) {
  for (const n of names) {
    const v = process.env[n];
    if (v !== undefined && v !== '') return v;
  }
  return fallback;
}

function getArgAny(names, fallback = undefined) {
  const envNames = names.map((n) => n.replace(/[A-Z]/g, (m) => `_${m}`).toUpperCase());
  const fromEnv = getEnv(envNames);
  if (fromEnv !== undefined) return fromEnv;
  for (const n of names) {
    const v = getArg(n);
    if (v !== undefined) return v;
  }
  return fallback;
}

function requireArgAny(names) {
  const v = getArgAny(names);
  if (!v) throw new Error(`missing --${names.join(' or --')}`);
  return v;
}

async function quoteExactInputSingle(Quoter, tokenIn, tokenOut, fee, amountIn) {
  const params = {
    tokenIn,
    tokenOut,
    amountIn,
    fee: Number(fee),
    sqrtPriceLimitX96: 0,
  };
  const q = await Quoter.callStatic.quoteExactInputSingle(params);
  return q.amountOut;
}

async function main() {
  // 1) 用户输入预算（总支付）
  const usdToPayStr = getArgAny(['budget', 'usdToPay'], '100');

  // 2) 市场配置
  const quoterAddress = requireArgAny(['quoter']);
  const tradeManagerAddress = requireArgAny(['trademanager', 'tradeManager']);
  const poolAddress = requireArgAny(['pool']);
  const yesTokenAddress = requireArgAny(['yestoken', 'yesToken', 'erc20addr']);
  const usdbAddress = requireArgAny(['usdb', 'usdbAddress']);
  const feeTier = getArgAny(['feetier', 'feeTier'], '2500');

  const usdbToken = new ethers.Contract(usdbAddress, ERC20_ABI, ethers.provider);
  const yesToken = new ethers.Contract(yesTokenAddress, ERC20_ABI, ethers.provider);
  const usdbDecimals = await usdbToken.decimals();
  const yesTokenDecimals = await yesToken.decimals();
  const usdbSymbol = await usdbToken.symbol().catch(() => 'USDB');
  const yesTokenSymbol = await yesToken.symbol().catch(() => 'YES');

  const usdToPay = ethers.utils.parseUnits(usdToPayStr, usdbDecimals);

  // 3) 读取 pool fee ratio（链上实时）
  const tradeManager = new ethers.Contract(tradeManagerAddress, TM_ABI, ethers.provider);
  const feeAdapterAddress = await tradeManager.feeAdapter();
  const feeAdapter = new ethers.Contract(feeAdapterAddress, FEE_ADAPTER_ABI, ethers.provider);
  const feeRatio = await feeAdapter.poolTotalFeeRatio(poolAddress);

  // 4) buyYes 口径：先扣 fee，再询价
  const feeAmount = usdToPay.mul(feeRatio).div(FEE_SCALE);
  const amountInAfterFee = usdToPay.sub(feeAmount);

  // 5) 用净额 amountInAfterFee 询价 USDB -> YES
  const Quoter = new ethers.Contract(quoterAddress, QUOTER_ABI, ethers.provider);
  const amountOutYes = await quoteExactInputSingle(
    Quoter,
    usdbAddress,
    yesTokenAddress,
    feeTier,
    amountInAfterFee
  );

  // 6) 输出给前端展示
  console.log('usdToPay:', ethers.utils.formatUnits(usdToPay, usdbDecimals), usdbSymbol);
  console.log('feeRatio:', feeRatio.toString());
  console.log('feeAmount:', ethers.utils.formatUnits(feeAmount, usdbDecimals), usdbSymbol);
  console.log('amountInAfterFee:', ethers.utils.formatUnits(amountInAfterFee, usdbDecimals), usdbSymbol);
  console.log('amountOutYes:', ethers.utils.formatUnits(amountOutYes, yesTokenDecimals), yesTokenSymbol);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```
