const { ethers } = require("hardhat");
const { writeScenarioReport } = require("./dynamic-fee.report.helper");

const USDB_DECIMALS = 6;
const ONE_E18 = ethers.constants.WeiPerEther;

describe("Dynamic fee simulation: low frequency 100 trades", function () {
  it("records 1000U low-frequency trades with on-chain fee data", async function () {
    this.timeout(240000);

    const [deployer] = await ethers.getSigners();
    const feeManager = await (await ethers.getContractFactory("DynamicFeeManagerTest", deployer)).deploy();
    await feeManager.deployed();

    await (
      await feeManager.setParams(
        2,
        600,
        "850000000000000000",
        "1000000000",
        "1000000000000000000000",
        "12000000000000"
      )
    ).wait();

    const pool = ethers.Wallet.createRandom().address;
    const initTs = (await ethers.provider.getBlock("latest")).timestamp;
    await (await feeManager.setPoolState(pool, 0, 0, 0, initTs)).wait();

    const filterPeriod = (await feeManager.filterPeriod()).toNumber();
    const decayPeriod = (await feeManager.decayPeriod()).toNumber();
    const reductionFactor = (await feeManager.reductionFactor()).toString();
    const maxAccumulator = (await feeManager.maxAccumulator()).toString();
    const variableFeeControl = (await feeManager.variableFeeControl()).toString();
    const baseFeeUnit = await feeManager.baseFeeUnit();

    const staticFeeBps = 100;
    const tradeSizeU = "100";
    const tradeSizeRaw = ethers.utils.parseUnits(tradeSizeU, USDB_DECIMALS);
    const staticFeeRaw = tradeSizeRaw.mul(staticFeeBps).div(10_000);
    const dtSeconds = 700;

    const rows = [];
    for (let i = 0; i < 100; i++) {
      const currentTick = (i + 1) * 10;
      const ticksCrossed = 1 + (i % 3);

      await ethers.provider.send("evm_increaseTime", [dtSeconds]);
      await ethers.provider.send("evm_mine", []);

      const tx = await feeManager.updateVolatility(pool, currentTick, ticksCrossed);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);
      const pv = await feeManager.poolVolatility(pool);

      const dynamicFeeRaw = await feeManager.computeFee(pool, ticksCrossed, tradeSizeRaw);
      const baseFeeRaw = ethers.BigNumber.from(ticksCrossed).mul(baseFeeUnit).mul(tradeSizeRaw).div(ONE_E18);
      const variableFeeRaw = dynamicFeeRaw.sub(baseFeeRaw);
      const totalFeeRaw = staticFeeRaw.add(dynamicFeeRaw);

      rows.push({
        idx: (i + 1).toString(),
        txHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber.toString(),
        timestamp: block.timestamp.toString(),
        dtSeconds: dtSeconds.toString(),
        tradeSizeU,
        currentTick: currentTick.toString(),
        ticksCrossed: ticksCrossed.toString(),
        referenceTick: pv.referenceTick.toString(),
        referenceVolatility: pv.referenceVolatility.toString(),
        accumulator: pv.accumulator.toString(),
        baseFeeUSDB: ethers.utils.formatUnits(baseFeeRaw, USDB_DECIMALS),
        variableFeeUSDB: ethers.utils.formatUnits(variableFeeRaw, USDB_DECIMALS),
        dynamicFeeUSDB: ethers.utils.formatUnits(dynamicFeeRaw, USDB_DECIMALS),
        dynamicFeeBps: dynamicFeeRaw.mul(10_000).div(tradeSizeRaw).toString(),
        totalFeeUSDB: ethers.utils.formatUnits(totalFeeRaw, USDB_DECIMALS),
        totalFeeBps: totalFeeRaw.mul(10_000).div(tradeSizeRaw).toString(),
      });
    }

    const out = writeScenarioReport({
      filePrefix: "dynamic-fee-low-frequency-100trades-100U",
      title: "Dynamic Fee Low Frequency (100 trades, 100U each)",
      params: {
        filterPeriod,
        decayPeriod,
        reductionFactor,
        maxAccumulator,
        variableFeeControl,
        baseFeeUnit: baseFeeUnit.toString(),
        staticFeeBps,
        tradeSizeU,
        tradeCount: 100,
        dtSeconds,
      },
      rows,
    });

    console.log("[dynamic-fee-low] report saved:", out);
  });
});
