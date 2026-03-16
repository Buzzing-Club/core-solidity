const fs = require("fs");
const path = require("path");
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployCleanFixture } = require("../fixtures/cleanDeploy.fixture");

const TOKEN_DATA =
  "0x627562626c79000000000000000000000000000000000000000000000000000c42554c000000000000000000000000000000000000000000000000000000000612";
const ZERO_BYTES32 = "0x" + "00".repeat(32);
const FEE = 2500;
const TICK_SPACING = 50;
const FEE_SCALE = ethers.BigNumber.from("1000000");
const MIN_U = Number(process.env.RANDOM_TRADE_MIN_U || "5");
const MAX_U = Number(process.env.RANDOM_TRADE_MAX_U || "100");
const INTERVAL_MIN = Number(process.env.RANDOM_DT_MIN || "2");
const INTERVAL_MAX = Number(process.env.RANDOM_DT_MAX || "10");
const DYN_FILTER_PERIOD = Number(process.env.DYN_FILTER_PERIOD || "2");
const DYN_DECAY_PERIOD = Number(process.env.DYN_DECAY_PERIOD || "600");
const DYN_REDUCTION_FACTOR = process.env.DYN_REDUCTION_FACTOR || "850000000000000000";
const DYN_MAX_ACCUMULATOR = process.env.DYN_MAX_ACCUMULATOR || "1000000000";
const DYN_VARIABLE_FEE_CONTROL = process.env.DYN_VARIABLE_FEE_CONTROL || "10000000000000000";
const DYN_BASE_FEE_UNIT = process.env.DYN_BASE_FEE_UNIT || "2000000000000";
const TRADE_COUNT = Number(process.env.RANDOM_TRADE_COUNT || "1000");
const REPORT_PREFIX =
  process.env.RANDOM_REPORT_PREFIX ||
  `random-yes-trades-${TRADE_COUNT}-${INTERVAL_MIN}to${INTERVAL_MAX}s-${MIN_U}to${MAX_U}U`;

function normalize(addr) {
  return addr.toLowerCase();
}

function sortPair(a, b) {
  return normalize(a) < normalize(b) ? [a, b] : [b, a];
}

function floorToSpacing(v, spacing) {
  return Math.floor(v / spacing) * spacing;
}

function ceilToSpacing(v, spacing) {
  return Math.ceil(v / spacing) * spacing;
}

function yesPriceToTick(yesPrice, usdb, yesToken) {
  const [token0] = sortPair(usdb, yesToken);
  const ratio = normalize(token0) === normalize(usdb) ? 1 / yesPrice : yesPrice;
  return Math.floor(Math.log(ratio) / Math.log(1.0001));
}

function rangeToTicks(yesPriceLower, yesPriceUpper, usdb, yesToken) {
  const t1 = yesPriceToTick(yesPriceLower, usdb, yesToken);
  const t2 = yesPriceToTick(yesPriceUpper, usdb, yesToken);
  const lower = Math.min(t1, t2);
  const upper = Math.max(t1, t2);
  return {
    tickLower: ceilToSpacing(lower, TICK_SPACING),
    tickUpper: floorToSpacing(upper, TICK_SPACING),
  };
}

function parseEvent(receipt, contract, eventName) {
  for (const log of receipt.logs) {
    if (normalize(log.address) !== normalize(contract.address)) continue;
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed.name === eventName) return parsed;
    } catch (e) {
      // ignore
    }
  }
  return null;
}

function ensureReportsDir() {
  const reportsDir = path.join(__dirname, "reports");
  fs.mkdirSync(reportsDir, { recursive: true });
  return reportsDir;
}

function writeReport(filePrefix, rows, meta) {
  const dir = ensureReportsDir();
  const jsonPath = path.join(dir, `${filePrefix}.json`);
  const csvPath = path.join(dir, `${filePrefix}.csv`);
  fs.writeFileSync(jsonPath, JSON.stringify({ meta, rows }, null, 2), "utf8");

  const headers = [
    "idx",
    "action",
    "blockNumber",
    "timestamp",
    "targetTradeU",
    "actualTradeUSDB",
    "tradeSizeU",
    "amountInRaw",
    "grossOutUSDB",
    "tickBefore",
    "tickAfter",
    "ticksCrossed",
    "referenceTick",
    "referenceVolatility",
    "accumulator",
    "volatilityLastUpdate",
    "dynamicFeeUSDB",
    "totalFeeUSDB",
    "yesBalanceRawAfter",
  ];
  const lines = [headers.join(",")];
  for (const r of rows) lines.push(headers.map((h) => r[h]).join(","));
  fs.writeFileSync(csvPath, `${lines.join("\n")}\n`, "utf8");
  return { jsonPath, csvPath };
}

