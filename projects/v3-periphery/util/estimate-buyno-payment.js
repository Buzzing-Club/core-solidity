const { ethers } = require("ethers");

const FEE_SCALE = ethers.BigNumber.from("1000000");
const ZERO = ethers.BigNumber.from("0");
const ONE = ethers.BigNumber.from("1");

const QUOTER_ABI = [
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)",
];

const TRADE_MANAGER_ABI = ["function feeAdapter() external view returns (address)"];

const FEE_ADAPTER_ABI = [
  "function poolTotalFeeRatio(address pool) external view returns (uint256)",
];

const ERC20_ABI = [
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
];

function resolveTokenAddresses(options) {
  const yesTokenAddress = options.yesTokenAddress || options.tokenIn;
  const usdbAddress = options.usdbAddress || options.tokenOut;
  if (!yesTokenAddress || !usdbAddress) {
    throw new Error("yesTokenAddress/usdbAddress (or tokenIn/tokenOut) are required");
  }
  return { yesTokenAddress, usdbAddress };
}

function isRetryableError(err) {
  const msg = (err && err.message ? err.message : String(err)).toLowerCase();
  if (msg.includes("econnreset")) return true;
  if (msg.includes("etimedout")) return true;
  if (msg.includes("missing response")) return true;
  if (msg.includes("server_error")) return true;
  if (msg.includes("rate-limit")) return true;
  if (msg.includes("429")) return true;
  return false;
}

async function withRetry(fn, retries = 3) {
  let lastErr;
  for (let i = 0; i < retries; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryableError(err) || i === retries - 1) break;
      await new Promise((r) => setTimeout(r, 250 * (i + 1)));
    }
  }
  throw lastErr;
}

function buildProvider(rpcInput) {
  const urls = String(rpcInput)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  if (urls.length === 0) {
    throw new Error("rpcUrl cannot be empty");
  }
  if (urls.length === 1) {
    return new ethers.providers.JsonRpcProvider(urls[0]);
  }
  const fallbackEntries = urls.map((url, idx) => ({
    provider: new ethers.providers.JsonRpcProvider(url),
    priority: idx + 1,
    weight: 1,
    stallTimeout: 800,
  }));
  return new ethers.providers.FallbackProvider(fallbackEntries, 1);
}

function getArg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1];
  return fallback;
}

function requireArg(name) {
  const value = getArg(name);
  if (!value) throw new Error(`missing --${name}`);
  return value;
}

function toBigNumber(value) {
  if (ethers.BigNumber.isBigNumber(value)) return value;
  return ethers.BigNumber.from(String(value));
}

function formatBn(value, decimals) {
  return ethers.utils.formatUnits(value, decimals);
}

function calcBuyNoDebit(amountIn, amountOut, feeRatio) {
  if (amountOut.gt(amountIn)) {
    throw new Error("invalid quote: amountOut is greater than amountIn, buyNo would revert");
  }
  const userCost = amountIn.sub(amountOut);
  const feeAmount = userCost.mul(feeRatio).div(FEE_SCALE);
  const totalUserDebit = userCost.add(feeAmount);
  return { userCost, feeAmount, totalUserDebit };
}

async function quoteExactInputSingle(quoter, params, blockTag) {
  const quoteParams = {
    tokenIn: params.tokenIn,
    tokenOut: params.tokenOut,
    amountIn: params.amountIn,
    fee: Number(params.feeTier),
    sqrtPriceLimitX96: params.sqrtPriceLimitX96,
  };
  const overrides = blockTag !== undefined ? { blockTag } : {};
  const result = await withRetry(() =>
    quoter.callStatic.quoteExactInputSingle(quoteParams, overrides)
  );
  return result.amountOut;
}

