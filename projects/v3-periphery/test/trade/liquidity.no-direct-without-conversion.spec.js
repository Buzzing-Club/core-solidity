const { expect } = require("chai");
const { ethers } = require("hardhat");
const Decimal = require("decimal.js");
const { deployCleanFixture } = require("../fixtures/cleanDeploy.fixture");

const TOKEN_DATA =
  "0x627562626c79000000000000000000000000000000000000000000000000000c42554c000000000000000000000000000000000000000000000000000000000612";
const ZERO_BYTES32 = "0x" + "00".repeat(32);
const FEE = 2500;
const MIN_TICK = -69100;
const MAX_TICK = 69100;

function normalize(addr) {
  return addr.toLowerCase();
}

function tickToSqrtPriceX96(tick) {
  const ratio = new Decimal("1.0001").pow(tick).sqrt();
  const q96 = new Decimal(2).pow(96);
  return ethers.BigNumber.from(ratio.mul(q96).floor().toFixed(0));
}

async function setupBaseEnv() {
  const ctx = await deployCleanFixture();
  const { core, business } = ctx;
  const poolArtifact = require("@pancakeswap/v3-core/artifacts/contracts/BuzzingSwapPool.sol/BuzzingSwapPool.json");

  const sUsds = await (await ethers.getContractFactory("SUsds")).deploy(business.usdc.address);
  await sUsds.deployed();
  await (await business.tradeManager.setYieldProtocol(sUsds.address)).wait();

  const prefund = ethers.utils.parseUnits("3000000", 6);
  await (await business.usdc.mint(ctx.deployer.address, prefund)).wait();
  await (await business.usdc.approve(business.usdb.address, prefund)).wait();
  await (await business.usdb.deposit(ctx.deployer.address, prefund)).wait();
  await (await business.usdb.transfer(business.tradeManager.address, prefund.div(2))).wait();

  return { ctx, core, business, poolArtifact };
}

async function findMarketByOrder(env, wantUsdbAsToken0) {
  const { ctx, core, business, poolArtifact } = env;

  for (let i = 301; i <= 360; i += 1) {
    const questionId = "0x" + i.toString(16).padStart(64, "0");
    await (await business.ctf.prepareCondition(ctx.deployer.address, questionId, 2)).wait();
    const conditionId = await business.ctf.getConditionId(ctx.deployer.address, questionId, 2);
    const yesCollectionId = await business.ctf.getCollectionId(ZERO_BYTES32, conditionId, 1);
    const noCollectionId = await business.ctf.getCollectionId(ZERO_BYTES32, conditionId, 2);
    const yesPositionId = await business.ctf.getPositionId(business.usdb.address, yesCollectionId);
    const noPositionId = await business.ctf.getPositionId(business.usdb.address, noCollectionId);
    const yesTokenAddr = await business.wrapped1155Factory.getWrapped1155(
      business.ctf.address,
      yesPositionId,
      TOKEN_DATA
    );
    await business.wrapped1155Factory.getWrapped1155(
      business.ctf.address,
      noPositionId,
      TOKEN_DATA
    );

    const token0IsUsdb = normalize(business.usdb.address) < normalize(yesTokenAddr);
    if (token0IsUsdb !== wantUsdbAsToken0) continue;

    await (await core.factory.createPool(yesTokenAddr, business.usdb.address, FEE)).wait();
    const pool = await core.factory.getPool(yesTokenAddr, business.usdb.address, FEE);
    const poolContract = new ethers.Contract(pool, poolArtifact.abi, ctx.deployer);

    return {
      pool,
      poolContract,
      conditionId,
      yesPositionId,
      yesTokenAddr,
      token0: token0IsUsdb ? business.usdb.address : yesTokenAddr,
      token1: token0IsUsdb ? yesTokenAddr : business.usdb.address,
    };
  }

  throw new Error(`Could not find market for wantUsdbAsToken0=${wantUsdbAsToken0}`);
}

async function buildNoOnlyRawCall(env, market, recipient, amountUsdb, tickLower, tickUpper) {
  const { business } = env;
  const splitAmount = ethers.utils.parseUnits("1000", 6);

  const splitPositionParams = {
    collateralToken: business.usdb.address,
    parentCollectionId: ZERO_BYTES32,
    conditionId: market.conditionId,
    partition: [1, 2],
    amount: splitAmount,
  };

  const transferParams = {
    from: business.tradeManager.address,
    to: business.wrapped1155Factory.address,
    id: market.yesPositionId,
    value: splitAmount,
    data: TOKEN_DATA,
  };

  const amount0Desired =
    normalize(market.token0) === normalize(business.usdb.address) ? amountUsdb : ethers.constants.Zero;
  const amount1Desired =
    normalize(market.token1) === normalize(business.usdb.address) ? amountUsdb : ethers.constants.Zero;

  const mintParams = {
    token0: market.token0,
    token1: market.token1,
    fee: FEE,
    tickLower,
    tickUpper,
    amount0Desired,
    amount1Desired,
    amount0Min: 0,
    amount1Min: 0,
    recipient,
    deadline: Math.floor(Date.now() / 1000) + 3600,
  };

  const usdbForLiquidity = normalize(market.token0) === normalize(business.usdb.address)
    ? amount0Desired
    : amount1Desired;

  console.log("[no-raw] token0=", market.token0, "token1=", market.token1);
  console.log(
    "[no-raw] tickLower=",
    tickLower,
    "tickUpper=",
    tickUpper,
    "amount0Desired=",
    amount0Desired.toString(),
    "amount1Desired=",
    amount1Desired.toString()
  );

  return business.tradeManager.addLiquidity(
    mintParams,
    splitPositionParams,
    transferParams,
    business.wrapped1155Factory.address,
    market.pool,
    false,
    splitAmount,
    splitAmount,
    usdbForLiquidity
  );
}

describe("NO-only liquidity without conversion", function () {
  it("reverts for raw NO-side params when USDB=token0 and init tick=69100", async function () {
    this.timeout(300000);

    const env = await setupBaseEnv();
    const market = await findMarketByOrder(env, true);
    const [, recipient] = await ethers.getSigners();
    const amountUsdb = ethers.utils.parseUnits("1000", 6);

    await (await market.poolContract.initialize(tickToSqrtPriceX96(MAX_TICK))).wait();

    await expect(
      buildNoOnlyRawCall(env, market, recipient.address, amountUsdb, 0, MAX_TICK)
    ).to.be.reverted;
  });

  it("reverts for raw NO-side params when USDB=token1 and init tick=-69100", async function () {
    this.timeout(300000);

    const env = await setupBaseEnv();
    const market = await findMarketByOrder(env, false);
    const [, recipient] = await ethers.getSigners();
    const amountUsdb = ethers.utils.parseUnits("1000", 6);

    await (await market.poolContract.initialize(tickToSqrtPriceX96(MIN_TICK))).wait();

    await expect(
      buildNoOnlyRawCall(env, market, recipient.address, amountUsdb, MIN_TICK, 0)
    ).to.be.reverted;
  });
});
