const { ethers } = require('ethers');

const FEE_SCALE = ethers.BigNumber.from('1000000');
const ONE = ethers.BigNumber.from(1);
const ZERO = ethers.BigNumber.from(0);

const QUOTER_ABI = [
  'function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) external returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)'
];

const TRADE_MANAGER_ABI = ['function feeAdapter() external view returns (address)'];
const FEE_ADAPTER_ABI = ['function poolTotalFeeRatio(address pool) external view returns (uint256)'];
const ERC20_ABI = ['function decimals() external view returns (uint8)'];

function resolveTokenAddresses(options) {
  const yesTokenAddress = options.yesTokenAddress || options.tokenIn;
  const usdbAddress = options.usdbAddress || options.tokenOut;
  if (!yesTokenAddress || !usdbAddress) {
    throw new Error('yesTokenAddress and usdbAddress are required');
  }
  return { yesTokenAddress, usdbAddress };
}

function toProvider(providerOrRpc) {
  if (!providerOrRpc) throw new Error('providerOrRpc is required');
  if (typeof providerOrRpc === 'string') {
    return new ethers.providers.JsonRpcProvider(providerOrRpc);
  }
  if (providerOrRpc && typeof providerOrRpc.getBlockNumber === 'function') {
    return providerOrRpc;
  }
  throw new Error('providerOrRpc must be RPC URL string or ethers provider');
}

function toBn(value) {
  if (ethers.BigNumber.isBigNumber(value)) return value;
  return ethers.BigNumber.from(String(value));
}

function parseBudgetToRaw(budget, decimals) {
  if (budget === undefined || budget === null) {
    throw new Error('budget is required');
  }
  if (typeof budget === 'number' || typeof budget === 'string') {
    return ethers.utils.parseUnits(String(budget), decimals);
  }
  return toBn(budget);
}

function computeTotalUserDebit(amountIn, amountOut, feeRatio) {
  if (amountOut.gt(amountIn)) {
    throw new Error('invalid quote: amountOut > amountIn');
  }
  const userCost = amountIn.sub(amountOut);
  const feeAmount = userCost.mul(feeRatio).div(FEE_SCALE);
  const totalUserDebit = userCost.add(feeAmount);
  return { userCost, feeAmount, totalUserDebit };
}

async function fetchFeeRatio(provider, tradeManagerAddress, pool, blockTag) {
  const tm = new ethers.Contract(tradeManagerAddress, TRADE_MANAGER_ABI, provider);
  const overrides = blockTag !== undefined ? { blockTag } : {};
  const feeAdapterAddress = await tm.feeAdapter(overrides);
  const feeAdapter = new ethers.Contract(feeAdapterAddress, FEE_ADAPTER_ABI, provider);
  const feeRatio = await feeAdapter.poolTotalFeeRatio(pool, overrides);
  return { feeAdapterAddress, feeRatio };
}

async function quoteAmountOut(provider, quoterAddress, params, blockTag) {
  const quoter = new ethers.Contract(quoterAddress, QUOTER_ABI, provider);
  const overrides = blockTag !== undefined ? { blockTag } : {};
  const quoted = await quoter.callStatic.quoteExactInputSingle(
    {
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      amountIn: params.amountIn,
      fee: Number(params.feeTier),
      sqrtPriceLimitX96: params.sqrtPriceLimitX96,
    },
    overrides
  );
  return quoted.amountOut || quoted[0];
}

function isCallException(err) {
  return !!(err && (err.code === 'CALL_EXCEPTION' || String(err.message || '').includes('CALL_EXCEPTION')));
}

async function recommendBuyNoParamsByBudget(options) {
  const {
    providerOrRpc,
    quoter,
    tradeManager,
    pool,
    feeTier = 2500,
    sqrtPriceLimitX96 = 0,
    budget,
    maxIterations = 48,
    blockTag,
  } = options;

  if (!quoter || !tradeManager || !pool) {
    throw new Error('quoter/tradeManager/pool are required');
  }
  const { yesTokenAddress, usdbAddress } = resolveTokenAddresses(options);

  const provider = toProvider(providerOrRpc);
  const tokenOutContract = new ethers.Contract(usdbAddress, ERC20_ABI, provider);
  const decimals = await tokenOutContract.decimals(blockTag !== undefined ? { blockTag } : {});
  const budgetRaw = parseBudgetToRaw(budget, decimals);
  if (budgetRaw.lte(ZERO)) throw new Error('budget must be greater than 0');

  const { feeAdapterAddress, feeRatio } = await fetchFeeRatio(provider, tradeManager, pool, blockTag);

  const evalCache = new Map();
  async function evaluate(amountIn) {
    const key = amountIn.toString();
    if (evalCache.has(key)) return evalCache.get(key);
    let result;
    try {
      const amountOut = await quoteAmountOut(
        provider,
        quoter,
        {
          tokenIn: yesTokenAddress,
          tokenOut: usdbAddress,
          feeTier,
          amountIn,
          sqrtPriceLimitX96: toBn(sqrtPriceLimitX96),
        },
        blockTag
      );
      const debit = computeTotalUserDebit(amountIn, amountOut, feeRatio);
      result = { valid: true, amountIn, amountOut, ...debit };
    } catch (err) {
      if (!isCallException(err)) throw err;
      result = { valid: false, amountIn };
    }
    evalCache.set(key, result);
    return result;
  }

  let low = ONE;
  let lowEval = await evaluate(low);
  if (!lowEval.valid) {
    throw new Error('quoter reverted for amountIn=1');
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
    throw new Error('no feasible amountIn found within budget');
  }

  const amountInStr = best.amountIn.toString();
  const totalUserDebitStr = best.totalUserDebit.toString();

  return {
    meta: {
      yesTokenAddress,
      usdbAddress,
      usdbDecimals: Number(decimals),
      tokenOutDecimals: Number(decimals),
      feeRatio: feeRatio.toString(),
      feeAdapter: feeAdapterAddress,
      budgetRaw: budgetRaw.toString(),
      budgetDisplay: ethers.utils.formatUnits(budgetRaw, decimals),
    },
    quote: {
      amountOutRaw: best.amountOut.toString(),
      userCostRaw: best.userCost.toString(),
      feeAmountRaw: best.feeAmount.toString(),
      totalUserDebitRaw: totalUserDebitStr,
      totalUserDebitDisplay: ethers.utils.formatUnits(best.totalUserDebit, decimals),
    },
    // These are the fields front-end usually needs to patch into buyNo params.
    patch: {
      exactInputSingleParams: {
        amountIn: amountInStr,
        amountOutMinimum: '0',
      },
      splitPositionParams: {
        amount: amountInStr,
      },
      transferParams: {
        value: amountInStr,
      },
      maxAmount: best.totalUserDebit.add(ONE).toString(),
    },
  };
}

module.exports = {
  computeTotalUserDebit,
  recommendBuyNoParamsByBudget,
};
module.exports.default = module.exports;
