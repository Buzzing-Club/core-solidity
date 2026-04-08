const { expect } = require("chai");
const { ethers } = require("hardhat");
const Decimal = require("decimal.js");
const { deployCleanFixture } = require("../fixtures/cleanDeploy.fixture");

const TOKEN_DATA =
  "0x627562626c79000000000000000000000000000000000000000000000000000c42554c000000000000000000000000000000000000000000000000000000000612";
const ZERO_BYTES32 = "0x" + "00".repeat(32);
const FEE = 2500;
const TICK_SPACING = 50;
const YES_PRICE_FLOOR = 0.001;
const YES_PRICE_CEIL = 1.0;
const MIN_TICK = -69100;
const MAX_TICK = 69100;

function normalize(addr) {
  return addr.toLowerCase();
}

function sortPair(a, b) {
  return normalize(a) < normalize(b) ? [a, b] : [b, a];
}

function floorToSpacing(v, spacing) {
  return Math.floor(v / spacing) * spacing;
}

function tickToSqrtPriceX96(tick) {
  const ratio = new Decimal("1.0001").pow(tick).sqrt();
  const q96 = new Decimal(2).pow(96);
  return ethers.BigNumber.from(ratio.mul(q96).floor().toFixed(0));
}

function priceToTick(price) {
  return Math.floor(Math.log(price) / Math.log(1.0001));
}

function yesPriceToTick(yesPrice, usdb, yesToken) {
  const [token0] = sortPair(usdb, yesToken);
  const ratio = normalize(token0) === normalize(usdb) ? 1 / yesPrice : yesPrice;
  return priceToTick(ratio);
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

  for (let i = 201; i <= 260; i += 1) {
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
      yesIsToken0: !token0IsUsdb,
    };
  }

  throw new Error(`Could not find market for wantUsdbAsToken0=${wantUsdbAsToken0}`);
}

function buildSingleSidedSpec(market, business, side, currentTick) {
  const yesDesired = ethers.utils.parseUnits("1000", 6);
  const usdbDesired = ethers.utils.parseUnits("1000", 6);
  const dust = ethers.BigNumber.from(1);
  const usableTick = floorToSpacing(currentTick, TICK_SPACING);

  let tickLower;
  let tickUpper;
  let amount0Desired;
  let amount1Desired;

  if (side === "YES") {
    if (market.yesIsToken0) {
      tickLower = usableTick;
      tickUpper = MAX_TICK;
    } else {
      tickLower = MIN_TICK;
      tickUpper = usableTick + TICK_SPACING;
    }
  } else {
    if (market.yesIsToken0) {
      tickLower = MIN_TICK;
      tickUpper = TICK_SPACING;
    } else {
      tickLower = 0;
      tickUpper = MAX_TICK + TICK_SPACING;
    }
  }

  if (normalize(market.token0) === normalize(market.yesTokenAddr)) {
    amount0Desired = side === "YES" ? yesDesired : dust;
    amount1Desired = side === "NO" ? usdbDesired : dust;
  } else {
    amount0Desired = side === "NO" ? usdbDesired : dust;
    amount1Desired = side === "YES" ? yesDesired : dust;
  }

  const usdbForLiquidity = normalize(market.token0) === normalize(business.usdb.address)
    ? amount0Desired
    : amount1Desired;

  return { tickLower, tickUpper, amount0Desired, amount1Desired, usdbForLiquidity, usableTick };
}

async function addLiquidity(env, market, side, currentTick, isYes, initialAmount, initialCost, recipient) {
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

  const spec = buildSingleSidedSpec(market, business, side, currentTick);
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

  console.log(
    `[${side}-init] token0=${market.token0} token1=${market.token1} yesIsToken0=${market.yesIsToken0}`
  );
  console.log(
    `[${side}-init] currentTick=${currentTick} usableTick=${spec.usableTick} range=${spec.tickLower}~${spec.tickUpper} amount0Desired=${spec.amount0Desired.toString()} amount1Desired=${spec.amount1Desired.toString()}`
  );

  const rcpt = await (
    await business.tradeManager.addLiquidity(
      mintParams,
      splitPositionParams,
      transferParams,
      business.wrapped1155Factory.address,
      market.pool,
      isYes,
      initialAmount,
      initialCost,
      spec.usdbForLiquidity
    )
  ).wait();

  const ev = parseEvent(rcpt, business.tradeManager, "IncreaseLiquidity");
  expect(ev).to.not.equal(null);
  expect(ev.args.liquidity).to.be.gt(0);

  const [slot0, poolLiquidity] = await Promise.all([market.poolContract.slot0(), market.poolContract.liquidity()]);
  console.log(
    `[${side}-init] result amount0=${ev.args.amount0.toString()} amount1=${ev.args.amount1.toString()} poolLiquidity=${poolLiquidity.toString()} tick=${Number(slot0.tick)}`
  );

  return { ev: ev.args, currentTickAfter: Number(slot0.tick), poolLiquidity };
}

