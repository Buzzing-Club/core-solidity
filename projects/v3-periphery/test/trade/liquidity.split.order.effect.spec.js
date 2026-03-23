const { expect } = require("chai");
const { ethers } = require("hardhat");
const Decimal = require("decimal.js");
const { deployCleanFixture } = require("../fixtures/cleanDeploy.fixture");

const TOKEN_DATA =
  "0x627562626c79000000000000000000000000000000000000000000000000000c42554c000000000000000000000000000000000000000000000000000000000612";
const ZERO_BYTES32 = "0x" + "00".repeat(32);
const FEE = 2500;
const TICK_SPACING = 50;
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

async function setupEnv() {
  const ctx = await deployCleanFixture();
  const [, trader] = await ethers.getSigners();
  const { core, business } = ctx;
  const poolArtifact = require("@pancakeswap/v3-core/artifacts/contracts/BuzzingSwapPool.sol/BuzzingSwapPool.json");

  const sUsds = await (await ethers.getContractFactory("SUsds")).deploy(business.usdc.address);
  await sUsds.deployed();
  await (await business.tradeManager.setYieldProtocol(sUsds.address)).wait();

  const questionId = "0x" + "0".repeat(63) + "a";
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

  // Force pool tick to land on boundary tick exactly.
  await (await poolContract.initialize(sqrtPriceX96FromTick(BOUNDARY_TICK + 1))).wait();
  const slot0 = await poolContract.slot0();
  expect(Number(slot0.tick)).to.equal(BOUNDARY_TICK);

  expect(BOUNDARY_TICK % TICK_SPACING).to.equal(0);
  expect(UPPER_TICK % TICK_SPACING).to.equal(0);

  const prefund = ethers.utils.parseUnits("3000000", 6);
  await (await business.usdc.mint(ctx.deployer.address, prefund)).wait();
  await (await business.usdc.approve(business.usdb.address, prefund)).wait();
  await (await business.usdb.deposit(ctx.deployer.address, prefund)).wait();
  await (await business.usdb.transfer(business.tradeManager.address, prefund.div(4))).wait();

  return {
    ctx,
    trader,
    pool,
    poolContract,
    yesTokenAddr,
    conditionId,
    yesPositionId,
    currentTick: Number(slot0.tick),
  };
}