async function buildContext(options) {
  const { yesTokenAddress, usdbAddress } = resolveTokenAddresses(options);
  const provider = buildProvider(options.rpcUrl);
  const quoter = new ethers.Contract(options.quoter, QUOTER_ABI, provider);
  const tradeManager = new ethers.Contract(options.tradeManager, TRADE_MANAGER_ABI, provider);
  const usdb = new ethers.Contract(usdbAddress, ERC20_ABI, provider);
  const yesToken = new ethers.Contract(yesTokenAddress, ERC20_ABI, provider);

  const overrides = options.blockTag !== undefined ? { blockTag: options.blockTag } : {};
  const [feeAdapterAddress, usdbDecimals, usdbSymbol, tokenInDecimals, tokenInSymbol] =
    await Promise.all([
      withRetry(() => tradeManager.feeAdapter(overrides)),
      withRetry(() => usdb.decimals(overrides)),
      withRetry(() => usdb.symbol(overrides)).catch(() => "USDB"),
      withRetry(() => yesToken.decimals(overrides)),
      withRetry(() => yesToken.symbol(overrides)).catch(() => "YES_TOKEN"),
    ]);

  const feeAdapter = new ethers.Contract(feeAdapterAddress, FEE_ADAPTER_ABI, provider);
  const feeRatio = await withRetry(() =>
    feeAdapter.poolTotalFeeRatio(options.pool, overrides)
  );

  return {
    provider,
    quoter,
    feeRatio,
    usdbDecimals,
    usdbSymbol,
    yesTokenDecimals: tokenInDecimals,
    yesTokenSymbol: tokenInSymbol,
    feeAdapterAddress,
    yesTokenAddress,
    usdbAddress,
  };
}

async function estimateBuyNoByAmountIn(options) {
  const amountIn = toBigNumber(options.amountIn);
  if (amountIn.lte(ZERO)) {
    throw new Error("amountIn must be > 0");
  }

  const ctx = await buildContext(options);
  const amountOut = await quoteExactInputSingle(
    ctx.quoter,
    {
      tokenIn: ctx.yesTokenAddress,
      tokenOut: ctx.usdbAddress,
      amountIn,
      feeTier: options.feeTier,
      sqrtPriceLimitX96: options.sqrtPriceLimitX96,
    },
    options.blockTag
  );

  const debit = calcBuyNoDebit(amountIn, amountOut, ctx.feeRatio);
  return {
    mode: "amountIn",
    rpcUsed: options.rpcUrl,
    feeRatio: ctx.feeRatio.toString(),
    feeAdapter: ctx.feeAdapterAddress,
    yesTokenAddress: ctx.yesTokenAddress,
    usdbAddress: ctx.usdbAddress,
    yesTokenDecimals: ctx.yesTokenDecimals,
    yesTokenSymbol: ctx.yesTokenSymbol,
    usdbDecimals: ctx.usdbDecimals,
    usdbSymbol: ctx.usdbSymbol,
    tokenOutDecimals: ctx.usdbDecimals,
    tokenOutSymbol: ctx.usdbSymbol,
    // backward-compatible keys
    tokenInDecimals: ctx.yesTokenDecimals,
    tokenInSymbol: ctx.yesTokenSymbol,
    params: {
      amountIn: amountIn.toString(),
      amountOutMinimum: "0",
      maxAmount: debit.totalUserDebit.add(ONE).toString(),
    },
    quote: {
      amountOut: amountOut.toString(),
    },
    debitRaw: {
      userCost: debit.userCost.toString(),
      feeAmount: debit.feeAmount.toString(),
      totalUserDebit: debit.totalUserDebit.toString(),
    },
    debitDisplay: {
      userCost: formatBn(debit.userCost, ctx.usdbDecimals),
      feeAmount: formatBn(debit.feeAmount, ctx.usdbDecimals),
      totalUserDebit: formatBn(debit.totalUserDebit, ctx.usdbDecimals),
    },
  };
}