describe("Single-sided init extremes with YES/USDB pool conversion", function () {
  it("YES-only init at yesPrice=1: token1=USDB case uses YES-side range and records UserYesPosition", async function () {
    this.timeout(300000);

    const env = await setupBaseEnv();
    const market = await findMarketByOrder(env, false); // token0=YES token1=USDB
    const [, recipient] = await ethers.getSigners();
    const initTick = yesPriceToTick(YES_PRICE_CEIL, env.business.usdb.address, market.yesTokenAddr);
    expect(initTick).to.equal(0);
    await (await market.poolContract.initialize(tickToSqrtPriceX96(initTick))).wait();
    const slot0AfterInit = await market.poolContract.slot0();
    const actualTick = Number(slot0AfterInit.tick);

    const initialAmount = ethers.utils.parseUnits("1000", 6);
    const initialCost = ethers.utils.parseUnits("1000", 6);
    const { poolLiquidity, currentTickAfter } = await addLiquidity(
      env,
      market,
      "YES",
      actualTick,
      true,
      initialAmount,
      initialCost,
      recipient.address
    );

    const yesPos = await env.business.tradeManager.userYesPositions(recipient.address, market.pool);
    const noPos = await env.business.tradeManager.userNoPositions(recipient.address, market.pool);
    expect(currentTickAfter).to.equal(0);
    expect(poolLiquidity).to.be.gt(0);
    expect(yesPos.yesTokenAmount).to.equal(initialAmount);
    expect(yesPos.usdSpent).to.equal(initialCost);
    expect(noPos.noTokenAmount).to.equal(0);
  });

  it("NO-only init when USDB=token0 starts at tick=69100 and fills USDB over 0.001~1", async function () {
    this.timeout(300000);

    const env = await setupBaseEnv();
    const market = await findMarketByOrder(env, true); // token0=USDB token1=YES
    const [, recipient] = await ethers.getSigners();
    await (await market.poolContract.initialize(tickToSqrtPriceX96(MAX_TICK))).wait();
    const slot0AfterInit = await market.poolContract.slot0();
    const actualTick = Number(slot0AfterInit.tick);

    const initialAmount = ethers.utils.parseUnits("1000", 6);
    const initialCost = ethers.utils.parseUnits("1000", 6);
    const { poolLiquidity, currentTickAfter } = await addLiquidity(
      env,
      market,
      "NO",
      actualTick,
      false,
      initialAmount,
      initialCost,
      recipient.address
    );

    const yesPos = await env.business.tradeManager.userYesPositions(recipient.address, market.pool);
    const noPos = await env.business.tradeManager.userNoPositions(recipient.address, market.pool);
    expect(Math.abs(actualTick - MAX_TICK)).to.be.lte(1);
    expect(poolLiquidity).to.be.gt(0);
    expect(yesPos.yesTokenAmount).to.equal(0);
    expect(noPos.noTokenAmount).to.equal(initialAmount);
    expect(noPos.usdSpent).to.equal(initialCost);
  });

  it("NO-only init when USDB=token1 starts at tick=-69100 and fills USDB over 0.001~1", async function () {
    this.timeout(300000);

    const env = await setupBaseEnv();
    const market = await findMarketByOrder(env, false); // token0=YES token1=USDB
    const [, recipient] = await ethers.getSigners();
    await (await market.poolContract.initialize(tickToSqrtPriceX96(MIN_TICK))).wait();
    const slot0AfterInit = await market.poolContract.slot0();
    const actualTick = Number(slot0AfterInit.tick);

    const initialAmount = ethers.utils.parseUnits("1000", 6);
    const initialCost = ethers.utils.parseUnits("1000", 6);
    const { poolLiquidity } = await addLiquidity(
      env,
      market,
      "NO",
      actualTick,
      false,
      initialAmount,
      initialCost,
      recipient.address
    );

    const yesPos = await env.business.tradeManager.userYesPositions(recipient.address, market.pool);
    const noPos = await env.business.tradeManager.userNoPositions(recipient.address, market.pool);
    expect(Math.abs(actualTick - MIN_TICK)).to.be.lte(1);
    expect(poolLiquidity).to.be.gt(0);
    expect(yesPos.yesTokenAmount).to.equal(0);
    expect(noPos.noTokenAmount).to.equal(initialAmount);
    expect(noPos.usdSpent).to.equal(initialCost);
  });
});
