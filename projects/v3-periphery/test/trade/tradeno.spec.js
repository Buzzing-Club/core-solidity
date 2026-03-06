const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployCleanFixture } = require("../fixtures/cleanDeploy.fixture");

const TOKEN_DATA =
  "0x627562626c79000000000000000000000000000000000000000000000000000c42554c000000000000000000000000000000000000000000000000000000000612";
const ZERO_BYTES32 = "0x" + "00".repeat(32);
const MIN_YES_PRICE_TICK = -25259;
const MAX_YES_PRICE_TICK = 0;
const MAX_INV_YES_PRICE_TICK = 25258;
const TICK_SPACING = 50;
const SQRT_PRICE_X96_0P1 = ethers.BigNumber.from("25054144837504793750611689472");
const SQRT_PRICE_X96_10 = ethers.BigNumber.from("250541448375047946302209916928");

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

function ceilToSpacing(v, spacing) {
  return Math.ceil(v / spacing) * spacing;
}

function floorToSpacing(v, spacing) {
  return Math.floor(v / spacing) * spacing;
}

function getInitSqrtPriceX96(usdb, yesToken) {
  const [token0] = sortPair(usdb, yesToken);
  if (normalize(token0) === normalize(usdb)) return SQRT_PRICE_X96_10;
  return SQRT_PRICE_X96_0P1;
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
    tickUpper: floorToSpacing(MAX_YES_PRICE_TICK, TICK_SPACING),
    minTick: MIN_YES_PRICE_TICK,
    maxTick: MAX_YES_PRICE_TICK,
  };
}

async function assertPoolTickInBand(poolContract, minTick, maxTick) {
  const slot0 = await poolContract.slot0();
  const currentTick = slot0.tick;
  if (currentTick < minTick || currentTick > maxTick) {
    throw new Error(`YES price band check failed: tick=${currentTick}, allowed=[${minTick}, ${maxTick}]`);
  }
}

async function setupNoTradeEnv() {
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
  const yesToken = await ethers.getContractAt("contracts/Wrapped1155Factory.sol:IERC20", yesTokenAddr);
  const noToken = await ethers.getContractAt("contracts/Wrapped1155Factory.sol:IERC20", noTokenAddr);

  await (await core.factory.createPool(yesTokenAddr, business.usdb.address, 2500)).wait();
  const pool = await core.factory.getPool(yesTokenAddr, business.usdb.address, 2500);
  const poolContract = new ethers.Contract(pool, poolArtifact.abi, ctx.deployer);
  await (await poolContract.initialize(getInitSqrtPriceX96(business.usdb.address, yesTokenAddr))).wait();

  const LP_ROLE = ethers.utils.formatBytes32String("LP");
  const BUFFER_ROLE = ethers.utils.formatBytes32String("Buffer");
  await (await business.feeAdapter.setPoolTotalFeeRatio(pool, 100000)).wait();
  await (await business.feeAdapter.setPoolRole(pool, LP_ROLE, ctx.deployer.address, 70000)).wait();
  await (await business.feeAdapter.setPoolRole(pool, BUFFER_ROLE, ctx.deployer.address, 30000)).wait();
  await (await business.feeAdapter.setPoolReferShare(pool, 0)).wait();

  const prefund = ethers.utils.parseUnits("3000000", 6);
  const splitAmount = ethers.utils.parseUnits("1000", 6);
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

  const traderFund = ethers.utils.parseUnits("1000000", 6);
  await (await business.usdc.mint(trader.address, traderFund)).wait();
  await (await business.usdc.connect(trader).approve(business.usdb.address, traderFund)).wait();
  await (await business.usdb.connect(trader).deposit(trader.address, traderFund)).wait();

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
    noToken,
  };
}

