const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployCleanFixture } = require("../fixtures/cleanDeploy.fixture");

const TOKEN_DATA =
  "0x627562626c79000000000000000000000000000000000000000000000000000c42554c000000000000000000000000000000000000000000000000000000000612";
const ZERO_BYTES32 = "0x" + "00".repeat(32);
const TICK_SPACING = 50; // fee=2500
const MIN_YES_PRICE_TICK = -25259; // price 0.08
const MAX_INV_YES_PRICE_TICK = 25258; // price 12.5 = 1 / 0.08
const SQRT_PRICE_X96_0P5 = ethers.BigNumber.from("56022770974786139918731938227");
const SQRT_PRICE_X96_2 = ethers.BigNumber.from("112045541949572279837463876454");
const FEE_SCALE = ethers.BigNumber.from("1000000");

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
  if (normalize(token0) === normalize(usdb)) return SQRT_PRICE_X96_2;
  return SQRT_PRICE_X96_0P5;
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
    tickUpper: floorToSpacing(0, TICK_SPACING),
    minTick: MIN_YES_PRICE_TICK,
    maxTick: 0,
  };
}

function parseEvent(receipt, contract, eventName) {
  const events = parseEvents(receipt, contract, eventName);
  return events.length > 0 ? events[events.length - 1] : null;
}

function parseEvents(receipt, contract, eventName) {
  const result = [];
  for (const log of receipt.logs) {
    if (normalize(log.address) !== normalize(contract.address)) continue;
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed.name === eventName) result.push(parsed);
    } catch (e) {
      // skip unrelated log
    }
  }
  return result;
}

function toSignedBigInt(value) {
  const str = value.toString();
  if (str.startsWith("-")) return BigInt(str);
  return BigInt(value.fromTwos(256).toString());
}

async function setupPoolAndLiquidity() {
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

  const splitAmount = ethers.utils.parseUnits("1000", 6);
  const prefund = ethers.utils.parseUnits("3000000", 6);

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

  const traderFund = ethers.utils.parseUnits("200", 6);
  await (await business.usdc.mint(trader.address, traderFund)).wait();
  await (await business.usdc.connect(trader).approve(business.usdb.address, traderFund)).wait();
  await (await business.usdb.connect(trader).deposit(trader.address, traderFund)).wait();

  const yesToken = await ethers.getContractAt("contracts/Wrapped1155Factory.sol:IERC20", yesTokenAddr);

  return {
    ctx,
    trader,
    pool,
    poolContract,
    yesTokenAddr,
    noTokenAddr,
    yesToken,
  };
}

