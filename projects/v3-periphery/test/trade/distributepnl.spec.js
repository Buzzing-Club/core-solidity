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
    };
  }
  return {
    tickLower: ceilToSpacing(MIN_YES_PRICE_TICK, TICK_SPACING),
    tickUpper: floorToSpacing(0, TICK_SPACING),
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
  return { ctx, trader, pool, yesTokenAddr, yesToken };
}

describe("TradeManager distribute/reclaim pnl settlement", function () {
  const loadFixture = createFixtureLoader();

  it("prints key pnl allocation, price moves and withdraw expectations", async function () {
    const env = await loadFixture(() => setupPoolAndLiquidity());
    const { ctx, trader, pool, yesTokenAddr, yesToken } = env;
    const { tradeManager, feeAdapter, tBLP, sBLP, usdb, dynamicFeeManager } = ctx.business;
    const deployer = ctx.deployer;

    const buyAmountIn = ethers.utils.parseUnits("10", 6);
    await (await usdb.connect(trader).approve(tradeManager.address, buyAmountIn)).wait();

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
      tokenIn: usdb.address,
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
    const feeRatio = await feeAdapter.poolTotalFeeRatio(pool);
    const lpShare = await feeAdapter.poolRoleShares(pool, ethers.utils.formatBytes32String("LP"));
    const riskCoefficient = await tradeManager.RiskCoefficient();
    const precision = ethers.constants.WeiPerEther;
    expect(await dynamicFeeManager.variableFeeControl()).to.equal(0);
    expect(await dynamicFeeManager.baseFeeUnit()).to.equal(0);

    const tUsdbBefore = await usdb.balanceOf(tBLP.address);
    const sUsdbBefore = await usdb.balanceOf(sBLP.address);
    const tPriceBefore = await tBLP.shareToAssetsPrice();
    const sPriceBefore = await sBLP.shareToAssetsPrice();
    const tSharesBeforeWithdraw = await tBLP.balanceOf(deployer.address);
    const sSharesBeforeWithdraw = await sBLP.balanceOf(deployer.address);

    const sellParams = {
      tokenIn: yesTokenAddr,
      tokenOut: usdb.address,
      fee: 2500,
      recipient: tradeManager.address,
      deadline: Math.floor(Date.now() / 1000) + 3600,
      amountIn: sellAmountIn,
      amountOutMinimum: 0,
      sqrtPriceLimitX96: 0,
    };
    const receipt = await (await tradeManager.connect(trader).sellYes(sellParams, pool, 0, trader.address, permit)).wait();
    const sellEvent = parseEvent(receipt, tradeManager, "SellYes");
    const pnlEvent = parseEvent(receipt, tradeManager, "PnLHandled");
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
    const handledPnl = traderPnl + BigInt(lpFee.toString());
    const tPnl = (handledPnl * BigInt(riskCoefficient.toString())) / 1000000000000000000n;
    const sPnl = handledPnl - tPnl;

    const tUsdbAfter = await usdb.balanceOf(tBLP.address);
    const sUsdbAfter = await usdb.balanceOf(sBLP.address);
    const tPriceAfter = await tBLP.shareToAssetsPrice();
    const sPriceAfter = await sBLP.shareToAssetsPrice();

    let balanceMatch = false;
    if (handledPnl > 0n) {
      balanceMatch =
        tUsdbAfter.eq(tUsdbBefore.sub(tPnl.toString())) &&
        sUsdbAfter.eq(sUsdbBefore.sub(sPnl.toString()));
    } else if (handledPnl < 0n) {
      balanceMatch =
        tUsdbAfter.eq(tUsdbBefore.add((-tPnl).toString())) &&
        sUsdbAfter.eq(sUsdbBefore.add((-sPnl).toString()));
    } else {
      balanceMatch = tUsdbAfter.eq(tUsdbBefore) && sUsdbAfter.eq(sUsdbBefore);
    }
    expect(balanceMatch).to.equal(true);

    await (await tBLP.connect(deployer).approve(tradeManager.address, ethers.constants.MaxUint256)).wait();
    await (await sBLP.connect(deployer).approve(tradeManager.address, ethers.constants.MaxUint256)).wait();

    const tMax = await tBLP.maxWithdraw(deployer.address);
    const sMax = await sBLP.maxWithdraw(deployer.address);
    const tExpectedByPrice = tSharesBeforeWithdraw.mul(tPriceAfter).div(precision);
    const sExpectedByPrice = sSharesBeforeWithdraw.mul(sPriceAfter).div(precision);
    const expectedModelMatch = tExpectedByPrice.eq(tMax) && sExpectedByPrice.eq(sMax);
    expect(expectedModelMatch).to.equal(true);

    const tWithdraw = tMax.div(20);
    const sWithdraw = sMax.div(20);
    expect(tWithdraw).to.be.gt(0);
    expect(sWithdraw).to.be.gt(0);

    const deployerUsdbBefore = await usdb.balanceOf(deployer.address);
    await (await tradeManager.connect(deployer).LPWithdraw(tWithdraw, deployer.address, deployer.address, true)).wait();
    await (await tradeManager.connect(deployer).LPWithdraw(sWithdraw, deployer.address, deployer.address, false)).wait();
    const deployerUsdbAfter = await usdb.balanceOf(deployer.address);
    const withdrawMatch = deployerUsdbAfter.sub(deployerUsdbBefore).eq(tWithdraw.add(sWithdraw));
    expect(withdrawMatch).to.equal(true);

    console.log("[distributePnl-check] userPnl=", traderPnl.toString());
    console.log("[distributePnl-check] handledPnl=", handledPnl.toString());
    console.log("[distributePnl-check] alloc tBLP=", tPnl.toString(), "sBLP=", sPnl.toString());
    console.log("[distributePnl-check] tBLP price", tPriceBefore.toString(), "->", tPriceAfter.toString());
    console.log("[distributePnl-check] sBLP price", sPriceBefore.toString(), "->", sPriceAfter.toString());
    console.log("[distributePnl-check] LP shares tBLP=", tSharesBeforeWithdraw.toString(), "sBLP=", sSharesBeforeWithdraw.toString());
    console.log("[distributePnl-check] tBLP usdb", tUsdbBefore.toString(), "->", tUsdbAfter.toString());
    console.log("[distributePnl-check] sBLP usdb", sUsdbBefore.toString(), "->", sUsdbAfter.toString());
    console.log("[distributePnl-check] maxWithdrawByPrice tBLP=", tExpectedByPrice.toString(), "sBLP=", sExpectedByPrice.toString());
    console.log("[distributePnl-check] maxWithdrawOnChain tBLP=", tMax.toString(), "sBLP=", sMax.toString());
    console.log("[distributePnl-check] requestedWithdraw(5%) tBLP=", tWithdraw.toString(), "sBLP=", sWithdraw.toString());
    console.log("[distributePnl-check] withdrawReceived=", deployerUsdbAfter.sub(deployerUsdbBefore).toString());
    console.log("[distributePnl-check] balanceMatch=", balanceMatch, "expectedModelMatch=", expectedModelMatch, "withdrawMatch=", withdrawMatch);
    console.log("[distributePnl-check] withdraw is as expected under current price model =", expectedModelMatch && withdrawMatch);
  });
});
