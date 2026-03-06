const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  WITHDRAW_FEE_BPS,
  BPS_DENOM,
  usdcAmount,
  createFixtureLoader,
  deployPreTradingFixture,
} = require("./helpers");

describe("PreTrading Scenario 3", function () {
  const loadFixture = createFixtureLoader();

  it("multiple users withdraw, after lock period claimWithdraw succeeds with fee", async function () {
    const { u1, u2, preTrading, usdc } = await loadFixture(() => deployPreTradingFixture());
    const cond = ethers.utils.formatBytes32String("UNLOCK_TEST");

    const w1 = usdcAmount(250);
    const w2 = usdcAmount(120);
    await (await preTrading.connect(u1).deposit(cond, true, usdcAmount(800))).wait();
    await (await preTrading.connect(u2).deposit(cond, false, usdcAmount(700))).wait();
    await (await preTrading.connect(u1).withdraw(cond, true, w1)).wait();
    await (await preTrading.connect(u2).withdraw(cond, false, w2)).wait();

    await ethers.provider.send("evm_increaseTime", [24 * 60 * 60 + 1]);
    await ethers.provider.send("evm_mine", []);

    const u1Before = await usdc.balanceOf(u1.address);
    const u2Before = await usdc.balanceOf(u2.address);
    await (await preTrading.connect(u1).claimWithdraw(cond, true)).wait();
    await (await preTrading.connect(u2).claimWithdraw(cond, false)).wait();
    const u1After = await usdc.balanceOf(u1.address);
    const u2After = await usdc.balanceOf(u2.address);

    const expectedU1 = w1.sub(w1.mul(WITHDRAW_FEE_BPS).div(BPS_DENOM));
    const expectedU2 = w2.sub(w2.mul(WITHDRAW_FEE_BPS).div(BPS_DENOM));
    expect(u1After.sub(u1Before)).to.equal(expectedU1);
    expect(u2After.sub(u2Before)).to.equal(expectedU2);
  });
});