async function recommendBuyNoForBudget(options) {
  const budget = toBigNumber(options.budget);
  if (budget.lte(ZERO)) {
    throw new Error("budget must be > 0");
  }

  const ctx = await buildContext(options);
  const evalCache = new Map();
  let invalidQuoteCount = 0;

  async function evalAmountIn(amountIn) {
    const key = amountIn.toString();
    if (evalCache.has(key)) return evalCache.get(key);

    let value;
    try {
      const amountOut = await quoteExactInputSingle(
        ctx.quoter,
        {
          tokenIn: ctx.yesTokenAddress,
          tokenOut: ctx.usdbAddress,
          amountIn,
          feeTier: options.feeTier,
          sqrtPriceLimitX96: options.sqrtPriceLimitX96,
        },
        options.blockTag
      );
      const debit = calcBuyNoDebit(amountIn, amountOut, ctx.feeRatio);
      value = { valid: true, amountIn, amountOut, ...debit };
    } catch (err) {
      if (err && err.code === "CALL_EXCEPTION") {
        invalidQuoteCount += 1;
        value = { valid: false, amountIn };
      } else {
        throw err;
      }
    }
    evalCache.set(key, value);
    return value;
  }

  let low = ONE;
  let high = budget.gt(ONE) ? budget : ONE;
  let lowEval = await evalAmountIn(low);
  if (!lowEval.valid) {
    return {
      mode: "budget",
      feasible: false,
      reason: "quoter reverted even for amountIn=1",
      usdbDecimals: ctx.usdbDecimals,
      usdbSymbol: ctx.usdbSymbol,
      tokenOutDecimals: ctx.usdbDecimals,
      tokenOutSymbol: ctx.usdbSymbol,
      feeRatio: ctx.feeRatio.toString(),
      feeAdapter: ctx.feeAdapterAddress,
      rpcUsed: options.rpcUrl,
    };
  }

  let highEval = await evalAmountIn(high);
  let growCount = 0;

  while (highEval.valid && highEval.totalUserDebit.lte(budget) && growCount < 24) {
    low = high;
    lowEval = highEval;
    high = high.mul(2);
    highEval = await evalAmountIn(high);
    growCount += 1;
  }

  if (growCount === 0 && highEval.valid && highEval.totalUserDebit.gt(budget)) {
    if (lowEval.totalUserDebit.gt(budget)) {
      return {
        mode: "budget",
        feasible: false,
        reason: "budget is too small for amountIn=1",
        usdbDecimals: ctx.usdbDecimals,
        usdbSymbol: ctx.usdbSymbol,
        tokenOutDecimals: ctx.usdbDecimals,
        tokenOutSymbol: ctx.usdbSymbol,
        feeRatio: ctx.feeRatio.toString(),
        feeAdapter: ctx.feeAdapterAddress,
        rpcUsed: options.rpcUrl,
      };
    }
  }

  let best = lowEval.totalUserDebit.lte(budget) ? lowEval : null;
  const maxIter = Number(options.maxIter || 40);
  for (let i = 0; i < maxIter; i += 1) {
    if (high.lte(low.add(ONE))) break;
    const mid = low.add(high).div(2);
    const midEval = await evalAmountIn(mid);
    if (!midEval.valid) {
      high = mid;
      continue;
    }
    if (midEval.totalUserDebit.lte(budget)) {
      low = mid;
      best = midEval;
    } else {
      high = mid;
    }
  }

  if (!best) {
    return {
      mode: "budget",
      feasible: false,
      reason: "no valid amountIn found within budget",
      usdbDecimals: ctx.usdbDecimals,
      usdbSymbol: ctx.usdbSymbol,
      tokenOutDecimals: ctx.usdbDecimals,
      tokenOutSymbol: ctx.usdbSymbol,
      feeRatio: ctx.feeRatio.toString(),
      feeAdapter: ctx.feeAdapterAddress,
      rpcUsed: options.rpcUrl,
      invalidQuoteCount,
    };
  }

  const budgetDiff = budget.sub(best.totalUserDebit);
  return {
    mode: "budget",
    feasible: true,
    rpcUsed: options.rpcUrl,
    feeRatio: ctx.feeRatio.toString(),
    feeAdapter: ctx.feeAdapterAddress,
    yesTokenAddress: ctx.yesTokenAddress,
    usdbAddress: ctx.usdbAddress,
    yesTokenDecimals: ctx.yesTokenDecimals,
    yesTokenSymbol: ctx.yesTokenSymbol,
    usdbDecimals: ctx.usdbDecimals,
    usdbSymbol: ctx.usdbSymbol,
    tokenOutDecimals: ctx.usdbDecimals,
    tokenOutSymbol: ctx.usdbSymbol,
    // backward-compatible keys
    tokenInDecimals: ctx.yesTokenDecimals,
    tokenInSymbol: ctx.yesTokenSymbol,
    budgetRaw: budget.toString(),
    budgetDisplay: formatBn(budget, ctx.usdbDecimals),
    params: {
      amountIn: best.amountIn.toString(),
      amountOutMinimum: "0",
      maxAmount: best.totalUserDebit.add(ONE).toString(),
    },
    quote: {
      amountOut: best.amountOut.toString(),
    },
    debitRaw: {
      userCost: best.userCost.toString(),
      feeAmount: best.feeAmount.toString(),
      totalUserDebit: best.totalUserDebit.toString(),
    },
    debitDisplay: {
      userCost: formatBn(best.userCost, ctx.usdbDecimals),
      feeAmount: formatBn(best.feeAmount, ctx.usdbDecimals),
      totalUserDebit: formatBn(best.totalUserDebit, ctx.usdbDecimals),
      budgetDiff: formatBn(budgetDiff, ctx.usdbDecimals),
    },
    invalidQuoteCount,
  };
}