async function addRange(env, tickLower, tickUpper, splitAmount, yesTransferAmount, amount0Desired, amount1Desired) {
  const { ctx, pool, yesTokenAddr, conditionId, yesPositionId } = env;
  const [token0, token1] = sortPair(yesTokenAddr, ctx.business.usdb.address);
  const slot0Before = await env.poolContract.slot0();
  console.log(
    "[addRange] tickInfo currentTick=",
    Number(slot0Before.tick),
    "tickLower=",
    tickLower,
    "tickUpper=",
    tickUpper
  );

  const splitPositionParams = {
    collateralToken: ctx.business.usdb.address,
    parentCollectionId: ZERO_BYTES32,
    conditionId,
    partition: [1, 2],
    amount: splitAmount,
  };
  const transferParams = {
    from: ctx.business.tradeManager.address,
    to: ctx.business.wrapped1155Factory.address,
    id: yesPositionId,
    value: splitAmount,
    data: TOKEN_DATA,
  };
  const mintParams = {
    token0,
    token1,
    fee: FEE,
    tickLower,
    tickUpper,
    amount0Desired,
    amount1Desired,
    amount0Min: 0,
    amount1Min: 0,
    recipient: ctx.deployer.address,
    deadline: Math.floor(Date.now() / 1000) + 3600,
  };

  console.log("[addRange] mintParams=", JSON.stringify({
    token0: mintParams.token0,
    token1: mintParams.token1,
    fee: mintParams.fee,
    tickLower: mintParams.tickLower,
    tickUpper: mintParams.tickUpper,
    amount0Desired: mintParams.amount0Desired.toString(),
    amount1Desired: mintParams.amount1Desired.toString(),
    amount0Min: mintParams.amount0Min,
    amount1Min: mintParams.amount1Min,
    recipient: mintParams.recipient,
    deadline: mintParams.deadline
  }));
  console.log("[addRange] splitPositionParams=", JSON.stringify({
    collateralToken: splitPositionParams.collateralToken,
    parentCollectionId: splitPositionParams.parentCollectionId,
    conditionId: splitPositionParams.conditionId,
    partition: splitPositionParams.partition,
    amount: splitPositionParams.amount.toString()
  }));
  console.log("[addRange] transferParams=", JSON.stringify({
    from: transferParams.from,
    to: transferParams.to,
    id: transferParams.id.toString(),
    value: transferParams.value.toString(),
    data: transferParams.data
  }));

  const rcpt = await (
    await ctx.business.tradeManager.addLiquidity(
      mintParams,
      splitPositionParams,
      transferParams,
      ctx.business.wrapped1155Factory.address,
      pool
    )
  ).wait();

  const ev = parseEvent(rcpt, ctx.business.tradeManager, "IncreaseLiquidity");
  expect(ev).to.not.equal(null);
  expect(ev.args.liquidity).to.be.gt(0);
  const slot0After = await env.poolContract.slot0();
  console.log("[addRange] tickAfter=", Number(slot0After.tick));
  console.log("[addRange] txHash=", rcpt.transactionHash, "gasUsed=", rcpt.gasUsed.toString());
  console.log("[addRange] IncreaseLiquidity=", JSON.stringify({
    tokenId: ev.args.tokenId.toString(),
    liquidity: ev.args.liquidity.toString(),
    amount0: ev.args.amount0.toString(),
    amount1: ev.args.amount1.toString()
  }));
  return ev.args;
}

describe("Liquidity split order effect around boundary tick", function () {
  it("at exact tick=6950, order matters: lower->upper fails on second add; upper->lower succeeds", async function () {
    this.timeout(300000);

    const initialSplit = ethers.utils.parseUnits("1000", 6);
    const noNewSplit = ethers.constants.Zero;

    // lower range consumes more mixed inventory, upper range needs mostly one side near boundary
    const lowerDesired0 = ethers.utils.parseUnits("1000", 6);
    const lowerDesired1 = ethers.utils.parseUnits("1000", 6);
    const upperDesired0 = ethers.utils.parseUnits("100", 6);
    const upperDesired1 = ethers.utils.parseUnits("100", 6);

    // -------- case 1: first add [0,6950], second add [6950,9950] --------
    const env1 = await setupEnv();
    const firstAdd1 = await addRange(
      env1,
      0,
      BOUNDARY_TICK,
      initialSplit,
      initialSplit,
      lowerDesired0,
      lowerDesired1
    );
    console.log("[case1] tick=", env1.currentTick, "amount0=", firstAdd1.amount0.toString(), "amount1=", firstAdd1.amount1.toString());

    await expect(
      addRange(
        env1,
        BOUNDARY_TICK,
        UPPER_TICK,
        noNewSplit,
        noNewSplit,
        upperDesired0,
        upperDesired1
      )
    ).to.be.revertedWith("STF");

    // -------- case 2: first add [6950,9950], second add [0,6950] --------
    const env2 = await setupEnv();
    const firstAdd2 = await addRange(
      env2,
      BOUNDARY_TICK,
      UPPER_TICK,
      initialSplit,
      initialSplit,
      upperDesired0,
      upperDesired1
    );
    console.log("[case2] tick=", env2.currentTick, "amount0=", firstAdd2.amount0.toString(), "amount1=", firstAdd2.amount1.toString());
    const secondAdd2 = await addRange(
      env2,
      0,
      BOUNDARY_TICK,
      noNewSplit,
      noNewSplit,
      lowerDesired0,
      lowerDesired1
    );
    console.log("[case2] second amount0=", secondAdd2.amount0.toString(), "amount1=", secondAdd2.amount1.toString());
  });
});
