const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  usdcAmount,
  createFixtureLoader,
  calcNetPayout,
  deployPreTradingFixture,
} = require("./helpers");

describe("PreTrading Scenario 1", function () {
  const loadFixture = createFixtureLoader();

  it("multiple users bet YES/NO, resolve different results, claim payouts match expectation", async function () {
    const { oracle, u1, u2, u3, usdc, preTrading } = await loadFixture(() => deployPreTradingFixture());
    const condYes = ethers.utils.formatBytes32String("COND_YES");
    const condNo = ethers.utils.formatBytes32String("COND_NO");
    const threshold = usdcAmount(1000000);

    await (await preTrading.connect(oracle).setMarketTransferThreshold(condYes, threshold)).wait();
    await (await preTrading.connect(oracle).setMarketTransferThreshold(condNo, threshold)).wait();

    const aYesU1 = usdcAmount(200);
    const aYesU2 = usdcAmount(300);
    const aNoU3 = usdcAmount(500);
    await (await preTrading.connect(u1).deposit(condYes, true, aYesU1)).wait();
    await (await preTrading.connect(u2).deposit(condYes, true, aYesU2)).wait();
    await (await preTrading.connect(u3).deposit(condYes, false, aNoU3)).wait();

    const aTotal = aYesU1.add(aYesU2).add(aNoU3);
    const aYesTotal = aYesU1.add(aYesU2);
    const aExpectedU1 = calcNetPayout(aYesU1, aTotal, aYesTotal);
    const aExpectedU2 = calcNetPayout(aYesU2, aTotal, aYesTotal);

    await (await preTrading.connect(oracle).resolveMarket(condYes, 1)).wait();

    const u1BeforeA = await usdc.balanceOf(u1.address);
    const u2BeforeA = await usdc.balanceOf(u2.address);
    await (await preTrading.connect(u1).claim(condYes)).wait();
    await (await preTrading.connect(u2).claim(condYes)).wait();
    const u1AfterA = await usdc.balanceOf(u1.address);
    const u2AfterA = await usdc.balanceOf(u2.address);
    expect(u1AfterA.sub(u1BeforeA)).to.equal(aExpectedU1);
    expect(u2AfterA.sub(u2BeforeA)).to.equal(aExpectedU2);
    await expect(preTrading.connect(u3).claim(condYes)).to.be.revertedWith("No winning position");

    const bYesU1 = usdcAmount(400);
    const bNoU2 = usdcAmount(300);
    const bNoU3 = usdcAmount(300);
    await (await preTrading.connect(u1).deposit(condNo, true, bYesU1)).wait();
    await (await preTrading.connect(u2).deposit(condNo, false, bNoU2)).wait();
    await (await preTrading.connect(u3).deposit(condNo, false, bNoU3)).wait();

    const bTotal = bYesU1.add(bNoU2).add(bNoU3);
    const bNoTotal = bNoU2.add(bNoU3);
    const bExpectedU2 = calcNetPayout(bNoU2, bTotal, bNoTotal);
    const bExpectedU3 = calcNetPayout(bNoU3, bTotal, bNoTotal);

    await (await preTrading.connect(oracle).resolveMarket(condNo, 2)).wait();

    const u2BeforeB = await usdc.balanceOf(u2.address);
    const u3BeforeB = await usdc.balanceOf(u3.address);
    await (await preTrading.connect(u2).claim(condNo)).wait();
    await (await preTrading.connect(u3).claim(condNo)).wait();
    const u2AfterB = await usdc.balanceOf(u2.address);
    const u3AfterB = await usdc.balanceOf(u3.address);
    expect(u2AfterB.sub(u2BeforeB)).to.equal(bExpectedU2);
    expect(u3AfterB.sub(u3BeforeB)).to.equal(bExpectedU3);
    await expect(preTrading.connect(u1).claim(condNo)).to.be.revertedWith("No winning position");
  });
});
