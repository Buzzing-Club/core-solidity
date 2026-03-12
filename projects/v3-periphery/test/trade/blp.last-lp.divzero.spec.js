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

async function getTradeManagerSigner(tradeManagerAddress) {
  await ethers.provider.send("hardhat_setBalance", [tradeManagerAddress, "0x3635C9ADC5DEA00000"]); // 1000 ETH
  await ethers.provider.send("hardhat_impersonateAccount", [tradeManagerAddress]);
  return ethers.getSigner(tradeManagerAddress);
}

async function stopImpersonate(address) {
  await ethers.provider.send("hardhat_stopImpersonatingAccount", [address]);
}

async function setup() {
  const ctx = await deployCleanFixture();
  const [deployer] = await ethers.getSigners();
  const { business } = ctx;

  const depositAmount = ethers.utils.parseUnits("1000", 6);
  await (await business.usdc.mint(deployer.address, depositAmount.mul(3))).wait();
  await (await business.usdc.approve(business.usdb.address, depositAmount.mul(3))).wait();
  await (await business.usdb.deposit(deployer.address, depositAmount.mul(3))).wait();
  await (await business.usdb.approve(business.tradeManager.address, depositAmount.mul(3))).wait();

  return { ctx, deployer, depositAmount };
}

describe("sBLP/tBLP last LP withdraw safety", function () {
  const loadFixture = createFixtureLoader();

  it("allows full sBLP exit under negative pnl and resets price state", async function () {
    const { ctx, deployer, depositAmount } = await loadFixture(() => setup());
    const { business } = ctx;
    const tmAddr = business.tradeManager.address;

    await (await business.tradeManager.LPDeposit(depositAmount, deployer.address, false)).wait();
    await (await business.sBLP.connect(deployer).approve(tmAddr, ethers.constants.MaxUint256)).wait();

    const tmSigner = await getTradeManagerSigner(tmAddr);
    try {
      await (await business.sBLP.connect(tmSigner).reclaimPnl(1)).wait();
      const totalShares = await business.sBLP.balanceOf(deployer.address);
      expect(totalShares).to.be.gt(0);

      await (await business.sBLP.connect(tmSigner).redeem(totalShares, deployer.address, deployer.address)).wait();

      expect(await business.sBLP.balanceOf(deployer.address)).to.equal(0);
      expect(await business.sBLP.shareToAssetsPrice()).to.equal(ethers.constants.WeiPerEther);
      expect(await business.sBLP.accPnlPerToken()).to.equal(0);
    } finally {
      await stopImpersonate(tmAddr);
    }
  });

  it("allows full tBLP exit under negative pnl and resets price state", async function () {
    const { ctx, deployer, depositAmount } = await loadFixture(() => setup());
    const { business } = ctx;
    const tmAddr = business.tradeManager.address;

    await (await business.tradeManager.LPDeposit(depositAmount, deployer.address, true)).wait();
    await (await business.tBLP.connect(deployer).approve(tmAddr, ethers.constants.MaxUint256)).wait();

    const tmSigner = await getTradeManagerSigner(tmAddr);
    try {
      await (await business.tBLP.connect(tmSigner).reclaimPnl(1)).wait();
      const totalShares = await business.tBLP.balanceOf(deployer.address);
      expect(totalShares).to.be.gt(0);

      await (await business.tBLP.connect(tmSigner).redeem(totalShares, deployer.address, deployer.address)).wait();

      expect(await business.tBLP.balanceOf(deployer.address)).to.equal(0);
      expect(await business.tBLP.shareToAssetsPrice()).to.equal(ethers.constants.WeiPerEther);
      expect(await business.tBLP.accPnlPerToken()).to.equal(0);
    } finally {
      await stopImpersonate(tmAddr);
    }
  });

  it("does not trigger division-by-zero in sBLP when 1 share is left (not full redeem)", async function () {
    const { ctx, deployer, depositAmount } = await loadFixture(() => setup());
    const { business } = ctx;
    const tmAddr = business.tradeManager.address;

    await (await business.tradeManager.LPDeposit(depositAmount, deployer.address, false)).wait();
    await (await business.sBLP.connect(deployer).approve(tmAddr, ethers.constants.MaxUint256)).wait();

    const tmSigner = await getTradeManagerSigner(tmAddr);
    try {
      await (await business.sBLP.connect(tmSigner).reclaimPnl(1)).wait();

      const totalShares = await business.sBLP.balanceOf(deployer.address);
      expect(totalShares).to.be.gt(1);

      await (
        await business.sBLP.connect(tmSigner).redeem(totalShares.sub(1), deployer.address, deployer.address)
      ).wait();

      const sharesAfter = await business.sBLP.balanceOf(deployer.address);
      expect(sharesAfter).to.equal(1);
    } finally {
      await stopImpersonate(tmAddr);
    }
  });

  it("does not trigger division-by-zero in tBLP when 1 share is left (not full redeem)", async function () {
    const { ctx, deployer, depositAmount } = await loadFixture(() => setup());
    const { business } = ctx;
    const tmAddr = business.tradeManager.address;

    await (await business.tradeManager.LPDeposit(depositAmount, deployer.address, true)).wait();
    await (await business.tBLP.connect(deployer).approve(tmAddr, ethers.constants.MaxUint256)).wait();

    const tmSigner = await getTradeManagerSigner(tmAddr);
    try {
      await (await business.tBLP.connect(tmSigner).reclaimPnl(1)).wait();

      const totalShares = await business.tBLP.balanceOf(deployer.address);
      expect(totalShares).to.be.gt(1);

      await (
        await business.tBLP.connect(tmSigner).redeem(totalShares.sub(1), deployer.address, deployer.address)
      ).wait();

      const sharesAfter = await business.tBLP.balanceOf(deployer.address);
      expect(sharesAfter).to.equal(1);
    } finally {
      await stopImpersonate(tmAddr);
    }
  });
});
