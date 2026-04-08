const { expect } = require("chai");
const { ethers } = require("hardhat");
const Decimal = require("decimal.js");
const { deployCleanFixture } = require("../fixtures/cleanDeploy.fixture");

const TOKEN_DATA =
  "0x627562626c79000000000000000000000000000000000000000000000000000c42554c000000000000000000000000000000000000000000000000000000000612";
const ZERO_BYTES32 = "0x" + "00".repeat(32);
const FEE = 2500;
const TICK_SPACING = 50;
const MIN_TICK = -69100;
const MAX_TICK = 69100;

function normalize(addr) {
  return addr.toLowerCase();
}

function floorToSpacing(v, spacing) {
  return Math.floor(v / spacing) * spacing;
}

function tickToSqrtPriceX96(tick) {
  const ratio = new Decimal("1.0001").pow(tick).sqrt();
  const q96 = new Decimal(2).pow(96);
  return ethers.BigNumber.from(ratio.mul(q96).floor().toFixed(0));
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

  for (let i = 401; i <= 460; i += 1) {
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
      yesIsToken0: !token0IsUsdb,
    };
  }

  throw new Error(`Could not find market for wantUsdbAsToken0=${wantUsdbAsToken0}`);
}

function buildYesOnlyRawSpec(market) {
  const yesAmount = ethers.utils.parseUnits("1000", 6);
  const zero = ethers.constants.Zero;

  if (market.yesIsToken0) {
    return {
      initTick: 0,
      tickLower: TICK_SPACING,
      tickUpper: MAX_TICK,
      amount0Desired: yesAmount,
      amount1Desired: zero,
    };
  }

  return {
    initTick: 0,
    tickLower: MIN_TICK,
    tickUpper: 0,
    amount0Desired: zero,
    amount1Desired: yesAmount,
  };
}

async function executeYesOnlyRawCall(env, market, recipient) {
  const { business } = env;
  const splitAmount = ethers.utils.parseUnits("1000", 6);
  const initialAmount = splitAmount;
  const initialCost = splitAmount;
  const spec = buildYesOnlyRawSpec(market);

  await (await market.poolContract.initialize(tickToSqrtPriceX96(spec.initTick))).wait();
  const slot0AfterInit = await market.poolContract.slot0();
  const usableTick = floorToSpacing(Number(slot0AfterInit.tick), TICK_SPACING);

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

  const mintParams = {
    token0: market.token0,
    token1: market.token1,
    fee: FEE,
    tickLower: spec.tickLower,
    tickUpper: spec.tickUpper,
    amount0Desired: spec.amount0Desired,
    amount1Desired: spec.amount1Desired,
    amount0Min: 0,
    amount1Min: 0,
    recipient,
    deadline: Math.floor(Date.now() / 1000) + 3600,
  };

  const usdbForLiquidity = normalize(market.token0) === normalize(business.usdb.address)
    ? mintParams.amount0Desired
    : mintParams.amount1Desired;

  console.log("[yes-raw] token0=", market.token0, "token1=", market.token1, "yesIsToken0=", market.yesIsToken0);
  console.log(
    "[yes-raw] currentTick=",
    Number(slot0AfterInit.tick),
    "usableTick=",
    usableTick,
    "tickLower=",
    mintParams.tickLower,
    "tickUpper=",
    mintParams.tickUpper,
    "amount0Desired=",
    mintParams.amount0Desired.toString(),
    "amount1Desired=",
    mintParams.amount1Desired.toString()
  );

  const rcpt = await (
    await business.tradeManager.addLiquidity(
      mintParams,
      splitPositionParams,
      transferParams,
      business.wrapped1155Factory.address,
      market.pool,
      true,
      initialAmount,
      initialCost,
      usdbForLiquidity
    )
  ).wait();

  const ev = parseEvent(rcpt, business.tradeManager, "IncreaseLiquidity");
  expect(ev).to.not.equal(null);
  expect(ev.args.liquidity).to.be.gt(0);

  const [slot0, poolLiquidity] = await Promise.all([market.poolContract.slot0(), market.poolContract.liquidity()]);
  console.log(
    "[yes-raw] result amount0=",
    ev.args.amount0.toString(),
    "amount1=",
    ev.args.amount1.toString(),
    "poolLiquidity=",
    poolLiquidity.toString(),
    "tick=",
    Number(slot0.tick)
  );

  return {
    spec,
    currentTick: Number(slot0.tick),
    usableTick,
    poolLiquidity,
    ev: ev.args,
  };
}

describe("YES-only liquidity without conversion", function () {
  it("adds pure YES-side raw liquidity when USDB=token0 after shifting one tickSpacing", async function () {
    this.timeout(300000);

    const env = await setupBaseEnv();
    const market = await findMarketByOrder(env, true);
    const [, recipient] = await ethers.getSigners();

    const { currentTick, spec, poolLiquidity } = await executeYesOnlyRawCall(env, market, recipient.address);
    const yesPos = await env.business.tradeManager.userYesPositions(recipient.address, market.pool);
    const noPos = await env.business.tradeManager.userNoPositions(recipient.address, market.pool);
    expect(currentTick).to.equal(0);
    expect(spec.amount0Desired).to.equal(0);
    expect(spec.amount1Desired).to.equal(ethers.utils.parseUnits("1000", 6));
    expect(spec.tickLower).to.equal(-69100);
    expect(spec.tickUpper).to.equal(0);
    expect(poolLiquidity).to.equal(0);
    expect(yesPos.yesTokenAmount).to.equal(ethers.utils.parseUnits("1000", 6));
    expect(noPos.noTokenAmount).to.equal(0);
  });

  it("adds pure YES-side raw liquidity when USDB=token1 after shifting one tickSpacing", async function () {
    this.timeout(300000);

    const env = await setupBaseEnv();
    const market = await findMarketByOrder(env, false);
    const [, recipient] = await ethers.getSigners();

    const { currentTick, spec, poolLiquidity } = await executeYesOnlyRawCall(env, market, recipient.address);
    const yesPos = await env.business.tradeManager.userYesPositions(recipient.address, market.pool);
    const noPos = await env.business.tradeManager.userNoPositions(recipient.address, market.pool);
    expect(currentTick).to.equal(0);
    expect(spec.amount0Desired).to.equal(ethers.utils.parseUnits("1000", 6));
    expect(spec.amount1Desired).to.equal(0);
    expect(spec.tickLower).to.equal(50);
    expect(spec.tickUpper).to.equal(69100);
    expect(poolLiquidity).to.equal(0);
    expect(yesPos.yesTokenAmount).to.equal(ethers.utils.parseUnits("1000", 6));
    expect(noPos.noTokenAmount).to.equal(0);
  });
});
