const { expect } = require("chai");
const { ethers } = require("hardhat");

function toBps(fee, tradeSize) {
  return fee.mul(10_000).div(tradeSize);
}

describe("Dynamic fee behavior (pure manager)", function () {
  it("keeps dynamic fee low at low frequency and increases in same-block burst", async function () {
    const [deployer] = await ethers.getSigners();
    const manager = await (await ethers.getContractFactory("DynamicFeeManagerTest", deployer)).deploy();
    await manager.deployed();

    const pool = ethers.Wallet.createRandom().address;
    const tradeSize = ethers.utils.parseUnits("50000", 6); // 50,000 USDB (6 decimals)
    const ticksCrossed = 50;
    const nextTicks = [50, 100, 150, 200];

    await (
      await manager.setParams(
        0, // filterPeriod: any >0 sec gap will reset reference tick
        3600,
        0, // no carry-over in low-frequency path
        1_000_000_000,
        ethers.utils.parseUnits("500", 18),
        ethers.utils.parseUnits("0.000002", 18)
      )
    ).wait();

    const latestTs = (await ethers.provider.getBlock("latest")).timestamp;
    await (await manager.setPoolState(pool, 0, 0, 0, latestTs)).wait();

    for (const currentTick of nextTicks) {
      await ethers.provider.send("evm_increaseTime", [2]);
      await ethers.provider.send("evm_mine", []);
      await (await manager.updateVolatility(pool, currentTick, ticksCrossed)).wait();
    }

    const lowFreqState = await manager.poolVolatility(pool);
    const lowFreqFee = await manager.computeFee(pool, ticksCrossed, tradeSize);
    const lowFreqBps = toBps(lowFreqFee, tradeSize);

    const resetTs = (await ethers.provider.getBlock("latest")).timestamp;
    await (await manager.setPoolState(pool, 0, 0, 0, resetTs)).wait();

    await ethers.provider.send("evm_setAutomine", [false]);
    const txs = [];
    for (const currentTick of nextTicks) {
      txs.push(manager.updateVolatility(pool, currentTick, ticksCrossed));
    }
    await Promise.all(txs);
    await ethers.provider.send("evm_mine", []);
    await ethers.provider.send("evm_setAutomine", [true]);

    const highFreqState = await manager.poolVolatility(pool);
    const highFreqFee = await manager.computeFee(pool, ticksCrossed, tradeSize);
    const highFreqBps = toBps(highFreqFee, tradeSize);

    console.log("[dynamic-fee] low-frequency accumulator:", lowFreqState.accumulator.toString());
    console.log("[dynamic-fee] high-frequency accumulator:", highFreqState.accumulator.toString());
    console.log("[dynamic-fee] low-frequency fee(bps):", lowFreqBps.toString());
    console.log("[dynamic-fee] high-frequency fee(bps):", highFreqBps.toString());

    expect(lowFreqState.accumulator).to.be.lt(highFreqState.accumulator);
    expect(lowFreqFee).to.be.lt(highFreqFee);
    expect(highFreqFee).to.be.gte(lowFreqFee.mul(2));
  });
});
