const { expect } = require("chai");
const { ethers } = require("hardhat");

const ONE = 10n ** 18n;
const USDB_DECIMALS = 10n ** 6n;

function toBn(n) {
  return BigInt(n.toString());
}

function pctBps(fee, tradeSize) {
  return Number((fee * 10_000n) / tradeSize);
}

function updateVolatility(state, params, currentTick, ticksCrossed, nowTs) {
  const next = { ...state };
  const t = nowTs - next.lastUpdate;

  if (t > params.filterPeriod) next.referenceTick = currentTick;
  if (t > params.decayPeriod) next.referenceVolatility = 0n;
  else if (t > params.filterPeriod) next.referenceVolatility = (next.accumulator * params.reductionFactor) / ONE;

  const distance = BigInt(Math.abs(next.referenceTick - currentTick));
  let va = next.referenceVolatility + distance + BigInt(ticksCrossed);
  if (va > params.maxAccumulator) va = params.maxAccumulator;

  next.accumulator = va;
  next.lastUpdate = nowTs;
  return next;
}

function computeFee(params, ticksCrossed, tradeSizeRaw, accumulator) {
  const baseFee = (BigInt(ticksCrossed) * params.baseFeeUnit * tradeSizeRaw) / ONE;
  const variableFee = (params.variableFeeControl * accumulator * accumulator) / ONE;
  return baseFee + variableFee;
}

describe("Dynamic fee parameter search", function () {
  it("finds candidate params: low frequency near-zero, high frequency and large order in 1%-3%", async function () {
    const scenarios = {
      lowFreqSmall: {
        tradeSize: 10_000n * USDB_DECIMALS, // 10k USDB
        ticksCrossed: 10,
        thresholdMaxBps: 10, // <= 0.10%
      },
      highFreqBurst: {
        tradeSize: 50_000n * USDB_DECIMALS, // 50k USDB
        ticksCrossed: 50,
        minBps: 100, // 1%
        maxBps: 300, // 3%
      },
      largeOrder: {
        tradeSize: 500_000n * USDB_DECIMALS, // 500k USDB
        ticksCrossed: 800,
        minBps: 100, // 1%
        maxBps: 300, // 3%
      },
    };

    const paramsTemplate = {
      filterPeriod: 2, // Base one block ~2s, same block=high freq
      decayPeriod: 600,
      reductionFactor: 0n, // avoid carry when low-frequency
      maxAccumulator: 1_000_000_000n,
    };

    // Search ranges around practical magnitudes for current formula.
    const baseFeeUnits = [
      "6000000000000",
      "8000000000000",
      "10000000000000",
      "12000000000000",
      "14000000000000",
      "16000000000000",
    ].map((v) => BigInt(v));

    const variableFeeControls = [
      "600000000000000000000",
      "800000000000000000000",
      "900000000000000000000",
      "1000000000000000000000",
      "1200000000000000000000",
      "1400000000000000000000",
    ].map((v) => BigInt(v));

    const candidates = [];

    for (const baseFeeUnit of baseFeeUnits) {
      for (const variableFeeControl of variableFeeControls) {
        const params = {
          ...paramsTemplate,
          baseFeeUnit,
          variableFeeControl,
        };

        // low frequency: each trade separated by > decay, accumulator should stay very low
        let st = { referenceTick: 0, referenceVolatility: 0n, lastUpdate: 0, accumulator: 0n };
        st = updateVolatility(st, params, 10, scenarios.lowFreqSmall.ticksCrossed, 700);
        const lowFreqFee = computeFee(params, scenarios.lowFreqSmall.ticksCrossed, scenarios.lowFreqSmall.tradeSize, st.accumulator);
        const lowFreqBps = pctBps(lowFreqFee, scenarios.lowFreqSmall.tradeSize);

        // high frequency: same block burst, increasing currentTick
        st = { referenceTick: 0, referenceVolatility: 0n, lastUpdate: 1_000, accumulator: 0n };
        const ticks = [200, 400, 600, 800, 1000];
        for (const tk of ticks) {
          st = updateVolatility(st, params, tk, scenarios.highFreqBurst.ticksCrossed, 1_000);
        }
        const highFreqFee = computeFee(params, scenarios.highFreqBurst.ticksCrossed, scenarios.highFreqBurst.tradeSize, st.accumulator);
        const highFreqBps = pctBps(highFreqFee, scenarios.highFreqBurst.tradeSize);

        // large order: low frequency but big tick-crossing single trade
        st = { referenceTick: 0, referenceVolatility: 0n, lastUpdate: 0, accumulator: 0n };
        st = updateVolatility(st, params, 800, scenarios.largeOrder.ticksCrossed, 700);
        const largeFee = computeFee(params, scenarios.largeOrder.ticksCrossed, scenarios.largeOrder.tradeSize, st.accumulator);
        const largeBps = pctBps(largeFee, scenarios.largeOrder.tradeSize);

        const pass =
          lowFreqBps <= scenarios.lowFreqSmall.thresholdMaxBps &&
          highFreqBps >= scenarios.highFreqBurst.minBps &&
          highFreqBps <= scenarios.highFreqBurst.maxBps &&
          largeBps >= scenarios.largeOrder.minBps &&
          largeBps <= scenarios.largeOrder.maxBps;

        if (pass) {
          candidates.push({
            baseFeeUnit: baseFeeUnit.toString(),
            variableFeeControl: variableFeeControl.toString(),
            lowFreqBps,
            highFreqBps,
            largeBps,
          });
        }
      }
    }

    console.log("[dynamic-fee-search] candidates:", candidates.length);
    candidates.slice(0, 10).forEach((c, i) => {
      console.log(
        `[dynamic-fee-search][${i}] baseFeeUnit=${c.baseFeeUnit}, variableFeeControl=${c.variableFeeControl}, low=${c.lowFreqBps}bps, high=${c.highFreqBps}bps, large=${c.largeBps}bps`
      );
    });

    expect(candidates.length).to.be.gt(0);

    // Ensure at least one robust candidate where high-frequency is clearly higher than low-frequency.
    const robust = candidates.find((c) => c.highFreqBps >= c.lowFreqBps * 10);
    expect(robust, "no robust candidate found").to.exist;
  });
});