function parseBlockTag(raw) {
  if (raw === undefined || raw === null || raw === "") return undefined;
  return Number(raw);
}

async function main() {
  const mode = getArg("mode", "budget"); // budget | amountIn
  const rpcUrl = getArg(
    "rpcUrl",
    process.env.RPC_URL ||
      process.env.BASE_RPC_URL ||
      "https://mainnet.base.org,https://base-rpc.publicnode.com,https://base.llamarpc.com"
  );

  const options = {
    rpcUrl,
    quoter: requireArg("quoter"),
    tradeManager: requireArg("tradeManager"),
    pool: requireArg("pool"),
    yesTokenAddress: getArg("yesTokenAddress", getArg("tokenIn")),
    usdbAddress: getArg("usdbAddress", getArg("tokenOut", "0x89401d7C5F5Cf4936F10418B9C536f97b0bCf71B")),
    feeTier: Number(getArg("feeTier", "2500")),
    sqrtPriceLimitX96: toBigNumber(getArg("sqrtPriceLimitX96", "0")),
    blockTag: parseBlockTag(getArg("blockTag")),
    maxIter: Number(getArg("maxIter", "40")),
  };

  if (!options.yesTokenAddress) {
    throw new Error("missing --yesTokenAddress (or --tokenIn)");
  }

  if (mode === "amountIn") {
    options.amountIn = getArg("amountIn");
    if (!options.amountIn) throw new Error("missing --amountIn in amountIn mode");
    const out = await estimateBuyNoByAmountIn(options);
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (mode === "budget") {
    const budgetRaw = getArg("budgetRaw");
    const budgetDisplay = getArg("budget");
    if (!budgetRaw && !budgetDisplay) {
      throw new Error("missing --budgetRaw or --budget in budget mode");
    }

    if (budgetRaw) {
      options.budget = toBigNumber(budgetRaw);
    } else {
      const provider = buildProvider(options.rpcUrl);
      const usdb = new ethers.Contract(options.usdbAddress, ERC20_ABI, provider);
      const decimals = await withRetry(() =>
        usdb.decimals(options.blockTag !== undefined ? { blockTag: options.blockTag } : {})
      );
      options.budget = ethers.utils.parseUnits(budgetDisplay, decimals);
    }

    const out = await recommendBuyNoForBudget(options);
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  throw new Error(`unsupported --mode ${mode}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  calcBuyNoDebit,
  estimateBuyNoByAmountIn,
  recommendBuyNoForBudget,
};