function generateFeeChartSvg(filePath, rows) {
  const width = 1400;
  const height = 760;
  const pad = 90;
  const xs = rows.map((r) => Number(r.idx));
  const dyn = rows.map((r) => Number(r.dynamicFeeUSDB));
  const tot = rows.map((r) => Number(r.totalFeeUSDB));
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = 0;
  const yMax = Math.max(...dyn, ...tot, 1);

  const sx = (x) => pad + ((x - xMin) / (xMax - xMin || 1)) * (width - pad * 2);
  const sy = (y) => height - pad - ((y - yMin) / (yMax - yMin || 1)) * (height - pad * 2);
  const mk = (arr) => arr.map((v, i) => `${i === 0 ? "M" : "L"} ${sx(xs[i]).toFixed(2)} ${sy(v).toFixed(2)}`).join(" ");
  const pathDyn = mk(dyn);
  const pathTot = mk(tot);

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>
  <text x="${width / 2}" y="36" text-anchor="middle" font-size="24" font-family="Arial">Random YES Trades (1000) - Dynamic Fee vs Total Fee</text>
  <text x="${width / 2}" y="62" text-anchor="middle" font-size="14" font-family="Arial">${INTERVAL_MIN}~${INTERVAL_MAX}s, target ${MIN_U}U~${MAX_U}U, vfc=${DYN_VARIABLE_FEE_CONTROL}</text>
  <line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" stroke="#333" stroke-width="2"/>
  <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${height - pad}" stroke="#333" stroke-width="2"/>
  <path d="${pathDyn}" fill="none" stroke="#2563eb" stroke-width="2"/>
  <path d="${pathTot}" fill="none" stroke="#dc2626" stroke-width="2"/>
  <rect x="${width - 320}" y="88" width="14" height="14" fill="#2563eb"/>
  <text x="${width - 298}" y="100" font-size="13" font-family="Arial">Dynamic Fee (USDB)</text>
  <rect x="${width - 320}" y="114" width="14" height="14" fill="#dc2626"/>
  <text x="${width - 298}" y="126" font-size="13" font-family="Arial">Total Fee (USDB)</text>
</svg>`;
  fs.writeFileSync(filePath, svg, "utf8");
}

function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function yesPriceFromTick(tick, usdb, yesToken) {
  const ratio = Math.pow(1.0001, tick);
  const [token0] = sortPair(usdb, yesToken);
  if (normalize(token0) === normalize(usdb)) return 1 / ratio;
  return ratio;
}

function randomIntInclusive(rand, min, max) {
  return min + Math.floor(rand() * (max - min + 1));
}

async function nextDeadline(provider, ttlSeconds = 3600) {
  const block = await provider.getBlock("latest");
  return block.timestamp + ttlSeconds;
}

describe("Random YES buy/sell 1000 trades on configured liquidity", function () {
  it("runs random trades and plots dynamic/total fee", async function () {
    this.timeout(1200000);
    const rand = lcg(20260314);

    const ctx = await deployCleanFixture();
    const [, trader] = await ethers.getSigners();
    const { core, business } = ctx;
    const poolArtifact = require("@pancakeswap/v3-core/artifacts/contracts/BuzzingSwapPool.sol/BuzzingSwapPool.json");

    const sUsds = await (await ethers.getContractFactory("SUsds")).deploy(business.usdc.address);
    await sUsds.deployed();
    await (await business.tradeManager.setYieldProtocol(sUsds.address)).wait();

    await (
      await business.dynamicFeeManager.reset(
        DYN_FILTER_PERIOD,
        DYN_DECAY_PERIOD,
        DYN_REDUCTION_FACTOR,
        DYN_MAX_ACCUMULATOR,
        DYN_VARIABLE_FEE_CONTROL,
        DYN_BASE_FEE_UNIT,
        business.tradeManager.address
      )
    ).wait();

    const questionId = "0x" + "0".repeat(63) + "9";
    await (await business.ctf.prepareCondition(ctx.deployer.address, questionId, 2)).wait();
    const conditionId = await business.ctf.getConditionId(ctx.deployer.address, questionId, 2);
    const yesCollectionId = await business.ctf.getCollectionId(ZERO_BYTES32, conditionId, 1);
    const noCollectionId = await business.ctf.getCollectionId(ZERO_BYTES32, conditionId, 2);
    const yesPositionId = await business.ctf.getPositionId(business.usdb.address, yesCollectionId);
    const noPositionId = await business.ctf.getPositionId(business.usdb.address, noCollectionId);
    const yesTokenAddr = await business.wrapped1155Factory.getWrapped1155(business.ctf.address, yesPositionId, TOKEN_DATA);
    await business.wrapped1155Factory.getWrapped1155(business.ctf.address, noPositionId, TOKEN_DATA);

    await (await core.factory.createPool(yesTokenAddr, business.usdb.address, FEE)).wait();
    const pool = await core.factory.getPool(yesTokenAddr, business.usdb.address, FEE);
    const poolContract = new ethers.Contract(pool, poolArtifact.abi, ctx.deployer);

    const sqrtPrice0p5 = ethers.BigNumber.from("56022770974786139918731938227");
    const sqrtPrice2 = ethers.BigNumber.from("112045541949572279837463876454");
    const [token0, token1] = sortPair(business.usdb.address, yesTokenAddr);
    const initSqrt = normalize(token0) === normalize(business.usdb.address) ? sqrtPrice2 : sqrtPrice0p5;
    await (await poolContract.initialize(initSqrt)).wait();

    const LP_ROLE = ethers.utils.formatBytes32String("LP");
    const BUFFER_ROLE = ethers.utils.formatBytes32String("Buffer");
    await (await business.feeAdapter.setPoolTotalFeeRatio(pool, 100000)).wait();
    await (await business.feeAdapter.setPoolRole(pool, LP_ROLE, ctx.deployer.address, 70000)).wait();
    await (await business.feeAdapter.setPoolRole(pool, BUFFER_ROLE, ctx.deployer.address, 30000)).wait();
    await (await business.feeAdapter.setPoolReferShare(pool, 0)).wait();

    const prefund = ethers.utils.parseUnits("3000000", 6);
    await (await business.usdc.mint(ctx.deployer.address, prefund)).wait();
    await (await business.usdc.approve(business.usdb.address, prefund)).wait();
    await (await business.usdb.deposit(ctx.deployer.address, prefund)).wait();
    await (await business.usdb.transfer(business.tradeManager.address, prefund.div(2))).wait();
    await (await business.usdb.approve(business.tradeManager.address, prefund.div(3))).wait();
    await (await business.tradeManager.LPDeposit(prefund.div(6), ctx.deployer.address, true)).wait();
    await (await business.tradeManager.LPDeposit(prefund.div(6), ctx.deployer.address, false)).wait();

    const splitAmount = ethers.utils.parseUnits("1000", 6);
    const splitPositionParams = {
      collateralToken: business.usdb.address,
      parentCollectionId: ZERO_BYTES32,
      conditionId,
      partition: [1, 2],
      amount: splitAmount,
    };
    const transferParams = {
      from: business.tradeManager.address,
      to: business.wrapped1155Factory.address,
      id: yesPositionId,
      value: splitAmount,
      data: TOKEN_DATA,
    };

    const yesBand = rangeToTicks(0.5, 1.0, business.usdb.address, yesTokenAddr);
    const usdbBand = rangeToTicks(0.001, 0.5, business.usdb.address, yesTokenAddr);
    const y1000 = ethers.utils.parseUnits("1000", 6);

    const mintDeadline = await nextDeadline(ethers.provider);
    const mintYes = {
      token0,
      token1,
      fee: FEE,
      tickLower: yesBand.tickLower,
      tickUpper: yesBand.tickUpper,
      amount0Desired: normalize(token0) === normalize(yesTokenAddr) ? y1000 : ethers.utils.parseUnits("1", 6),
      amount1Desired: normalize(token1) === normalize(yesTokenAddr) ? y1000 : ethers.utils.parseUnits("1", 6),
      amount0Min: 0,
      amount1Min: 0,
      recipient: ctx.deployer.address,
      deadline: mintDeadline,
    };
    await (
      await business.tradeManager.addLiquidity(
        mintYes,
        splitPositionParams,
        transferParams,
        business.wrapped1155Factory.address,
        pool
      )
    ).wait();

    const mintUsdb = {
      token0,
      token1,
      fee: FEE,
      tickLower: usdbBand.tickLower,
      tickUpper: usdbBand.tickUpper,
      amount0Desired: normalize(token0) === normalize(business.usdb.address) ? y1000 : ethers.utils.parseUnits("1", 6),
      amount1Desired: normalize(token1) === normalize(business.usdb.address) ? y1000 : ethers.utils.parseUnits("1", 6),
      amount0Min: 0,
      amount1Min: 0,
      recipient: ctx.deployer.address,
      deadline: mintDeadline,
    };
    await (
      await business.tradeManager.addLiquidity(
        mintUsdb,
        splitPositionParams,
        transferParams,
        business.wrapped1155Factory.address,
        pool
      )
    ).wait();

    const yesToken = await ethers.getContractAt("contracts/Wrapped1155Factory.sol:IERC20", yesTokenAddr);
    const yesDecimals = 6;

    const traderUsdc = ethers.utils.parseUnits("200000", 6);
    await (await business.usdc.mint(trader.address, traderUsdc)).wait();
    await (await business.usdc.connect(trader).approve(business.usdb.address, traderUsdc)).wait();
    await (await business.usdb.connect(trader).deposit(trader.address, traderUsdc)).wait();
    await (await business.usdb.connect(trader).approve(business.tradeManager.address, ethers.constants.MaxUint256)).wait();
    await (await yesToken.connect(trader).approve(business.tradeManager.address, ethers.constants.MaxUint256)).wait();

    const permit = {
      owner: trader.address,
      spender: ethers.constants.AddressZero,
      value: 0,
      deadline: 0,
      v: 0,
      r: ethers.constants.HashZero,
      s: ethers.constants.HashZero,
    };
    const feeRatio = await business.feeAdapter.poolTotalFeeRatio(pool);

    const rows = [];
    for (let i = 1; i <= TRADE_COUNT; i++) {
      const dtSeconds = randomIntInclusive(rand, INTERVAL_MIN, INTERVAL_MAX);
      await ethers.provider.send("evm_increaseTime", [dtSeconds]);
      await ethers.provider.send("evm_mine", []);

      const targetU = randomIntInclusive(rand, MIN_U, MAX_U);
      const targetRaw = ethers.utils.parseUnits(String(targetU), 6);
      const yesBal = await yesToken.balanceOf(trader.address);
      const yesPos = await business.tradeManager.userYesPositions(trader.address, pool);
      const posYesBal = yesPos.yesTokenAmount;

      const slotBefore = await poolContract.slot0();
      const tickBefore = slotBefore.tick;
      let action = "BUY";
      const tickNum = Number(tickBefore);
      const forceSell = tickNum < 400;
      const forceBuy = tickNum > 5000;
      const trySell = yesBal.gt(0) && posYesBal.gt(0) && (forceSell ? true : forceBuy ? false : rand() < 0.45);

      let dynamicFee = ethers.constants.Zero;
      let totalFee = ethers.constants.Zero;
      let grossOut = ethers.constants.Zero;
      let amountInRaw = targetRaw;
      let receipt;

      try {
        if (trySell) {
          action = "SELL";
          const p = yesPriceFromTick(tickBefore, business.usdb.address, yesTokenAddr);
          const safeP = p > 0 ? p : 0.5;
          const sellU = randomIntInclusive(rand, MIN_U, MAX_U);
          const desiredYes = sellU / safeP;
          let sellRaw = ethers.utils.parseUnits(desiredYes.toFixed(yesDecimals), yesDecimals);
          if (sellRaw.lte(0)) sellRaw = ethers.utils.parseUnits("1", yesDecimals);
          if (sellRaw.gt(yesBal)) sellRaw = yesBal;
          if (sellRaw.gt(posYesBal)) sellRaw = posYesBal;
          if (sellRaw.lte(0)) {
            action = "BUY";
          }
          amountInRaw = sellRaw;

          if (action === "SELL") {
            const params = {
              tokenIn: yesTokenAddr,
              tokenOut: business.usdb.address,
              fee: FEE,
              recipient: business.tradeManager.address,
              deadline: await nextDeadline(ethers.provider),
              amountIn: sellRaw,
              amountOutMinimum: 0,
              sqrtPriceLimitX96: 0,
            };

            try {
              const tx = await business.tradeManager.connect(trader).sellYes(params, pool, 0, trader.address, permit);
              receipt = await tx.wait();
              const sellEv = parseEvent(receipt, business.tradeManager, "SellYes");
              grossOut = sellEv ? sellEv.args.amountOut : ethers.constants.Zero;
            } catch (sellErr) {
              action = "BUY_FALLBACK";
            }
          }
        } else {
          const params = {
            tokenIn: business.usdb.address,
            tokenOut: yesTokenAddr,
            fee: FEE,
            recipient: trader.address,
            deadline: await nextDeadline(ethers.provider),
            amountIn: targetRaw,
            amountOutMinimum: 0,
            sqrtPriceLimitX96: 0,
          };
          const tx = await business.tradeManager.connect(trader).buyYes(params, pool, 0, trader.address, permit);
          receipt = await tx.wait();
        }
        if ((action === "BUY" || action === "BUY_FALLBACK") && !receipt) {
          const params = {
            tokenIn: business.usdb.address,
            tokenOut: yesTokenAddr,
            fee: FEE,
            recipient: trader.address,
            deadline: await nextDeadline(ethers.provider),
            amountIn: targetRaw,
            amountOutMinimum: 0,
            sqrtPriceLimitX96: 0,
          };
          const tx = await business.tradeManager.connect(trader).buyYes(params, pool, 0, trader.address, permit);
          receipt = await tx.wait();
          amountInRaw = targetRaw;
        }
      } catch (e) {
        throw new Error(
          `trade failed at idx=${i}, action=${action}, targetU=${targetU}, amountInRaw=${amountInRaw.toString()}, tickBefore=${tickBefore}, yesBal=${yesBal.toString()}, posYesBal=${posYesBal.toString()}, err=${e.message}`
        );
      }

      const slotAfter = await poolContract.slot0();
      const tickAfter = slotAfter.tick;
      const ticksCrossed = Math.abs(Number(tickAfter) - Number(tickBefore));

      if (action === "SELL") {
        dynamicFee = await business.dynamicFeeManager.computeFee(pool, ticksCrossed, grossOut);
        const staticFee = grossOut.mul(feeRatio).div(FEE_SCALE);
        totalFee = staticFee.add(dynamicFee);
      }

      const pv = await business.dynamicFeeManager.poolVolatility(pool);
      const yesBalAfter = await yesToken.balanceOf(trader.address);
      const block = await ethers.provider.getBlock(receipt.blockNumber);

      rows.push({
        idx: i.toString(),
        action,
        blockNumber: receipt.blockNumber.toString(),
        timestamp: block.timestamp.toString(),
        targetTradeU: targetU.toString(),
        actualTradeUSDB:
          action === "SELL"
            ? ethers.utils.formatUnits(grossOut, 6)
            : ethers.utils.formatUnits(amountInRaw, 6),
        tradeSizeU: targetU.toString(),
        amountInRaw: amountInRaw.toString(),
        grossOutUSDB: ethers.utils.formatUnits(grossOut, 6),
        tickBefore: String(tickBefore),
        tickAfter: String(tickAfter),
        ticksCrossed: String(ticksCrossed),
        referenceTick: String(pv.referenceTick),
        referenceVolatility: String(pv.referenceVolatility),
        accumulator: String(pv.accumulator),
        volatilityLastUpdate: String(pv.lastUpdate),
        dynamicFeeUSDB: ethers.utils.formatUnits(dynamicFee, 6),
        totalFeeUSDB: ethers.utils.formatUnits(totalFee, 6),
        yesBalanceRawAfter: yesBalAfter.toString(),
      });
    }

    const filePrefix = REPORT_PREFIX;
    const out = writeReport(filePrefix, rows, {
      note: "Random YES buy/sell on prepared liquidity. Dynamic fee params unified.",
      tradeCount: TRADE_COUNT,
      intervalSecondsRange: `${INTERVAL_MIN}~${INTERVAL_MAX}`,
      tradeSizeRangeU: `${MIN_U}~${MAX_U}`,
      dynamicFeeParams: {
        filterPeriod: DYN_FILTER_PERIOD,
        decayPeriod: DYN_DECAY_PERIOD,
        reductionFactor: DYN_REDUCTION_FACTOR,
        maxAccumulator: DYN_MAX_ACCUMULATOR,
        variableFeeControl: DYN_VARIABLE_FEE_CONTROL,
        baseFeeUnit: DYN_BASE_FEE_UNIT,
      },
    });
    const svgPath = path.join(ensureReportsDir(), `${filePrefix}-fees.svg`);
    generateFeeChartSvg(svgPath, rows);

    console.log("[random-trades] report:", out);
    console.log("[random-trades] chart:", svgPath);
    expect(rows.length).to.equal(TRADE_COUNT);
  });
});
