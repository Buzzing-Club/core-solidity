const { expect } = require("chai");
const { ethers } = require("hardhat");
const Decimal = require("decimal.js");
const { deployCleanFixture } = require("../fixtures/cleanDeploy.fixture");

const TOKEN_DATA =
  "0x627562626c79000000000000000000000000000000000000000000000000000c42554c000000000000000000000000000000000000000000000000000000000612";
const ZERO_BYTES32 = "0x" + "00".repeat(32);
const FEE = 2500; // tickSpacing=50 in factory defaults
const BOUNDARY_TICK = 6950;
const UPPER_TICK = 9950;

function normalize(addr) {
  return addr.toLowerCase();
}

function sortPair(a, b) {
  return normalize(a) < normalize(b) ? [a, b] : [b, a];
}

function sqrtPriceX96FromTick(tick) {
  const ratio = new Decimal("1.0001").pow(tick).sqrt();
  const q96 = new Decimal(2).pow(96);
  const x96 = ratio.mul(q96).floor();
  return ethers.BigNumber.from(x96.toFixed(0));
}

function parseEvent(receipt, contract, eventName) {
  for (const log of receipt.logs) {
    if (normalize(log.address) !== normalize(contract.address)) continue;
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed.name === eventName) return parsed;
    } catch (_) {}
  }
  return null;
}

describe("Liquidity split by boundary tick", function () {
  it("can mint [0,6950] and [6950,9950], and only upper range is active at tick=6950", async function () {
    this.timeout(300000);

    const ctx = await deployCleanFixture();
    const { core, business } = ctx;
    const poolArtifact = require("@pancakeswap/v3-core/artifacts/contracts/BuzzingSwapPool.sol/BuzzingSwapPool.json");

    // tradeManager addLiquidity path requires yield protocol configured.
    const sUsds = await (await ethers.getContractFactory("SUsds")).deploy(business.usdc.address);
    await sUsds.deployed();
    await (await business.tradeManager.setYieldProtocol(sUsds.address)).wait();

    const questionId = "0x" + "0".repeat(63) + "9";
    await (await business.ctf.prepareCondition(ctx.deployer.address, questionId, 2)).wait();
    const conditionId = await business.ctf.getConditionId(ctx.deployer.address, questionId, 2);
    const yesCollectionId = await business.ctf.getCollectionId(ZERO_BYTES32, conditionId, 1);
    const noCollectionId = await business.ctf.getCollectionId(ZERO_BYTES32, conditionId, 2);
    const yesPositionId = await business.ctf.getPositionId(business.usdb.address, yesCollectionId);
    await business.ctf.getPositionId(business.usdb.address, noCollectionId);

    const yesTokenAddr = await business.wrapped1155Factory.getWrapped1155(
      business.ctf.address,
      yesPositionId,
      TOKEN_DATA
    );

    await (await core.factory.createPool(yesTokenAddr, business.usdb.address, FEE)).wait();
    const pool = await core.factory.getPool(yesTokenAddr, business.usdb.address, FEE);
    const poolContract = new ethers.Contract(pool, poolArtifact.abi, ctx.deployer);

    // initialize exactly on boundary tick (using +1 then floor behavior to land at 6950)
    await (await poolContract.initialize(sqrtPriceX96FromTick(BOUNDARY_TICK + 1))).wait();
    const slot0Init = await poolContract.slot0();
    const spacing = await poolContract.tickSpacing();

    expect(BOUNDARY_TICK % Number(spacing)).to.equal(0);
    expect(UPPER_TICK % Number(spacing)).to.equal(0);
    expect(Number(slot0Init.tick)).to.equal(BOUNDARY_TICK);

    // Prefund tradeManager for split + addLiquidity
    const prefund = ethers.utils.parseUnits("3000000", 6);
    await (await business.usdc.mint(ctx.deployer.address, prefund)).wait();
    await (await business.usdc.approve(business.usdb.address, prefund)).wait();
    await (await business.usdb.deposit(ctx.deployer.address, prefund)).wait();
    await (await business.usdb.transfer(business.tradeManager.address, prefund.div(2))).wait();

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

    const [token0, token1] = sortPair(yesTokenAddr, business.usdb.address);
    const amount0Desired = ethers.utils.parseUnits("1000", 6);
    const amount1Desired = ethers.utils.parseUnits("1000", 6);

    // Range A: [0, 6950]
    const mintLower = {
      token0,
      token1,
      fee: FEE,
      tickLower: 0,
      tickUpper: BOUNDARY_TICK,
      amount0Desired,
      amount1Desired,
      amount0Min: 0,
      amount1Min: 0,
      recipient: ctx.deployer.address,
      deadline: Math.floor(Date.now() / 1000) + 3600,
    };

    const rcptLower = await (
      await business.tradeManager.addLiquidity(
        mintLower,
        splitPositionParams,
        transferParams,
        business.wrapped1155Factory.address,
        pool
      )
    ).wait();
    const evLower = parseEvent(rcptLower, business.tradeManager, "IncreaseLiquidity");
    expect(evLower).to.not.equal(null);
    expect(evLower.args.liquidity).to.be.gt(0);

    const liquidityAfterLower = await poolContract.liquidity();
    // At boundary tick, [0,6950] is not active because upper bound is exclusive.
    expect(liquidityAfterLower).to.equal(0);

    // Range B: [6950, 9950]
    const mintUpper = {
      token0,
      token1,
      fee: FEE,
      tickLower: BOUNDARY_TICK,
      tickUpper: UPPER_TICK,
      amount0Desired,
      amount1Desired,
      amount0Min: 0,
      amount1Min: 0,
      recipient: ctx.deployer.address,
      deadline: Math.floor(Date.now() / 1000) + 3600,
    };

    const rcptUpper = await (
      await business.tradeManager.addLiquidity(
        mintUpper,
        splitPositionParams,
        transferParams,
        business.wrapped1155Factory.address,
        pool
      )
    ).wait();
    const evUpper = parseEvent(rcptUpper, business.tradeManager, "IncreaseLiquidity");
    expect(evUpper).to.not.equal(null);
    expect(evUpper.args.liquidity).to.be.gt(0);

    const liquidityAfterUpper = await poolContract.liquidity();
    expect(liquidityAfterUpper).to.be.gt(0);
  });
});
