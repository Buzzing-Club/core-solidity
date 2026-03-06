const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployCleanFixture, assertEqAddress } = require("../fixtures/cleanDeploy.fixture");

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

describe("Clean Deploy Fixture", function () {
  const loadFixture = createFixtureLoader();

  it("deploys all contracts with non-zero addresses", async function () {
    const ctx = await loadFixture(() => deployCleanFixture());
    const groups = [ctx.core, ctx.periphery, ctx.business];

    for (const group of groups) {
      for (const instance of Object.values(group)) {
        if (instance && instance.address) {
          expect(instance.address).to.properAddress;
          expect(instance.address).to.not.equal(ethers.constants.AddressZero);
        }
      }
    }
  });

  it("wires core contracts correctly", async function () {
    const { core } = await loadFixture(() => deployCleanFixture());
    assertEqAddress("poolDeployer.factoryAddress", await core.poolDeployer.factoryAddress(), core.factory.address);
    assertEqAddress("factory.poolDeployer", await core.factory.poolDeployer(), core.poolDeployer.address);
  });

  it("wires periphery immutables correctly", async function () {
    const { core, periphery, wnative } = await loadFixture(() => deployCleanFixture());
    assertEqAddress("swapRouter.deployer", await periphery.swapRouter.deployer(), core.poolDeployer.address);
    assertEqAddress("swapRouter.factory", await periphery.swapRouter.factory(), core.factory.address);
    assertEqAddress("swapRouter.WETH9", await periphery.swapRouter.WETH9(), wnative);
    assertEqAddress("npm.deployer", await periphery.nonfungiblePositionManager.deployer(), core.poolDeployer.address);
    assertEqAddress("npm.factory", await periphery.nonfungiblePositionManager.factory(), core.factory.address);
    assertEqAddress("npm.WETH9", await periphery.nonfungiblePositionManager.WETH9(), wnative);
    assertEqAddress("v3Migrator.factory", await periphery.v3Migrator.factory(), core.factory.address);
    assertEqAddress("quoterV2.factory", await periphery.quoterV2.factory(), core.factory.address);
  });

  it("wires business layer addresses and handlers correctly", async function () {
    const { core, periphery, business } = await loadFixture(() => deployCleanFixture());
    assertEqAddress("USDB.asset", await business.usdb.asset(), business.usdc.address);
    assertEqAddress("USDB.vault", await business.usdb.vault(), business.tradeManager.address);
    assertEqAddress("SwapRouter.vaultaddress", await periphery.swapRouter.vaultaddress(), business.tradeManager.address);
    assertEqAddress("tradeManager.usdbTokenAddress", await business.tradeManager.usdbTokenAddress(), business.usdb.address);
    assertEqAddress(
      "tradeManager.NonfungiblePositionManager",
      await business.tradeManager.NonfungiblePositionManager(),
      periphery.nonfungiblePositionManager.address
    );
    assertEqAddress("tradeManager.SwapRouter", await business.tradeManager.SwapRouter(), periphery.swapRouter.address);
    assertEqAddress("tradeManager.ctfAddress", await business.tradeManager.ctfAddress(), business.ctf.address);
    assertEqAddress("tradeManager.erc1155Factory", await business.tradeManager.erc1155Factory(), business.wrapped1155Factory.address);
    assertEqAddress("tradeManager.tBLP", await business.tradeManager.tBLP(), business.tBLP.address);
    assertEqAddress("tradeManager.sBLP", await business.tradeManager.sBLP(), business.sBLP.address);
    assertEqAddress("tradeManager.deployer", await business.tradeManager.deployer(), core.poolDeployer.address);
    assertEqAddress("tradeManager.feeAdapter", await business.tradeManager.feeAdapter(), business.feeAdapter.address);
    assertEqAddress("tradeManager.feeManager", await business.tradeManager.feeManager(), business.dynamicFeeManager.address);
    assertEqAddress("sBLP.pnlHandler", await business.sBLPToken.pnlHandler(), business.tradeManager.address);
    assertEqAddress("tBLP.pnlHandler", await business.tBLPToken.pnlHandler(), business.tradeManager.address);
  });

  it("sets dynamic fee params from fixture defaults", async function () {
    const { business, params } = await loadFixture(() => deployCleanFixture());
    expect(await business.dynamicFeeManager.filterPeriod()).to.equal(params.dynamicFee.filterPeriod);
    expect(await business.dynamicFeeManager.decayPeriod()).to.equal(params.dynamicFee.decayPeriod);
    expect(await business.dynamicFeeManager.reductionFactor()).to.equal(params.dynamicFee.reductionFactor);
    expect(await business.dynamicFeeManager.maxAccumulator()).to.equal(params.dynamicFee.maxAccumulator);
    expect(await business.dynamicFeeManager.variableFeeControl()).to.equal(params.dynamicFee.variableFeeControl);
    expect(await business.dynamicFeeManager.baseFeeUnit()).to.equal(params.dynamicFee.baseFeeUnit);
    assertEqAddress("dynamicFeeManager.tradeManager", await business.dynamicFeeManager.tradeManager(), business.tradeManager.address);
    assertEqAddress("feeAdapter.vault", await business.feeAdapter.vault(), business.tradeManager.address);
  });
});

