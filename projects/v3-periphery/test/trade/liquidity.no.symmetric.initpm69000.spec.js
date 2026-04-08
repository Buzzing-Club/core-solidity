const { expect } = require("chai");
const { ethers } = require("hardhat");
const Decimal = require("decimal.js");
const { deployCleanFixture } = require("../fixtures/cleanDeploy.fixture");

const TOKEN_DATA =
  "0x627562626c79000000000000000000000000000000000000000000000000000c42554c000000000000000000000000000000000000000000000000000000000612";
const ZERO_BYTES32 = "0x" + "00".repeat(32);
const FEE = 2500;

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

  for (let i = 1001; i <= 1080; i += 1) {
    const questionId = "0x" + i.toString(16).padStart(64, "0");
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

async function tryNoRawAdd(env, market, cfg) {
  const rawUsdb = ethers.utils.parseUnits("1000", 6);
  const splitAmount = ethers.utils.parseUnits("1000", 6);
  await (await market.poolContract.initialize(tickToSqrtPriceX96(cfg.initTick))).wait();
  const slot0 = await market.poolContract.slot0();

  const splitPositionParams = {
    collateralToken: env.business.usdb.address,
    parentCollectionId: ZERO_BYTES32,
    conditionId: market.conditionId,
    partition: [1, 2],
    amount: splitAmount,
  };

  const transferParams = {
    from: env.business.tradeManager.address,
    to: env.business.wrapped1155Factory.address,
    id: market.yesPositionId,
    value: splitAmount,
    data: TOKEN_DATA,
  };

  const amount0Desired =
    normalize(market.token0) === normalize(env.business.usdb.address) ? rawUsdb : ethers.constants.Zero;
  const amount1Desired =
    normalize(market.token1) === normalize(env.business.usdb.address) ? rawUsdb : ethers.constants.Zero;

  const mintParams = {
    token0: market.token0,
    token1: market.token1,
    fee: FEE,
    tickLower: cfg.tickLower,
    tickUpper: cfg.tickUpper,
    amount0Desired,
    amount1Desired,
    amount0Min: 0,
    amount1Min: 0,
    recipient: env.ctx.deployer.address,
    deadline: Math.floor(Date.now() / 1000) + 3600,
  };

  const usdbForLiquidity = normalize(market.token0) === normalize(env.business.usdb.address)
    ? amount0Desired
    : amount1Desired;

  console.log(
    "[no-symmetric] token0=",
    mintParams.token0,
    "token1=",
    mintParams.token1,
    "initTick=",
    cfg.initTick,
    "currentTick=",
    Number(slot0.tick),
    "range=[",
    cfg.tickLower,
    ",",
    cfg.tickUpper,
    "]"
  );
  console.log(
    "[no-symmetric] amount0Desired=",
    mintParams.amount0Desired.toString(),
    "amount1Desired=",
    mintParams.amount1Desired.toString()
  );

  let reverted = false;
  try {
    const tx = await env.business.tradeManager.addLiquidity(
      mintParams,
      splitPositionParams,
      transferParams,
      env.business.wrapped1155Factory.address,
      market.pool,
      false,
      splitAmount,
      splitAmount,
      usdbForLiquidity
    );
    await tx.wait();
  } catch (err) {
    reverted = true;
    const msg = err && err.message ? err.message : String(err);
    console.log("[no-symmetric] reverted:", msg.split("\n")[0]);
  }

  return reverted;
}

describe("NO one-sided symmetric setup near +/-69100", function () {
  it("USDB=token0: init 69000, try [69050, 69100]", async function () {
    this.timeout(300000);
    const env = await setupBaseEnv();
    const market = await findMarketByOrder(env, true);
    const reverted = await tryNoRawAdd(env, market, {
      initTick: 69000,
      tickLower: 69050,
      tickUpper: 69100,
    });
    console.log("[no-symmetric] usdb=token0 outcome reverted=", reverted);
    expect(typeof reverted).to.equal("boolean");
  });

  it("USDB=token1: init -69000, try [-69100, -69050]", async function () {
    this.timeout(300000);
    const env = await setupBaseEnv();
    const market = await findMarketByOrder(env, false);
    const reverted = await tryNoRawAdd(env, market, {
      initTick: -69000,
      tickLower: -69100,
      tickUpper: -69050,
    });
    console.log("[no-symmetric] usdb=token1 outcome reverted=", reverted);
    expect(typeof reverted).to.equal("boolean");
  });
});

