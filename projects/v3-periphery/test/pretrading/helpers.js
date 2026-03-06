const { ethers } = require("hardhat");

const WITHDRAW_FEE_BPS = 500;
const PROFIT_FEE_BPS = 500;
const BPS_DENOM = 10000;

function usdcAmount(v) {
  return ethers.utils.parseUnits(String(v), 6);
}

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

function calcNetPayout(principal, totalPool, sideTotal) {
  const gross = principal.mul(totalPool).div(sideTotal);
  if (gross.gt(principal)) {
    const profit = gross.sub(principal);
    const fee = profit.mul(PROFIT_FEE_BPS).div(BPS_DENOM);
    return gross.sub(fee);
  }
  return gross;
}

async function deployPreTradingFixture(threshold = usdcAmount(1000000)) {
  const [owner, oracle, u1, u2, u3, u4] = await ethers.getSigners();

  const usdc = await (await ethers.getContractFactory("USDC", owner)).deploy();
  await usdc.deployed();

  const preTrading = await (await ethers.getContractFactory("PreTrading", owner)).deploy(
    usdc.address,
    oracle.address,
    threshold
  );
  await preTrading.deployed();

  const users = [u1, u2, u3, u4];
  for (const u of users) {
    await (await usdc.mint(u.address, usdcAmount(2000000))).wait();
    await (await usdc.connect(u).approve(preTrading.address, ethers.constants.MaxUint256)).wait();
  }

  return { owner, oracle, u1, u2, u3, u4, usdc, preTrading };
}

module.exports = {
  WITHDRAW_FEE_BPS,
  BPS_DENOM,
  usdcAmount,
  createFixtureLoader,
  calcNetPayout,
  deployPreTradingFixture,
};