describe("Trade flow: addLiquidity + buyNo + sellNo", function () {
  const loadFixture = createFixtureLoader();

  it("adds liquidity, buys NO, then sells NO", async function () {
    const env = await loadFixture(() => setupNoTradeEnv());
    const { ctx, trader, pool, poolContract, conditionId, yesPositionId, noPositionId, yesTokenAddr, noToken } = env;

    const takerAmountFilled = "1000";
    const noAmount = ethers.BigNumber.from(takerAmountFilled);
    const exactInputSingleParams2 = {
      tokenIn: yesTokenAddr,
      tokenOut: ctx.business.usdb.address,
      fee: 2500,
      recipient: ctx.business.tradeManager.address,
      deadline: Math.floor(Date.now() / 1000) + 3600 * 24 * 365 * 3,
      amountIn: ethers.BigNumber.from(takerAmountFilled),
      amountOutMinimum: 0,
      sqrtPriceLimitX96: 0,
    };
    const splitPositionParams2 = {
      collateralToken: ctx.business.usdb.address,
      parentCollectionId: ZERO_BYTES32,
      conditionId,
      partition: [1, 2],
      amount: ethers.BigNumber.from(takerAmountFilled),
    };
    const transferParams2 = {
      from: ctx.business.tradeManager.address,
      to: ctx.business.wrapped1155Factory.address,
      id: yesPositionId,
      value: ethers.BigNumber.from(takerAmountFilled),
      data: TOKEN_DATA,
    };
    const permitParams = {
      owner: trader.address,
      spender: ethers.constants.AddressZero,
      value: 0,
      deadline: 0,
      v: 0,
      r: ethers.constants.HashZero,
      s: ethers.constants.HashZero,
    };
    await (await ctx.business.usdb.connect(trader).approve(ctx.business.tradeManager.address, ethers.constants.MaxUint256)).wait();

    await (
      await ctx.business.tradeManager.connect(trader).buyNo(
        exactInputSingleParams2,
        splitPositionParams2,
        transferParams2,
        noPositionId,
        ctx.business.wrapped1155Factory.address,
        pool,
        ethers.constants.MaxUint256,
        trader.address,
        permitParams
      )
    ).wait();

    const noBalAfterBuy = await noToken.balanceOf(trader.address);
    expect(noBalAfterBuy).to.equal(noAmount);

    await (await noToken.connect(trader).approve(ctx.business.tradeManager.address, noAmount)).wait();
    const beforeUsdb = await ctx.business.usdb.balanceOf(trader.address);

    const sellNoParams = {
      tokenIn: ctx.business.usdb.address,
      tokenOut: yesTokenAddr,
      fee: 2500,
      recipient: ctx.business.tradeManager.address,
      deadline: Math.floor(Date.now() / 1000) + 3600,
      amountOut: noAmount,
      amountInMaximum: ethers.constants.MaxUint256,
      sqrtPriceLimitX96: 0,
    };
    const splitParams3 = {
      collateralToken: ctx.business.usdb.address,
      parentCollectionId: ZERO_BYTES32,
      conditionId,
      partition: [1, 2],
      amount: 0,
    };
    const unwrapped = {
      multiToken: ctx.business.ctf.address,
      tokenId: yesPositionId,
      amount: 0,
      recipient: ctx.business.tradeManager.address,
      data: TOKEN_DATA,
    };

    await assertPoolTickInBand(poolContract, MIN_YES_PRICE_TICK, MAX_INV_YES_PRICE_TICK);
    await (
      await ctx.business.tradeManager.connect(trader).sellNo(
        sellNoParams,
        splitParams3,
        unwrapped,
        noPositionId,
        ctx.business.wrapped1155Factory.address,
        pool,
        0,
        trader.address,
        permitParams
      )
    ).wait();

    const afterUsdb = await ctx.business.usdb.balanceOf(trader.address);
    expect(afterUsdb).to.be.gt(beforeUsdb);
    const noBalAfterSell = await noToken.balanceOf(trader.address);
    expect(noBalAfterSell).to.equal(0);
  });
});
