const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployCleanFixture } = require("../fixtures/cleanDeploy.fixture");

const TOKEN_DATA =
  "0x627562626c79000000000000000000000000000000000000000000000000000c42554c000000000000000000000000000000000000000000000000000000000612";
const ZERO_BYTES32 = "0x" + "00".repeat(32);
const TICK_SPACING = 50;
const MIN_YES_PRICE_TICK = -25259;
const MAX_YES_PRICE_TICK = 0;
const MAX_INV_YES_PRICE_TICK = 25258;
const SQRT_PRICE_X96_0P1 = ethers.BigNumber.from("25054144837504793750611689472");
const SQRT_PRICE_X96_10 = ethers.BigNumber.from("250541448375047946302209916928");
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
    };
  }
  return {
    tickLower: ceilToSpacing(MIN_YES_PRICE_TICK, TICK_SPACING),
    tickUpper: floorToSpacing(MAX_YES_PRICE_TICK, TICK_SPACING),
  };
}

function getInitSqrtPriceX96(usdb, yesToken, mode) {
  const [token0] = sortPair(usdb, yesToken);
  if (mode === "yes") {
    if (normalize(token0) === normalize(usdb)) return SQRT_PRICE_X96_2;
    return SQRT_PRICE_X96_0P5;
  }
  if (normalize(token0) === normalize(usdb)) return SQRT_PRICE_X96_10;
  return SQRT_PRICE_X96_0P1;
}

function zeroPermit(owner) {
  return {
    owner,
    spender: ethers.constants.AddressZero,
    value: 0,
    deadline: 0,
    v: 0,
    r: ethers.constants.HashZero,
    s: ethers.constants.HashZero,
  };
}

async function setupRedeemEnv(mode) {
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
  await (await poolContract.initialize(getInitSqrtPriceX96(business.usdb.address, yesTokenAddr, mode))).wait();

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
  await (
    await business.tradeManager.addLiquidity(
      {
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
      },
      {
        collateralToken: business.usdb.address,
        parentCollectionId: ZERO_BYTES32,
        conditionId,
        partition: [1, 2],
        amount: splitAmount,
      },
      {
        from: business.tradeManager.address,
        to: business.wrapped1155Factory.address,
        id: yesPositionId,
        value: splitAmount,
        data: TOKEN_DATA,
      },
      business.wrapped1155Factory.address,
      pool
    )
  ).wait();

  const traderFund = ethers.utils.parseUnits("1000000", 6);
  await (await business.usdc.mint(trader.address, traderFund)).wait();
  await (await business.usdc.connect(trader).approve(business.usdb.address, traderFund)).wait();
  await (await business.usdb.connect(trader).deposit(trader.address, traderFund)).wait();
  await (await business.usdb.connect(trader).approve(business.tradeManager.address, ethers.constants.MaxUint256)).wait();

  return {
    ctx,
    trader,
    questionId,
    conditionId,
    yesPositionId,
    noPositionId,
    yesTokenAddr,
    noTokenAddr,
    yesToken,
    noToken,
    pool,
  };
}

async function buyYes(env, amountIn) {
  const { ctx, trader, pool, yesTokenAddr } = env;
  await (
    await ctx.business.tradeManager.connect(trader).buyYes(
      {
        tokenIn: ctx.business.usdb.address,
        tokenOut: yesTokenAddr,
        fee: 2500,
        recipient: trader.address,
        deadline: Math.floor(Date.now() / 1000) + 3600,
        amountIn,
        amountOutMinimum: 0,
        sqrtPriceLimitX96: 0,
      },
      pool,
      0,
      trader.address,
      zeroPermit(trader.address)
    )
  ).wait();
}

async function buyNo(env, amountIn) {
  const { ctx, trader, pool, conditionId, yesPositionId, noPositionId, yesTokenAddr } = env;
  await (
    await ctx.business.tradeManager.connect(trader).buyNo(
      {
        tokenIn: yesTokenAddr,
        tokenOut: ctx.business.usdb.address,
        fee: 2500,
        recipient: ctx.business.tradeManager.address,
        deadline: Math.floor(Date.now() / 1000) + 3600 * 24 * 365 * 3,
        amountIn,
        amountOutMinimum: 0,
        sqrtPriceLimitX96: 0,
      },
      {
        collateralToken: ctx.business.usdb.address,
        parentCollectionId: ZERO_BYTES32,
        conditionId,
        partition: [1, 2],
        amount: amountIn,
      },
      {
        from: ctx.business.tradeManager.address,
        to: ctx.business.wrapped1155Factory.address,
        id: yesPositionId,
        value: amountIn,
        data: TOKEN_DATA,
      },
      noPositionId,
      ctx.business.wrapped1155Factory.address,
      pool,
      ethers.constants.MaxUint256,
      trader.address,
      zeroPermit(trader.address)
    )
  ).wait();
}

