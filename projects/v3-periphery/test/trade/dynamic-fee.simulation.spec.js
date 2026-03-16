const { ethers } = require("hardhat");

const USDB_DECIMALS = 6;

function asBps(amount, base) {
  return amount.mul(10_000).div(base);
}

describe("Dynamic fee local simulation", function () {
  it("prints block/size/totalFee/dynamicFee for each simulated trade", async function () {
    this.timeout(120000);
    const [deployer] = await ethers.getSigners();
    const feeManager = await (await ethers.getContractFactory("DynamicFeeManagerTest", deployer)).deploy();
    await feeManager.deployed();

    // Candidate params from search result
    const filterPeriod = 2;
    const decayPeriod = 600;
    const reductionFactor = 0;
    const maxAccumulator = 1_000_000_000;
    const variableFeeControl = ethers.BigNumber.from("1000000000000000000000"); // 1000 * 1e18
    const baseFeeUnit = ethers.BigNumber.from("12000000000000");

    await (
      await feeManager.setParams(
        filterPeriod,
        decayPeriod,
        reductionFactor,
        maxAccumulator,
        variableFeeControl,
        baseFeeUnit
      )
    ).wait();

    const pool = ethers.Wallet.createRandom().address;
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    await (await feeManager.setPoolState(pool, 0, 0, 0, now)).wait();

    // Static fee for totalFee display (example: 1.00%)
    const staticFeeBps = 100;

    // step:
    // - dt: seconds to advance before this trade (0 means same block burst when automine is off)
    // - tick: current tick used in updateVolatility
    // - ticksCrossed: simulated tick crossings for this trade
    // - size: trade size in USDB (human-readable)
    const steps = [
      { label: "LF-1", dt: 700, tick: 10, ticksCrossed: 10, size: "10000" },
      { label: "LF-2", dt: 700, tick: 20, ticksCrossed: 10, size: "12000" },
      { label: "NF-1", dt: 2, tick: 200, ticksCrossed: 50, size: "50000" },
      { label: "NF-2", dt: 2, tick: 350, ticksCrossed: 60, size: "60000" },
      { label: "HF-1", dt: 0, tick: 500, ticksCrossed: 80, size: "80000" },
      { label: "HF-2", dt: 0, tick: 700, ticksCrossed: 100, size: "100000" },
      { label: "HF-3", dt: 0, tick: 900, ticksCrossed: 120, size: "120000" },
    ];

    console.log("[dynamic-fee-sim] params");
    console.log(
      `[dynamic-fee-sim] filter=${filterPeriod}, decay=${decayPeriod}, reduction=${reductionFactor}, maxAcc=${maxAccumulator}, variableFeeControl=${variableFeeControl.toString()}, baseFeeUnit=${baseFeeUnit.toString()}, staticFeeBps=${staticFeeBps}`
    );
    console.log(
      "[dynamic-fee-sim] columns: label | blockNumber | tradeSize(USDB) | ticksCrossed | accumulator | dynamicFee(USDB) | dynamicFee(bps) | totalFee(USDB) | totalFee(bps)"
    );

    await ethers.provider.send("evm_setAutomine", [false]);
    for (const s of steps) {
      if (s.dt > 0) {
        await ethers.provider.send("evm_increaseTime", [s.dt]);
      }

      const tradeSize = ethers.utils.parseUnits(s.size, USDB_DECIMALS);
      const tx = await feeManager.updateVolatility(pool, s.tick, s.ticksCrossed);
      await ethers.provider.send("evm_mine", []);
      await tx.wait();

      const pv = await feeManager.poolVolatility(pool);
      const dynamicFee = await feeManager.computeFee(pool, s.ticksCrossed, tradeSize);
      const staticFee = tradeSize.mul(staticFeeBps).div(10_000);
      const totalFee = staticFee.add(dynamicFee);

      const block = await ethers.provider.getBlock("latest");
      const dynamicFeeBps = asBps(dynamicFee, tradeSize);
      const totalFeeBps = asBps(totalFee, tradeSize);

      console.log(
        [
          s.label,
          block.number.toString(),
          s.size,
          s.ticksCrossed.toString(),
          pv.accumulator.toString(),
          ethers.utils.formatUnits(dynamicFee, USDB_DECIMALS),
          dynamicFeeBps.toString(),
          ethers.utils.formatUnits(totalFee, USDB_DECIMALS),
          totalFeeBps.toString(),
        ].join(" | ")
      );
    }
    await ethers.provider.send("evm_setAutomine", [true]);
  });
});
