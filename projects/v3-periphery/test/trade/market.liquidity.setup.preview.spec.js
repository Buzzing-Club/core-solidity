const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployCleanFixture } = require("../fixtures/cleanDeploy.fixture");

const TOKEN_DATA =
  "0x627562626c79000000000000000000000000000000000000000000000000000c42554c000000000000000000000000000000000000000000000000000000000612";
const ZERO_BYTES32 = "0x" + "00".repeat(32);
const FEE = 2500;
const TICK_SPACING = 50;

function normalize(addr) {
  return addr.toLowerCase();
}

function sortPair(a, b) {
  return normalize(a) < normalize(b) ? [a, b] : [b, a];
}

function floorToSpacing(v, spacing) {
  return Math.floor(v / spacing) * spacing;
}

function ceilToSpacing(v, spacing) {
  return Math.ceil(v / spacing) * spacing;
}

function yesPriceToTick(yesPrice, usdb, yesToken) {
  // Uniswap tick uses token1/token0.
  // yesPrice = USDB per YES
  // token0 = USDB => ratio = YES/USDB = 1/yesPrice
  // token0 = YES  => ratio = USDB/YES = yesPrice
  const [token0] = sortPair(usdb, yesToken);
  const ratio = normalize(token0) === normalize(usdb) ? 1 / yesPrice : yesPrice;
  return Math.floor(Math.log(ratio) / Math.log(1.0001));
}

function rangeToTicks(yesPriceLower, yesPriceUpper, usdb, yesToken) {
  const t1 = yesPriceToTick(yesPriceLower, usdb, yesToken);
  const t2 = yesPriceToTick(yesPriceUpper, usdb, yesToken);
  const lower = Math.min(t1, t2);
  const upper = Math.max(t1, t2);
  return {
    tickLower: ceilToSpacing(lower, TICK_SPACING),
    tickUpper: floorToSpacing(upper, TICK_SPACING),
    rawLower: lower,
    rawUpper: upper,
  };
}

function parseEvent(receipt, contract, eventName) {
  for (const log of receipt.logs) {
    if (normalize(log.address) !== normalize(contract.address)) continue;
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed.name === eventName) return parsed;
    } catch (e) {
      // skip
    }
  }
  return null;
}

