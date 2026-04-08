const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployCleanFixture } = require("../fixtures/cleanDeploy.fixture");

const TOKEN_DATA =
  "0x627562626c79000000000000000000000000000000000000000000000000000c42554c000000000000000000000000000000000000000000000000000000000612";
const ZERO_BYTES32 = "0x" + "00".repeat(32);
const FEE = 2500;
const TICK_SPACING = 50;
const Q96 = ethers.BigNumber.from(2).pow(96);

function normalize(addr) {
  return addr.toLowerCase();
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

  for (let i = 1; i <= 40; i += 1) {
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
    if (token0IsUsdb !== wantUsdbAsToken0) {
      continue;
    }

    await (await core.factory.createPool(yesTokenAddr, business.usdb.address, FEE)).wait();
    const pool = await core.factory.getPool(yesTokenAddr, business.usdb.address, FEE);
    const poolContract = new ethers.Contract(pool, poolArtifact.abi, ctx.deployer);
    await (await poolContract.initialize(Q96)).wait(); // tick = 0

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

async function addOneSidedLiquidity(env, market, tickLower, tickUpper) {
  const { business, ctx } = env;
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

  const yesIsToken0 = normalize(market.token0) === normalize(market.yesTokenAddr);
  const mintParams = {
    token0: market.token0,
    token1: market.token1,
    fee: FEE,
    tickLower,
    tickUpper,
    amount0Desired: yesIsToken0 ? ethers.utils.parseUnits("1000", 6) : ethers.utils.parseUnits("1", 6),
    amount1Desired: yesIsToken0 ? ethers.utils.parseUnits("1", 6) : ethers.utils.parseUnits("1000", 6),
    amount0Min: 0,
    amount1Min: 0,
    recipient: ctx.deployer.address,
    deadline: Math.floor(Date.now() / 1000) + 3600,
  };
  const usdbForLiquidity = normalize(market.token0) === normalize(business.usdb.address)
    ? mintParams.amount0Desired
    : normalize(market.token1) === normalize(business.usdb.address)
      ? mintParams.amount1Desired
      : ethers.constants.Zero;
  const initialTokenAmount = splitAmount;
  const initialUsdCost = splitAmount;

  console.log("[one-sided-add] token0=", market.token0, "token1=", market.token1);
  console.log("[one-sided-add] tickLower=", tickLower, "tickUpper=", tickUpper, "currentTick=0");
  console.log(
    "[one-sided-add] amount0Desired=",
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
      initialTokenAmount,
      initialUsdCost,
      usdbForLiquidity
    )
  ).wait();

  const ev = parseEvent(rcpt, business.tradeManager, "IncreaseLiquidity");
  expect(ev).to.not.equal(null);
  expect(ev.args.liquidity).to.be.gt(0);

  const [slot0, activeLiquidity] = await Promise.all([market.poolContract.slot0(), market.poolContract.liquidity()]);
  console.log(
    "[one-sided-add] result liquidity=",
    ev.args.liquidity.toString(),
    "amount0=",
    ev.args.amount0.toString(),
    "amount1=",
    ev.args.amount1.toString(),
    "poolLiquidity=",
    activeLiquidity.toString(),
    "tick=",
    Number(slot0.tick)
  );

  expect(Number(slot0.tick)).to.equal(0);
  expect(activeLiquidity).to.be.gt(0);
}

describe("One-sided liquidity add by token order", function () {
  it("adds active liquidity when USDB=token1 and YES=token0 using [-69100, 50)", async function () {
    this.timeout(300000);

    const env = await setupBaseEnv();
    const market = await findMarketByOrder(env, false);

    expect(normalize(market.token0)).to.equal(normalize(market.yesTokenAddr));
    expect(normalize(market.token1)).to.equal(normalize(env.business.usdb.address));
    expect((-69100) % TICK_SPACING).to.equal(0);
    expect(50 % TICK_SPACING).to.equal(0);

    await addOneSidedLiquidity(env, market, -69100, 50);
  });

  it("adds active liquidity when USDB=token0 and YES=token1 using [0, 69100)", async function () {
    this.timeout(300000);

    const env = await setupBaseEnv();
    const market = await findMarketByOrder(env, true);

    expect(normalize(market.token0)).to.equal(normalize(env.business.usdb.address));
    expect(normalize(market.token1)).to.equal(normalize(market.yesTokenAddr));
    expect(0 % TICK_SPACING).to.equal(0);
    expect(69100 % TICK_SPACING).to.equal(0);

    await addOneSidedLiquidity(env, market, 0, 69100);
  });
});
