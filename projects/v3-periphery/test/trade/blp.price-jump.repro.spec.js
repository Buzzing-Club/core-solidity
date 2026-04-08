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

describe("tBLP price jump reproduction", function () {
  it("observes low-price deposit path and jump on tiny pnl refresh", async function () {
    const ctx = await deployCleanFixture();
    const [deployer, whale] = await ethers.getSigners();
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

    // Prepare balances for two accounts
    const seed = to6("20000");
    await (await usdc.mint(deployer.address, seed)).wait();
    await (await usdc.mint(whale.address, seed)).wait();

    await (await usdc.connect(deployer).approve(usdb.address, seed)).wait();
    await (await usdc.connect(whale).approve(usdb.address, seed)).wait();

    await (await usdb.connect(deployer).deposit(deployer.address, seed)).wait();
    await (await usdb.connect(whale).deposit(whale.address, seed)).wait();

    await (await usdb.connect(deployer).approve(tradeManager.address, seed)).wait();
    await (await usdb.connect(whale).approve(tradeManager.address, seed)).wait();

    // Keep initial tBLP supply very small
    await (await tradeManager.connect(deployer).LPDeposit(to6("2"), deployer.address, true)).wait();

    const tmAddr = tradeManager.address;
    const tmSigner = await impersonate(tmAddr);

    try {
      // Push price into a low range (example value; exact low value is not required)
      await (await tBLP.connect(tmSigner).reclaimPnl(692000)).wait();

      const lowPrice = await tBLP.shareToAssetsPrice();
      expect(lowPrice).to.be.gt(one.mul(3).div(10)); // > 0.3
      expect(lowPrice).to.be.lt(one.mul(8).div(10)); // < 0.8

      // Large deposit under low price: state gets diluted, stored price not refreshed here
      const whaleDepositUSDC = to6("9999");
      await (await tradeManager.connect(whale).LPDeposit(whaleDepositUSDC, whale.address, true)).wait();

      const storedPriceAfterDeposit = await tBLP.shareToAssetsPrice();
      const livePriceAfterDeposit = await tBLP.AccPnlPerToken();
      expect(storedPriceAfterDeposit).to.equal(lowPrice);
      expect(livePriceAfterDeposit).to.be.gt(one.mul(95).div(100)); // already close to 1.0

      const whaleMaxBeforeRefresh = await tBLP.maxWithdraw(whale.address);

      // Tiny pnl update triggers shareToAssetsPrice refresh
      await (await tBLP.connect(tmSigner).distributePnl(17963)).wait();

      const refreshedPrice = await tBLP.shareToAssetsPrice();
      const whaleMaxAfterRefresh = await tBLP.maxWithdraw(whale.address);

      expect(refreshedPrice).to.be.gt(one.mul(9).div(10)); // > 0.9
      expect(refreshedPrice.sub(storedPriceAfterDeposit)).to.be.gt(one.div(10)); // jump > 0.1
      expect(whaleMaxAfterRefresh).to.be.gt(whaleMaxBeforeRefresh.mul(11).div(10)); // withdraw capacity jumps

      console.log("[price-jump-repro] lowPrice =", lowPrice.toString());
      console.log("[price-jump-repro] livePriceAfterDeposit =", livePriceAfterDeposit.toString());
      console.log("[price-jump-repro] refreshedPrice =", refreshedPrice.toString());
      console.log("[price-jump-repro] whaleMaxBeforeRefresh =", whaleMaxBeforeRefresh.toString());
      console.log("[price-jump-repro] whaleMaxAfterRefresh =", whaleMaxAfterRefresh.toString());
      console.log("[price-jump-repro] userDepositUSDC =", toUSDC6(whaleDepositUSDC));
      console.log("[price-jump-repro] withdrawableBeforeRefreshUSDC =", toUSDC6(whaleMaxBeforeRefresh));
      console.log("[price-jump-repro] withdrawableAfterRefreshUSDC =", toUSDC6(whaleMaxAfterRefresh));
    } finally {
      await stopImpersonate(tmAddr);
    }
  });
});

