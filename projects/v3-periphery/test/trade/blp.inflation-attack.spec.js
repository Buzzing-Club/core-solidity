const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployCleanFixture } = require("../fixtures/cleanDeploy.fixture");

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

async function fundUsdb(ctx, user, amount) {
  const { usdc, usdb, tradeManager } = ctx.business;
  await (await usdc.mint(user.address, amount)).wait();
  await (await usdc.connect(user).approve(usdb.address, amount)).wait();
  await (await usdb.connect(user).deposit(user.address, amount)).wait();
  await (await usdb.connect(user).approve(tradeManager.address, amount)).wait();
}

describe("sBLP/tBLP inflation-attack resistance", function () {
  const loadFixture = createFixtureLoader();

  it("sBLP: direct donation cannot inflate share price or steal later depositor shares", async function () {
    const ctx = await loadFixture(() => deployCleanFixture());
    const [, attacker, victim] = await ethers.getSigners();
    const { usdb, tradeManager, sBLP } = ctx.business;

    const attackerSeed = ethers.utils.parseUnits("1", 6);
    const victimDeposit = ethers.utils.parseUnits("1000", 6);
    const donation = ethers.utils.parseUnits("500000", 6);

    await fundUsdb(ctx, attacker, attackerSeed.add(donation));
    await fundUsdb(ctx, victim, victimDeposit);

    await (await tradeManager.connect(attacker).LPDeposit(attackerSeed, attacker.address, false)).wait();

    const previewBefore = await sBLP.previewDeposit(victimDeposit);
    const priceBefore = await sBLP.shareToAssetsPrice();

    await (await usdb.connect(attacker).transfer(sBLP.address, donation)).wait();

    const previewAfter = await sBLP.previewDeposit(victimDeposit);
    const priceAfter = await sBLP.shareToAssetsPrice();
    expect(priceAfter).to.equal(priceBefore);
    expect(previewAfter).to.equal(previewBefore);

    const sharesBefore = await sBLP.balanceOf(victim.address);
    await (await tradeManager.connect(victim).LPDeposit(victimDeposit, victim.address, false)).wait();
    const sharesAfter = await sBLP.balanceOf(victim.address);
    expect(sharesAfter.sub(sharesBefore)).to.equal(victimDeposit);
  });

  it("tBLP: direct donation cannot inflate share price or steal later depositor shares", async function () {
    const ctx = await loadFixture(() => deployCleanFixture());
    const [, attacker, victim] = await ethers.getSigners();
    const { usdb, tradeManager, tBLP } = ctx.business;

    const attackerSeed = ethers.utils.parseUnits("1", 6);
    const victimDeposit = ethers.utils.parseUnits("1000", 6);
    const donation = ethers.utils.parseUnits("500000", 6);

    await fundUsdb(ctx, attacker, attackerSeed.add(donation));
    await fundUsdb(ctx, victim, victimDeposit);

    await (await tradeManager.connect(attacker).LPDeposit(attackerSeed, attacker.address, true)).wait();

    const previewBefore = await tBLP.previewDeposit(victimDeposit);
    const priceBefore = await tBLP.shareToAssetsPrice();

    await (await usdb.connect(attacker).transfer(tBLP.address, donation)).wait();

    const previewAfter = await tBLP.previewDeposit(victimDeposit);
    const priceAfter = await tBLP.shareToAssetsPrice();
    expect(priceAfter).to.equal(priceBefore);
    expect(previewAfter).to.equal(previewBefore);

    const sharesBefore = await tBLP.balanceOf(victim.address);
    await (await tradeManager.connect(victim).LPDeposit(victimDeposit, victim.address, true)).wait();
    const sharesAfter = await tBLP.balanceOf(victim.address);
    expect(sharesAfter.sub(sharesBefore)).to.equal(victimDeposit);
  });
});
