const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployCleanFixture } = require("../fixtures/cleanDeploy.fixture");

const TOKEN_DATA =
  "0x627562626c79000000000000000000000000000000000000000000000000000c42554c000000000000000000000000000000000000000000000000000000000612";
const ZERO_BYTES32 = "0x" + "00".repeat(32);
const Q96 = ethers.BigNumber.from(2).pow(96);
const MIN_YES_PRICE_TICK = -25259; // price 0.08
const MAX_YES_PRICE_TICK = 0; // price 1.0
const MAX_INV_YES_PRICE_TICK = 25258; // price 12.5 = 1 / 0.08
const TICK_SPACING = 50; // fee=2500
const SQRT_PRICE_X96_0P5 = ethers.BigNumber.from("56022770974786139918731938227");
const SQRT_PRICE_X96_2 = ethers.BigNumber.from("112045541949572279837463876454");

function createFixtureLoader() {
  let snapshotId;
  let value;
  return async (fixture) => {
    if (snapshotId === undefined) {
      value = await fixture();
      snapshotId = await ethers.provider.send("evm_snapshot", []);
      return value;
    }
    await ethers.provider.send("evm_revert", [snapshotId]);
    snapshotId = await ethers.provider.send("evm_snapshot", []);
    return value;
  };
}

function normalize(addr) {
  return addr.toLowerCase();
}

function sortPair(a, b) {
  return normalize(a) < normalize(b) ? [a, b] : [b, a];
}

function getInitSqrtPriceX96(usdb, yesToken) {
  const [token0] = sortPair(usdb, yesToken);
  if (normalize(token0) === normalize(usdb)) {
    return SQRT_PRICE_X96_2; // pool price YES/USDB = 2 => YES price in USDB = 0.5
  }
  return SQRT_PRICE_X96_0P5; // pool price USDB/YES = 0.5
}

function ceilToSpacing(v, spacing) {
  return Math.ceil(v / spacing) * spacing;
}

function floorToSpacing(v, spacing) {
  return Math.floor(v / spacing) * spacing;
}

function getAllowedTicksByOrder(usdb, yesToken) {
  const [token0] = sortPair(usdb, yesToken);
  if (normalize(token0) === normalize(usdb)) {
    return {
      tickLower: ceilToSpacing(0, TICK_SPACING),
      tickUpper: floorToSpacing(MAX_INV_YES_PRICE_TICK, TICK_SPACING),
      minTick: 0,
      maxTick: MAX_INV_YES_PRICE_TICK,
    };
  }
  return {
    tickLower: ceilToSpacing(MIN_YES_PRICE_TICK, TICK_SPACING),
    tickUpper: floorToSpacing(0, TICK_SPACING),
    minTick: MIN_YES_PRICE_TICK,
    maxTick: 0,
  };
}

async function assertPoolTickInBand(poolContract, minTick, maxTick) {
  const slot0 = await poolContract.slot0();
  const currentTick = slot0.tick;
  if (currentTick < minTick || currentTick > maxTick) {
    throw new Error(`YES price band check failed: tick=${currentTick}, allowed=[${minTick}, ${maxTick}]`);
  }
}

