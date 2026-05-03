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

async function impersonate(address) {
  await ethers.provider.send("hardhat_setBalance", [address, "0x3635C9ADC5DEA00000"]); // 1000 ETH
  await ethers.provider.send("hardhat_impersonateAccount", [address]);
  return ethers.getSigner(address);
}

async function stopImpersonate(address) {
  await ethers.provider.send("hardhat_stopImpersonatingAccount", [address]);
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

async function setupTradePath(ctx) {
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
  await business.ctf.getPositionId(business.usdb.address, noCollectionId);

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
      pool,
      true,
      0,
      0,
      splitAmount.div(2)
    )
  ).wait();

  const yesToken = await ethers.getContractAt("contracts/Wrapped1155Factory.sol:IERC20", yesTokenAddr);
  return { pool, yesTokenAddr, yesToken };
}

describe("tBLP price jump reproduction", function () {
  it("keeps deposit price-neutral and avoids jump on small sell refresh", async function () {
    const ctx = await deployCleanFixture();
    const [deployer, whale, trader] = await ethers.getSigners();
    const { usdc, usdb, tradeManager, tBLP } = ctx.business;

    const to6 = (v) => ethers.utils.parseUnits(v, 6);
    const toUSDC = (v) => ethers.utils.formatUnits(v, 6);
    const toUSDC6 = (v) => {
      const s = toUSDC(v);
      const parts = s.split(".");
      const intPart = parts[0];
      const fracPart = (parts[1] || "").padEnd(6, "0").slice(0, 6);
      return `${intPart}.${fracPart}`;
    };
    const one = ethers.constants.WeiPerEther;

    const { pool, yesTokenAddr, yesToken } = await setupTradePath(ctx);
    const permit = {
      owner: trader.address,
      spender: ethers.constants.AddressZero,
      value: 0,
      deadline: 0,
      v: 0,
      r: ethers.constants.HashZero,
      s: ethers.constants.HashZero,
    };

    // Prepare balances for two LP accounts.
    const seed = to6("20000");
    await (await usdc.mint(deployer.address, seed)).wait();
    await (await usdc.mint(whale.address, seed)).wait();

    await (await usdc.connect(deployer).approve(usdb.address, seed)).wait();
    await (await usdc.connect(whale).approve(usdb.address, seed)).wait();

    await (await usdb.connect(deployer).deposit(deployer.address, seed)).wait();
    await (await usdb.connect(whale).deposit(whale.address, seed)).wait();

    await (await usdb.connect(deployer).approve(tradeManager.address, seed)).wait();
    await (await usdb.connect(whale).approve(tradeManager.address, seed)).wait();

    // Keep initial supplies very small; sBLP needs non-zero supply for pnl splitting.
    await (await tradeManager.connect(deployer).LPDeposit(to6("2"), deployer.address, false)).wait();
    await (await tradeManager.connect(deployer).LPDeposit(to6("2"), deployer.address, true)).wait();

    const tmAddr = tradeManager.address;
    const tmSigner = await impersonate(tmAddr);

    try {
      // Push price into a low range (example value; exact low value is not required).
      await (await tBLP.connect(tmSigner).reclaimPnl(692000)).wait();

      const lowPrice = await tBLP.shareToAssetsPrice();
      expect(lowPrice).to.be.gt(one.mul(3).div(10)); // > 0.3
      expect(lowPrice).to.be.lt(one.mul(8).div(10)); // < 0.8

      // Large deposit under low price should remain price-neutral.
      const whaleDepositUSDC = to6("9999");
      await (await tradeManager.connect(whale).LPDeposit(whaleDepositUSDC, whale.address, true)).wait();

      const storedPriceAfterDeposit = await tBLP.shareToAssetsPrice();
      const livePriceAfterDeposit = await tBLP.AccPnlPerToken();
      expect(storedPriceAfterDeposit).to.equal(lowPrice);
      expect(livePriceAfterDeposit).to.equal(lowPrice);

      const whaleMaxBeforeRefresh = await tBLP.maxWithdraw(whale.address);

      // Use a real sell tx to trigger _handlePnl -> share price refresh.
      const traderFund = to6("200");
      await (await usdc.mint(trader.address, traderFund)).wait();
      await (await usdc.connect(trader).approve(usdb.address, traderFund)).wait();
      await (await usdb.connect(trader).deposit(trader.address, traderFund)).wait();
      await (await usdb.connect(trader).approve(tradeManager.address, traderFund)).wait();

      const buyParams = {
        tokenIn: usdb.address,
        tokenOut: yesTokenAddr,
        fee: 2500,
        recipient: trader.address,
        deadline: Math.floor(Date.now() / 1000) + 3600,
        amountIn: to6("10"),
        amountOutMinimum: 0,
        sqrtPriceLimitX96: 0,
      };
      await (await tradeManager.connect(trader).buyYes(buyParams, pool, 0, trader.address, permit)).wait();

      const yesBal = await yesToken.balanceOf(trader.address);
      expect(yesBal).to.be.gt(0);
      await (await yesToken.connect(trader).approve(tradeManager.address, yesBal)).wait();

      const sellParams = {
        tokenIn: yesTokenAddr,
        tokenOut: usdb.address,
        fee: 2500,
        recipient: tradeManager.address,
        deadline: Math.floor(Date.now() / 1000) + 3600,
        amountIn: yesBal.div(4),
        amountOutMinimum: 0,
        sqrtPriceLimitX96: 0,
      };
      const sellReceipt = await (await tradeManager.connect(trader).sellYes(sellParams, pool, 0, trader.address, permit)).wait();

      const tDistEvents = parseEvents(sellReceipt, tBLP, "PnlDistributed");
      const tReclaimEvents = parseEvents(sellReceipt, tBLP, "Pnlreclaimed");
      const tPriceEvents = parseEvents(sellReceipt, tBLP, "ShareToAssetsPriceUpdated");
      expect(tDistEvents.length + tReclaimEvents.length).to.be.greaterThan(0);
      expect(tPriceEvents.length).to.be.greaterThan(0);

      const refreshedPrice = await tBLP.shareToAssetsPrice();
      const whaleMaxAfterRefresh = await tBLP.maxWithdraw(whale.address);

      // No delayed jump: refresh should only reflect this sell's own pnl impact.
      const priceDelta = refreshedPrice.gt(storedPriceAfterDeposit)
        ? refreshedPrice.sub(storedPriceAfterDeposit)
        : storedPriceAfterDeposit.sub(refreshedPrice);
      const withdrawDelta = whaleMaxAfterRefresh.gt(whaleMaxBeforeRefresh)
        ? whaleMaxAfterRefresh.sub(whaleMaxBeforeRefresh)
        : whaleMaxBeforeRefresh.sub(whaleMaxAfterRefresh);

      expect(priceDelta).to.be.lt(one.div(100)); // < 0.01
      expect(withdrawDelta).to.be.lt(to6("100")); // no big withdraw-capacity jump

      console.log("[price-jump-repro] lowPrice =", lowPrice.toString());
      console.log("[price-jump-repro] livePriceAfterDeposit =", livePriceAfterDeposit.toString());
      console.log("[price-jump-repro] refreshedPrice =", refreshedPrice.toString());
      console.log("[price-jump-repro] whaleMaxBeforeRefresh =", whaleMaxBeforeRefresh.toString());
      console.log("[price-jump-repro] whaleMaxAfterRefresh =", whaleMaxAfterRefresh.toString());
      console.log("[price-jump-repro] sellTriggerEventCount =", (tDistEvents.length + tReclaimEvents.length).toString());
      console.log("[price-jump-repro] userDepositUSDC =", toUSDC6(whaleDepositUSDC));
      console.log("[price-jump-repro] withdrawableBeforeRefreshUSDC =", toUSDC6(whaleMaxBeforeRefresh));
      console.log("[price-jump-repro] withdrawableAfterRefreshUSDC =", toUSDC6(whaleMaxAfterRefresh));
    } finally {
      await stopImpersonate(tmAddr);
    }
  });
});