async function resolveAsYes(env) {
  await (await env.ctx.business.ctf.reportPayouts(env.questionId, [1, 0])).wait();
}

async function resolveAsNo(env) {
  await (await env.ctx.business.ctf.reportPayouts(env.questionId, [0, 1])).wait();
}

async function unwrapAndRedeemYes(env) {
  const { ctx, trader, yesToken, yesPositionId, conditionId } = env;
  const yesBal = await yesToken.balanceOf(trader.address);
  if (yesBal.gt(0)) {
    await (
      await ctx.business.wrapped1155Factory
        .connect(trader)
        .unwrap(ctx.business.ctf.address, yesPositionId, yesBal, trader.address, TOKEN_DATA)
    ).wait();
  }
  await (await ctx.business.ctf.connect(trader).redeemPositions(ctx.business.usdb.address, ZERO_BYTES32, conditionId, [1])).wait();
  return yesBal;
}

async function unwrapAndRedeemNo(env) {
  const { ctx, trader, noToken, noPositionId, conditionId } = env;
  const noBal = await noToken.balanceOf(trader.address);
  if (noBal.gt(0)) {
    await (
      await ctx.business.wrapped1155Factory
        .connect(trader)
        .unwrap(ctx.business.ctf.address, noPositionId, noBal, trader.address, TOKEN_DATA)
    ).wait();
  }
  await (await ctx.business.ctf.connect(trader).redeemPositions(ctx.business.usdb.address, ZERO_BYTES32, conditionId, [2])).wait();
  return noBal;
}

describe("Redeem outcome checks", function () {
  const loadFixture = createFixtureLoader();

  it("buyNo then resolve YES => NO redeem should not increase USDB", async function () {
    const env = await loadFixture(() => setupRedeemEnv("no"));
    await buyNo(env, ethers.BigNumber.from("1000"));
    await resolveAsYes(env);
    const before = await env.ctx.business.usdb.balanceOf(env.trader.address);
    const redeemedNo = await unwrapAndRedeemNo(env);
    const after = await env.ctx.business.usdb.balanceOf(env.trader.address);
    expect(redeemedNo).to.be.gt(0);
    expect(after.sub(before)).to.equal(0);
  });

  it("buyNo then resolve NO => NO redeem should increase USDB", async function () {
    const env = await loadFixture(() => setupRedeemEnv("no"));
    await buyNo(env, ethers.BigNumber.from("1000"));
    await resolveAsNo(env);
    const before = await env.ctx.business.usdb.balanceOf(env.trader.address);
    const redeemedNo = await unwrapAndRedeemNo(env);
    const after = await env.ctx.business.usdb.balanceOf(env.trader.address);
    expect(after.sub(before)).to.equal(redeemedNo);
  });

  it("buyYes then resolve YES => YES redeem should increase USDB", async function () {
    const env = await loadFixture(() => setupRedeemEnv("yes"));
    await buyYes(env, ethers.utils.parseUnits("10", 6));
    await resolveAsYes(env);
    const before = await env.ctx.business.usdb.balanceOf(env.trader.address);
    const redeemedYes = await unwrapAndRedeemYes(env);
    const after = await env.ctx.business.usdb.balanceOf(env.trader.address);
    expect(after.sub(before)).to.equal(redeemedYes);
  });

  it("buyYes then resolve NO => YES redeem should not increase USDB", async function () {
    const env = await loadFixture(() => setupRedeemEnv("yes"));
    await buyYes(env, ethers.utils.parseUnits("10", 6));
    await resolveAsNo(env);
    const before = await env.ctx.business.usdb.balanceOf(env.trader.address);
    const redeemedYes = await unwrapAndRedeemYes(env);
    const after = await env.ctx.business.usdb.balanceOf(env.trader.address);
    expect(redeemedYes).to.be.gt(0);
    expect(after.sub(before)).to.equal(0);
  });
});