async function setupPoolAndLiquidity() {
  const ctx = await deployCleanFixture();
  const [, trader] = await ethers.getSigners();
  const { core, business } = ctx;

  const poolArtifact = require("@pancakeswap/v3-core/artifacts/contracts/BuzzingSwapPool.sol/BuzzingSwapPool.json");

  const sUsds = await (await ethers.getContractFactory("SUsds")).deploy(business.usdc.address);
  await sUsds.deployed();
  await (await business.tradeManager.setYieldProtocol(sUsds.address)).wait();

  const questionId = "0x" + "0".repeat(63) + "2";
  await (await business.ctf.prepareCondition(ctx.deployer.address, questionId, 2)).wait();
  const conditionId = await business.ctf.getConditionId(ctx.deployer.address, questionId, 2);
  const yesCollectionId = await business.ctf.getCollectionId(ZERO_BYTES32, conditionId, 1);
  const noCollectionId = await business.ctf.getCollectionId(ZERO_BYTES32, conditionId, 2);
  const yesPositionId = await business.ctf.getPositionId(business.usdb.address, yesCollectionId);
  const noPositionId = await business.ctf.getPositionId(business.usdb.address, noCollectionId);

  const yesTokenAddr = await business.wrapped1155Factory.getWrapped1155(business.ctf.address, yesPositionId, TOKEN_DATA);
  const noTokenAddr = await business.wrapped1155Factory.getWrapped1155(business.ctf.address, noPositionId, TOKEN_DATA);

  await (await core.factory.createPool(yesTokenAddr, business.usdb.address, 2500)).wait();
  const pool = await core.factory.getPool(yesTokenAddr, business.usdb.address, 2500);
  const poolContract = new ethers.Contract(pool, poolArtifact.abi, ctx.deployer);
  await (await poolContract.initialize(getInitSqrtPriceX96(business.usdb.address, yesTokenAddr))).wait();

  const LP_ROLE = ethers.utils.formatBytes32String("LP");
  const BUFFER_ROLE = ethers.utils.formatBytes32String("Buffer");
  const TOTAL_FEE_RATIO = 100000;
  await (await business.feeAdapter.setPoolTotalFeeRatio(pool, TOTAL_FEE_RATIO)).wait();
  await (await business.feeAdapter.setPoolRole(pool, LP_ROLE, ctx.deployer.address, 70000)).wait();
  await (await business.feeAdapter.setPoolRole(pool, BUFFER_ROLE, ctx.deployer.address, 30000)).wait();
  await (await business.feeAdapter.setPoolReferShare(pool, 0)).wait();

  const splitAmount = ethers.utils.parseUnits("1000", 6);
  const prefund = ethers.utils.parseUnits("3000000", 6);

  await (await business.usdc.mint(ctx.deployer.address, prefund)).wait();
  await (await business.usdc.approve(business.usdb.address, prefund)).wait();
  await (await business.usdb.deposit(ctx.deployer.address, prefund)).wait();
  await (await business.usdb.transfer(business.tradeManager.address, prefund.div(2))).wait();
  await (await business.usdb.approve(business.tradeManager.address, prefund.div(3))).wait();
  await (await business.tradeManager.LPDeposit(prefund.div(6), ctx.deployer.address, true)).wait();
  await (await business.tradeManager.LPDeposit(prefund.div(6), ctx.deployer.address, false)).wait();

  const [token0, token1] = sortPair(yesTokenAddr, business.usdb.address);
  const band = getAllowedTicksByOrder(business.usdb.address, yesTokenAddr);
  const amount0Desired = normalize(token0) === normalize(yesTokenAddr) ? splitAmount : splitAmount.div(2);
  const amount1Desired = normalize(token1) === normalize(yesTokenAddr) ? splitAmount : splitAmount.div(2);

  const mintParams = {
    token0,
    token1,
    fee: 2500,
    tickLower: band.tickLower,
    tickUpper: band.tickUpper,
    amount0Desired,
    amount1Desired,
    amount0Min: 0,
    amount1Min: 0,
    recipient: ctx.deployer.address,
    deadline: Math.floor(Date.now() / 1000) + 3600,
  };
  if (!(mintParams.tickLower >= band.minTick && mintParams.tickUpper <= band.maxTick)) {
    throw new Error(
      `addLiquidity tick out of band: [${mintParams.tickLower}, ${mintParams.tickUpper}] vs [${band.minTick}, ${band.maxTick}]`
    );
  }

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

  await (
    await business.tradeManager.addLiquidity(
      mintParams,
      splitPositionParams,
      transferParams,
      business.wrapped1155Factory.address,
      pool
    )
  ).wait();
  await assertPoolTickInBand(poolContract, band.minTick, band.maxTick);

  const tradeUsdcAmount = ethers.utils.parseUnits("200", 6);
  await (await business.usdc.mint(trader.address, tradeUsdcAmount)).wait();
  await (await business.usdc.connect(trader).approve(business.usdb.address, tradeUsdcAmount)).wait();
  await (await business.usdb.connect(trader).deposit(trader.address, tradeUsdcAmount)).wait();

  const yesToken = await ethers.getContractAt("contracts/Wrapped1155Factory.sol:IERC20", yesTokenAddr);

  return {
    ctx,
    trader,
    pool,
    poolContract,
    conditionId,
    yesPositionId,
    noPositionId,
    yesTokenAddr,
    noTokenAddr,
    yesToken,
  };
}

describe("Trade flow: addLiquidity + buyYes", function () {
  const loadFixture = createFixtureLoader();

  it("adds liquidity, buys YES, then sells YES", async function () {
    const env = await loadFixture(() => setupPoolAndLiquidity());
    const { ctx, trader, pool, poolContract, yesToken, yesTokenAddr } = env;

    const poolLiquidity = await poolContract.liquidity();
    expect(poolLiquidity).to.be.gt(0);

    const buyAmountIn = ethers.utils.parseUnits("10", 6);
    await (await ctx.business.usdb.connect(trader).approve(ctx.business.tradeManager.address, buyAmountIn)).wait();

    const beforeYes = await yesToken.balanceOf(trader.address);
    const permit = {
      owner: trader.address,
      spender: ethers.constants.AddressZero,
      value: 0,
      deadline: 0,
      v: 0,
      r: ethers.constants.HashZero,
      s: ethers.constants.HashZero,
    };
    const params = {
      tokenIn: ctx.business.usdb.address,
      tokenOut: yesTokenAddr,
      fee: 2500,
      recipient: trader.address,
      deadline: Math.floor(Date.now() / 1000) + 3600,
      amountIn: buyAmountIn,
      amountOutMinimum: 0,
      sqrtPriceLimitX96: 0,
    };
    const band = getAllowedTicksByOrder(ctx.business.usdb.address, yesTokenAddr);
    await assertPoolTickInBand(poolContract, band.minTick, band.maxTick);

    await (await ctx.business.tradeManager.connect(trader).buyYes(params, pool, 0, trader.address, permit)).wait();

    const afterYes = await yesToken.balanceOf(trader.address);
    expect(afterYes).to.be.gt(beforeYes);

    const userPos = await ctx.business.tradeManager.userYesPositions(trader.address, pool);
    expect(userPos.yesTokenAmount).to.be.gt(0);
    expect(userPos.usdSpent).to.equal(buyAmountIn);

    await (await yesToken.connect(trader).approve(ctx.business.tradeManager.address, afterYes)).wait();
    const beforeUsdb = await ctx.business.usdb.balanceOf(trader.address);
    const sellParams = {
      tokenIn: yesTokenAddr,
      tokenOut: ctx.business.usdb.address,
      fee: 2500,
      recipient: ctx.business.tradeManager.address,
      deadline: Math.floor(Date.now() / 1000) + 3600,
      amountIn: afterYes.div(2),
      amountOutMinimum: 0,
      sqrtPriceLimitX96: 0,
    };

    await (await ctx.business.tradeManager.connect(trader).sellYes(sellParams, pool, 0, trader.address, permit)).wait();

    const afterUsdb = await ctx.business.usdb.balanceOf(trader.address);
    expect(afterUsdb).to.be.gt(beforeUsdb);
    const userPosAfterSell = await ctx.business.tradeManager.userYesPositions(trader.address, pool);
    expect(userPosAfterSell.yesTokenAmount).to.be.lt(userPos.yesTokenAmount);
  });
});
