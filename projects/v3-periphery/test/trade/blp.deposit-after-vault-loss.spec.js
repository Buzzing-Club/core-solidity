const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployCleanFixture } = require("../fixtures/cleanDeploy.fixture");

async function impersonate(address) {
  await ethers.provider.send("hardhat_setBalance", [address, "0x3635C9ADC5DEA00000"]); // 1000 ETH
  await ethers.provider.send("hardhat_impersonateAccount", [address]);
  return ethers.getSigner(address);
}

async function stopImpersonate(address) {
  await ethers.provider.send("hardhat_stopImpersonatingAccount", [address]);
}

describe("BLP deposit after vault loss", function () {
  it("initial 5000/5000, total vault loss 500, then user deposits 5000 and checks withdrawable", async function () {
    const ctx = await deployCleanFixture();
    const [lp, depositorT, depositorS] = await ethers.getSigners();
    const { usdc, usdb, tradeManager, tBLP, sBLP } = ctx.business;

    const to6 = (v) => ethers.utils.parseUnits(v, 6);
    const to18 = (v) => ethers.utils.parseUnits(v, 18);
    const fmt6 = (v) => ethers.utils.formatUnits(v, 6);
    const fmt18 = (v) => ethers.utils.formatUnits(v, 18);

    // 1) Initial LP capital: tBLP=5000, sBLP=5000.
    const lpSeed = to6("10000");
    await (await usdc.mint(lp.address, lpSeed)).wait();
    await (await usdc.connect(lp).approve(usdb.address, lpSeed)).wait();
    await (await usdb.connect(lp).deposit(lp.address, lpSeed)).wait();
    await (await usdb.connect(lp).approve(tradeManager.address, lpSeed)).wait();
    await (await tradeManager.connect(lp).LPDeposit(to6("5000"), lp.address, true)).wait();
    await (await tradeManager.connect(lp).LPDeposit(to6("5000"), lp.address, false)).wait();

    // 2) Simulate total vault loss = 500 (user profit 500), split by RiskCoefficient(90/10): t=450, s=50.
    const tmAddr = tradeManager.address;
    const tmSigner = await impersonate(tmAddr);
    try {
      await (await tBLP.connect(tmSigner).reclaimPnl(to6("450"))).wait();
      await (await sBLP.connect(tmSigner).reclaimPnl(to6("50"))).wait();

      const tPriceAfterLoss = await tBLP.shareToAssetsPrice();
      const sPriceAfterLoss = await sBLP.shareToAssetsPrice();
      expect(tPriceAfterLoss).to.equal(to18("0.91"));
      expect(sPriceAfterLoss).to.equal(to18("0.99"));

      // 3) New users each deposit 5000 into tBLP / sBLP.
      const depAmount = to6("5000");

      await (await usdc.mint(depositorT.address, depAmount)).wait();
      await (await usdc.connect(depositorT).approve(usdb.address, depAmount)).wait();
      await (await usdb.connect(depositorT).deposit(depositorT.address, depAmount)).wait();
      await (await usdb.connect(depositorT).approve(tradeManager.address, depAmount)).wait();
      await (await tradeManager.connect(depositorT).LPDeposit(depAmount, depositorT.address, true)).wait();

      await (await usdc.mint(depositorS.address, depAmount)).wait();
      await (await usdc.connect(depositorS).approve(usdb.address, depAmount)).wait();
      await (await usdb.connect(depositorS).deposit(depositorS.address, depAmount)).wait();
      await (await usdb.connect(depositorS).approve(tradeManager.address, depAmount)).wait();
      await (await tradeManager.connect(depositorS).LPDeposit(depAmount, depositorS.address, false)).wait();

      const tStoredPriceAfterDeposit = await tBLP.shareToAssetsPrice();
      const sStoredPriceAfterDeposit = await sBLP.shareToAssetsPrice();
      const tLivePriceAfterDeposit = await tBLP.AccPnlPerToken();
      const sLivePriceAfterDeposit = await sBLP.AccPnlPerToken();

      // Deposit/withdraw should be price-neutral: no hidden live/stored divergence.
      expect(tLivePriceAfterDeposit).to.equal(tStoredPriceAfterDeposit);
      expect(sLivePriceAfterDeposit).to.equal(sStoredPriceAfterDeposit);

      const tWithdrawableBeforeRefresh = await tBLP.maxWithdraw(depositorT.address);
      const sWithdrawableBeforeRefresh = await sBLP.maxWithdraw(depositorS.address);

      // 4) Tiny pnl updates to refresh stored share price.
      await (await tBLP.connect(tmSigner).distributePnl(1)).wait();
      await (await sBLP.connect(tmSigner).distributePnl(1)).wait();

      const tWithdrawableAfterRefresh = await tBLP.maxWithdraw(depositorT.address);
      const sWithdrawableAfterRefresh = await sBLP.maxWithdraw(depositorS.address);

      expect(tWithdrawableBeforeRefresh).to.be.closeTo(depAmount, 2);
      expect(sWithdrawableBeforeRefresh).to.be.closeTo(depAmount, 2);
      // Tiny refresh should only reflect the tiny real pnl update, not a jump from stale pricing.
      expect(tWithdrawableAfterRefresh.sub(tWithdrawableBeforeRefresh)).to.be.lt(to6("1"));
      expect(sWithdrawableAfterRefresh.sub(sWithdrawableBeforeRefresh)).to.be.lt(to6("1"));

      console.log("[deposit-after-loss] tPriceAfterLoss =", fmt18(tPriceAfterLoss));
      console.log("[deposit-after-loss] sPriceAfterLoss =", fmt18(sPriceAfterLoss));
      console.log("[deposit-after-loss] tStoredPriceAfterDeposit =", fmt18(tStoredPriceAfterDeposit));
      console.log("[deposit-after-loss] tLivePriceAfterDeposit =", fmt18(tLivePriceAfterDeposit));
      console.log("[deposit-after-loss] sStoredPriceAfterDeposit =", fmt18(sStoredPriceAfterDeposit));
      console.log("[deposit-after-loss] sLivePriceAfterDeposit =", fmt18(sLivePriceAfterDeposit));
      console.log("[deposit-after-loss] tWithdrawableBeforeRefresh =", fmt6(tWithdrawableBeforeRefresh));
      console.log("[deposit-after-loss] tWithdrawableAfterRefresh =", fmt6(tWithdrawableAfterRefresh));
      console.log("[deposit-after-loss] sWithdrawableBeforeRefresh =", fmt6(sWithdrawableBeforeRefresh));
      console.log("[deposit-after-loss] sWithdrawableAfterRefresh =", fmt6(sWithdrawableAfterRefresh));
    } finally {
      await stopImpersonate(tmAddr);
    }
  });
});