describe("TradeManager pnl", function () {
  const loadFixture = createFixtureLoader();

  it("computes trader pnl and allocates pnl between tBLP/sBLP on sellYes", async function () {
    const env = await loadFixture(() => setupPoolAndLiquidity());
    const { ctx, trader, pool, yesTokenAddr, yesToken } = env;
    const { tradeManager, feeAdapter, tBLP, sBLP, dynamicFeeManager } = ctx.business;

    const buyAmountIn = ethers.utils.parseUnits("10", 6);
    await (await ctx.business.usdb.connect(trader).approve(tradeManager.address, buyAmountIn)).wait();

    const permit = {
      owner: trader.address,
      spender: ethers.constants.AddressZero,
      value: 0,
      deadline: 0,
      v: 0,
      r: ethers.constants.HashZero,
      s: ethers.constants.HashZero,
    };
    const buyParams = {
      tokenIn: ctx.business.usdb.address,
      tokenOut: yesTokenAddr,
      fee: 2500,
      recipient: trader.address,
      deadline: Math.floor(Date.now() / 1000) + 3600,
      amountIn: buyAmountIn,
      amountOutMinimum: 0,
      sqrtPriceLimitX96: 0,
    };
    await (await tradeManager.connect(trader).buyYes(buyParams, pool, 0, trader.address, permit)).wait();

    const yesBal = await yesToken.balanceOf(trader.address);
    const sellAmountIn = yesBal.div(2);
    await (await yesToken.connect(trader).approve(tradeManager.address, yesBal)).wait();

    const posBefore = await tradeManager.userYesPositions(trader.address, pool);
    const totalPnlBefore = await tradeManager.totalPnl();
    const feeRatio = await feeAdapter.poolTotalFeeRatio(pool);
    const lpShare = await feeAdapter.poolRoleShares(pool, ethers.utils.formatBytes32String("LP"));
    const riskCoefficient = await tradeManager.RiskCoefficient();
    const precision = ethers.constants.WeiPerEther;
    const variableFeeControl = await dynamicFeeManager.variableFeeControl();
    const baseFeeUnit = await dynamicFeeManager.baseFeeUnit();
    expect(variableFeeControl).to.equal(0);
    expect(baseFeeUnit).to.equal(0);

    const sellParams = {
      tokenIn: yesTokenAddr,
      tokenOut: ctx.business.usdb.address,
      fee: 2500,
      recipient: tradeManager.address,
      deadline: Math.floor(Date.now() / 1000) + 3600,
      amountIn: sellAmountIn,
      amountOutMinimum: 0,
      sqrtPriceLimitX96: 0,
    };

    const sellTx = await tradeManager.connect(trader).sellYes(sellParams, pool, 0, trader.address, permit);
    const receipt = await sellTx.wait();

    const sellEvent = parseEvent(receipt, tradeManager, "SellYes");
    const pnlEvents = parseEvents(receipt, tradeManager, "PnLHandled");
    const pnlEvent = pnlEvents.length > 0 ? pnlEvents[pnlEvents.length - 1] : null;
    expect(sellEvent).to.not.equal(null);
    expect(pnlEvent).to.not.equal(null);

    const amountOut = sellEvent.args.amountOut;
    const totalFeeAmount = amountOut.mul(feeRatio).div(FEE_SCALE);
    const lpFee = totalFeeAmount.mul(lpShare).div(feeRatio);

    const avgPrice = posBefore.usdSpent.mul(precision).div(posBefore.yesTokenAmount);
    const sellPrice = amountOut.mul(precision).div(sellAmountIn);

    const traderPnl =
      ((BigInt(sellPrice.toString()) - BigInt(avgPrice.toString())) * BigInt(sellAmountIn.toString())) /
      BigInt(precision.toString());
    const expectedHandledPnl = traderPnl + BigInt(lpFee.toString());
    const expectedTPnl = (expectedHandledPnl * BigInt(riskCoefficient.toString())) / 1000000000000000000n;
    const expectedSPnl = expectedHandledPnl - expectedTPnl;

    const actualHandledPnl = toSignedBigInt(pnlEvent.args[0]);
    const actualSPnl = toSignedBigInt(pnlEvent.args[1]);
    const actualTPnl = toSignedBigInt(pnlEvent.args[2]);

    console.log(`[pnl] expectedHandledPnl=${expectedHandledPnl.toString()} actualHandledPnl=${actualHandledPnl.toString()}`);

    expect(actualHandledPnl).to.equal(expectedHandledPnl);
    expect(actualSPnl).to.equal(expectedSPnl);
    expect(actualTPnl).to.equal(expectedTPnl);

    const totalPnlDeltaFromEvents = pnlEvents.reduce((acc, e) => acc + toSignedBigInt(e.args[0]), 0n);
    const totalPnlAfter = await tradeManager.totalPnl();
    expect(toSignedBigInt(totalPnlAfter)).to.equal(toSignedBigInt(totalPnlBefore) + totalPnlDeltaFromEvents);

    if (expectedHandledPnl < 0n) {
      const tDistEvent = parseEvent(receipt, tBLP, "PnlDistributed");
      const sDistEvent = parseEvent(receipt, sBLP, "PnlDistributed");
      expect(tDistEvent).to.not.equal(null);
      expect(sDistEvent).to.not.equal(null);
      expect(BigInt(tDistEvent.args.assets.toString())).to.equal(-expectedTPnl);
      expect(BigInt(sDistEvent.args.assets.toString())).to.equal(-expectedSPnl);
    } else if (expectedHandledPnl > 0n) {
      const tReclaimEvent = parseEvent(receipt, tBLP, "Pnlreclaimed");
      const sReclaimEvent = parseEvent(receipt, sBLP, "Pnlreclaimed");
      expect(tReclaimEvent).to.not.equal(null);
      expect(sReclaimEvent).to.not.equal(null);
      expect(BigInt(tReclaimEvent.args.assets.toString())).to.equal(expectedTPnl);
      expect(BigInt(sReclaimEvent.args.assets.toString())).to.equal(expectedSPnl);
    }
  });

});