describe("Market setup preview: deploy + create market + add liquidity", function () {
  it("adds YES-side and USDB-side liquidity then stops before trading", async function () {
    this.timeout(300000);

    const ctx = await deployCleanFixture();
    const { core, business } = ctx;
    const poolArtifact = require("@pancakeswap/v3-core/artifacts/contracts/BuzzingSwapPool.sol/BuzzingSwapPool.json");

    // add yield protocol to satisfy TradeManager exposure checks
    const sUsds = await (await ethers.getContractFactory("SUsds")).deploy(business.usdc.address);
    await sUsds.deployed();
    await (await business.tradeManager.setYieldProtocol(sUsds.address)).wait();

    // create condition market (YES/NO)
    const questionId = "0x" + "0".repeat(63) + "7";
    await (await business.ctf.prepareCondition(ctx.deployer.address, questionId, 2)).wait();
    const conditionId = await business.ctf.getConditionId(ctx.deployer.address, questionId, 2);
    const yesCollectionId = await business.ctf.getCollectionId(ZERO_BYTES32, conditionId, 1);
    const noCollectionId = await business.ctf.getCollectionId(ZERO_BYTES32, conditionId, 2);
    const yesPositionId = await business.ctf.getPositionId(business.usdb.address, yesCollectionId);
    const noPositionId = await business.ctf.getPositionId(business.usdb.address, noCollectionId);

    const yesTokenAddr = await business.wrapped1155Factory.getWrapped1155(business.ctf.address, yesPositionId, TOKEN_DATA);
    await business.wrapped1155Factory.getWrapped1155(business.ctf.address, noPositionId, TOKEN_DATA);

    await (await core.factory.createPool(yesTokenAddr, business.usdb.address, FEE)).wait();
    const pool = await core.factory.getPool(yesTokenAddr, business.usdb.address, FEE);
    const poolContract = new ethers.Contract(pool, poolArtifact.abi, ctx.deployer);

    // initialize market price to YES=0.5 USDB
    const sqrtPrice0p5 = ethers.BigNumber.from("56022770974786139918731938227");
    const sqrtPrice2 = ethers.BigNumber.from("112045541949572279837463876454");
    const [token0] = sortPair(business.usdb.address, yesTokenAddr);
    const initSqrt = normalize(token0) === normalize(business.usdb.address) ? sqrtPrice2 : sqrtPrice0p5;
    await (await poolContract.initialize(initSqrt)).wait();

    // fee adapter config
    const LP_ROLE = ethers.utils.formatBytes32String("LP");
    const BUFFER_ROLE = ethers.utils.formatBytes32String("Buffer");
    await (await business.feeAdapter.setPoolTotalFeeRatio(pool, 100000)).wait();
    await (await business.feeAdapter.setPoolRole(pool, LP_ROLE, ctx.deployer.address, 70000)).wait();
    await (await business.feeAdapter.setPoolRole(pool, BUFFER_ROLE, ctx.deployer.address, 30000)).wait();
    await (await business.feeAdapter.setPoolReferShare(pool, 0)).wait();

    // prefund vault and LP buckets
    const prefund = ethers.utils.parseUnits("3000000", 6);
    await (await business.usdc.mint(ctx.deployer.address, prefund)).wait();
    await (await business.usdc.approve(business.usdb.address, prefund)).wait();
    await (await business.usdb.deposit(ctx.deployer.address, prefund)).wait();
    await (await business.usdb.transfer(business.tradeManager.address, prefund.div(2))).wait();
    await (await business.usdb.approve(business.tradeManager.address, prefund.div(3))).wait();
    await (await business.tradeManager.LPDeposit(prefund.div(6), ctx.deployer.address, true)).wait();
    await (await business.tradeManager.LPDeposit(prefund.div(6), ctx.deployer.address, false)).wait();

    // shared params
    const splitAmount = ethers.utils.parseUnits("1000", 6);
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
    const [pToken0, pToken1] = sortPair(yesTokenAddr, business.usdb.address);

    // 1) YES token side: price band 0.5 ~ 1
    const yesBand = rangeToTicks(0.5, 1.0, business.usdb.address, yesTokenAddr);
    const yesTokenAmount = ethers.utils.parseUnits("1000", 6);
    const mintYes = {
      token0: pToken0,
      token1: pToken1,
      fee: FEE,
      tickLower: yesBand.tickLower,
      tickUpper: yesBand.tickUpper,
      amount0Desired: normalize(pToken0) === normalize(yesTokenAddr) ? yesTokenAmount : ethers.utils.parseUnits("1", 6),
      amount1Desired: normalize(pToken1) === normalize(yesTokenAddr) ? yesTokenAmount : ethers.utils.parseUnits("1", 6),
      amount0Min: 0,
      amount1Min: 0,
      recipient: ctx.deployer.address,
      deadline: Math.floor(Date.now() / 1000) + 3600,
    };

    const txYes = await business.tradeManager.addLiquidity(
      mintYes,
      splitPositionParams,
      transferParams,
      business.wrapped1155Factory.address,
      pool
    );
    const rcptYes = await txYes.wait();
    const evYes = parseEvent(rcptYes, business.tradeManager, "IncreaseLiquidity");
    expect(evYes).to.not.equal(null);

    // 2) USDB side: price band 0.001 ~ 0.5
    const usdbBand = rangeToTicks(0.001, 0.5, business.usdb.address, yesTokenAddr);
    const usdbAmount = ethers.utils.parseUnits("1000", 6);
    const mintUsdb = {
      token0: pToken0,
      token1: pToken1,
      fee: FEE,
      tickLower: usdbBand.tickLower,
      tickUpper: usdbBand.tickUpper,
      amount0Desired: normalize(pToken0) === normalize(business.usdb.address) ? usdbAmount : ethers.utils.parseUnits("1", 6),
      amount1Desired: normalize(pToken1) === normalize(business.usdb.address) ? usdbAmount : ethers.utils.parseUnits("1", 6),
      amount0Min: 0,
      amount1Min: 0,
      recipient: ctx.deployer.address,
      deadline: Math.floor(Date.now() / 1000) + 3600,
    };

    const txUsdb = await business.tradeManager.addLiquidity(
      mintUsdb,
      splitPositionParams,
      transferParams,
      business.wrapped1155Factory.address,
      pool
    );
    const rcptUsdb = await txUsdb.wait();
    const evUsdb = parseEvent(rcptUsdb, business.tradeManager, "IncreaseLiquidity");
    expect(evUsdb).to.not.equal(null);

    const slot0 = await poolContract.slot0();
    console.log("[liquidity-setup] pool=", pool);
    console.log("[liquidity-setup] token0=", pToken0, "token1=", pToken1);
    console.log("[liquidity-setup] initTick=", slot0.tick.toString());

    console.log("[liquidity-setup][YES-band] requestedPriceRange=0.5~1");
    console.log(
      "[liquidity-setup][YES-band] ticks(raw/aligned)=",
      `${yesBand.rawLower}~${yesBand.rawUpper} / ${yesBand.tickLower}~${yesBand.tickUpper}`
    );
    console.log(
      "[liquidity-setup][YES-band] mintDesired(amount0,amount1)=",
      mintYes.amount0Desired.toString(),
      mintYes.amount1Desired.toString()
    );
    console.log(
      "[liquidity-setup][YES-band] result(tokenId,liquidity,amount0,amount1)=",
      evYes.args.tokenId.toString(),
      evYes.args.liquidity.toString(),
      evYes.args.amount0.toString(),
      evYes.args.amount1.toString()
    );

    console.log("[liquidity-setup][USDB-band] requestedPriceRange=0.001~0.5");
    console.log(
      "[liquidity-setup][USDB-band] ticks(raw/aligned)=",
      `${usdbBand.rawLower}~${usdbBand.rawUpper} / ${usdbBand.tickLower}~${usdbBand.tickUpper}`
    );
    console.log(
      "[liquidity-setup][USDB-band] mintDesired(amount0,amount1)=",
      mintUsdb.amount0Desired.toString(),
      mintUsdb.amount1Desired.toString()
    );
    console.log(
      "[liquidity-setup][USDB-band] result(tokenId,liquidity,amount0,amount1)=",
      evUsdb.args.tokenId.toString(),
      evUsdb.args.liquidity.toString(),
      evUsdb.args.amount0.toString(),
      evUsdb.args.amount1.toString()
    );

    // stop here intentionally: do NOT perform 100 USDB trade in this preview
  });
});

