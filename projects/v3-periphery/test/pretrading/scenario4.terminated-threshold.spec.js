const { expect } = require("chai");
const { ethers } = require("hardhat");
const { usdcAmount, deployPreTradingFixture } = require("./helpers");

describe("PreTrading Scenario 4", function () {
  it("when total deposits exceed threshold, market becomes TERMINATED immediately", async function () {
    const threshold = ethers.BigNumber.from("1000000000"); // 1000 USDC (6 decimals)
    const { u1, u2, preTrading } = await deployPreTradingFixture(threshold);
    const cond = ethers.utils.formatBytes32String("TERM_TEST");

    await (await preTrading.connect(u1).deposit(cond, true, usdcAmount(1001))).wait();
    expect(await preTrading.marketTransferThreshold()).to.equal(threshold);
    expect(await preTrading.totalUSD(cond)).to.equal(usdcAmount(1001));
    expect(await preTrading.marketStatus(cond)).to.equal(1); // TERMINATED

    await expect(preTrading.connect(u2).deposit(cond, false, usdcAmount(1))).to.be.revertedWith("Market not open");
  });
});

