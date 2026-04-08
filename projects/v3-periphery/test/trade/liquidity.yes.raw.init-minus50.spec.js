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

async function buildUsdbToken1Market(env) {
  const { ctx, core, business, poolArtifact } = env;

  for (let i = 701; i <= 760; i += 1) {
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
    if (token0IsUsdb) continue; // we need USDB=token1, YES=token0

    await (await core.factory.createPool(yesTokenAddr, business.usdb.address, FEE)).wait();
    const pool = await core.factory.getPool(yesTokenAddr, business.usdb.address, FEE);
    const poolContract = new ethers.Contract(pool, poolArtifact.abi, ctx.deployer);

    return {
      pool,
      poolContract,
      conditionId,
      yesPositionId,
      yesTokenAddr,
      token0: yesTokenAddr,
      token1: business.usdb.address,
    };
  }

  throw new Error("Could not build market with USDB=token1");
}

describe("YES raw add at init tick -100", function () {
  it("reproduces addLiquidity behavior at initTick=-100 and range [-50, 0)", async function () {
    this.timeout(300000);

    const env = await setupBaseEnv();
    const market = await buildUsdbToken1Market(env);
    const [operator, recipient] = await ethers.getSigners();
    const rawYes = ethers.utils.parseUnits("1000", 6); // 1000000000

    await (await market.poolContract.initialize(tickToSqrtPriceX96(-100))).wait();
    const slot0 = await market.poolContract.slot0();
    const poolToken0 = await market.poolContract.token0();
    const poolToken1 = await market.poolContract.token1();

    const splitPositionParams = {
      collateralToken: env.business.usdb.address,
      parentCollectionId: ZERO_BYTES32,
      conditionId: market.conditionId,
      partition: [1, 2],
      amount: rawYes,
    };

    const transferParams = {
      from: env.business.tradeManager.address,
      to: env.business.wrapped1155Factory.address,
      id: market.yesPositionId,
      value: rawYes,
      data: TOKEN_DATA,
    };

    const mintParams = {
      token0: market.token0,
      token1: market.token1,
      fee: FEE,
      tickLower: -50,
      tickUpper: 0,
      amount0Desired: rawYes,
      amount1Desired: 0,
      amount0Min: 0,
      amount1Min: 0,
      recipient: recipient.address,
      deadline: Math.floor(Date.now() / 1000) + 3600,
    };

    console.log(
      "[yes-raw-minus50] operator=",
      operator.address,
      "recipient=",
      recipient.address
    );
    console.log(
      "[yes-raw-minus50] pool=",
      market.pool,
      "token0=",
      market.token0,
      "token1=",
      market.token1
    );
    console.log(
      "[yes-raw-minus50] pool.token0()=",
      poolToken0,
      "pool.token1()=",
      poolToken1
    );
    console.log(
      "[yes-raw-minus50] mintParams.token0=",
      mintParams.token0,
      "mintParams.token1=",
      mintParams.token1
    );
    console.log(
      "[yes-raw-minus50] currentTick=",
      Number(slot0.tick),
      "tickLower=",
      mintParams.tickLower,
      "tickUpper=",
      mintParams.tickUpper
    );
    console.log(
      "[yes-raw-minus50] amount0Desired=",
      mintParams.amount0Desired.toString(),
      "amount1Desired=",
      mintParams.amount1Desired.toString(),
      "usdbForLiquidity=0"
    );

    await expect(
      env.business.tradeManager.addLiquidity(
        mintParams,
        splitPositionParams,
        transferParams,
        env.business.wrapped1155Factory.address,
        market.pool,
        true,
        rawYes,
        rawYes,
        0
      )
    ).to.not.be.reverted;
  });
});
