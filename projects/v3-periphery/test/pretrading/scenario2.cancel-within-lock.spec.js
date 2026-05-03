const { expect } = require("chai");
const { ethers } = require("hardhat");
const { usdcAmount, createFixtureLoader, deployPreTradingFixture } = require("./helpers");

describe("PreTrading Scenario 2", function () {
  const loadFixture = createFixtureLoader();

  it("multiple users withdraw/cancel flow, claimWithdraw should fail during lock period", async function () {
    const { oracle, u1, u2, u3, preTrading } = await loadFixture(() => deployPreTradingFixture());
    const cond = ethers.utils.formatBytes32String("LOCK_TEST");
    await (await preTrading.connect(oracle).setMarketTransferThreshold(cond, usdcAmount(1000000))).wait();

    await (await preTrading.connect(u1).deposit(cond, true, usdcAmount(500))).wait();
    await (await preTrading.connect(u2).deposit(cond, false, usdcAmount(400))).wait();
    await (await preTrading.connect(u3).deposit(cond, true, usdcAmount(300))).wait();

    await (await preTrading.connect(u1).withdraw(cond, true, usdcAmount(200))).wait();
    await (await preTrading.connect(u2).withdraw(cond, false, usdcAmount(100))).wait();

    await expect(preTrading.connect(u1).claimWithdraw(cond, true)).to.be.revertedWith("Too early");
    await expect(preTrading.connect(u2).claimWithdraw(cond, false)).to.be.revertedWith("Too early");

    await (await preTrading.connect(u1).cancelWithdraw(cond, true)).wait();
    await (await preTrading.connect(u2).cancelWithdraw(cond, false)).wait();

    await expect(preTrading.connect(u1).claimWithdraw(cond, true)).to.be.revertedWith("No YES pending");
    await expect(preTrading.connect(u2).claimWithdraw(cond, false)).to.be.revertedWith("No NO pending");
  });
});
