const { ethers, upgrades } = require("hardhat");
const { ContractFactory, constants } = require("ethers");

const ZERO_ADDRESS = constants.AddressZero;

const DEFAULT_WNATIVE_BY_CHAIN = {
  31337: "0x4200000000000000000000000000000000000006",
  84532: "0x4200000000000000000000000000000000000006",
};

const DEFAULT_DYNAMIC_FEE_PARAMS = {
  filterPeriod: 600,
  decayPeriod: 3600,
  reductionFactor: ethers.utils.parseUnits("0.9", 18),
  maxAccumulator: "1000000000000",
  variableFeeControl: 0,
  baseFeeUnit: 0,
};

function normalize(addr) {
  return addr.toLowerCase();
}

function assertAddress(label, addr) {
  if (!addr || addr === ZERO_ADDRESS) {
    throw new Error(`${label} is zero address`);
  }
}

function assertEqAddress(label, actual, expected) {
  if (normalize(actual) !== normalize(expected)) {
    throw new Error(`${label} mismatch: actual=${actual}, expected=${expected}`);
  }
}

async function deployCore(deployer) {
  const artifacts = {
    BuzzingSwapPoolDeployer: require("@pancakeswap/v3-core/artifacts/contracts/BuzzingSwapPoolDeployer.sol/BuzzingSwapPoolDeployer.json"),
    BuzzingSwapFactory: require("@pancakeswap/v3-core/artifacts/contracts/BuzzingSwapFactory.sol/BuzzingSwapFactory.json"),
  };

  const PoolDeployerFactory = new ContractFactory(
    artifacts.BuzzingSwapPoolDeployer.abi,
    artifacts.BuzzingSwapPoolDeployer.bytecode,
    deployer
  );
  const poolDeployer = await PoolDeployerFactory.deploy();
  await poolDeployer.deployed();
  assertAddress("BuzzingSwapPoolDeployer", poolDeployer.address);

  const FactoryFactory = new ContractFactory(
    artifacts.BuzzingSwapFactory.abi,
    artifacts.BuzzingSwapFactory.bytecode,
    deployer
  );
  const factory = await FactoryFactory.deploy(poolDeployer.address);
  await factory.deployed();
  assertAddress("BuzzingSwapFactory", factory.address);

  await (await poolDeployer.setFactoryAddress(factory.address)).wait();
  assertEqAddress("poolDeployer.factoryAddress", await poolDeployer.factoryAddress(), factory.address);
  assertEqAddress("factory.poolDeployer", await factory.poolDeployer(), poolDeployer.address);

  return { poolDeployer, factory };
}

async function deployPeriphery(deployer, core, wnative) {
  const swapRouter = await (await ethers.getContractFactory("SwapRouter", deployer)).deploy(
    core.poolDeployer.address,
    core.factory.address,
    wnative
  );
  await swapRouter.deployed();

  const descriptor = await (await ethers.getContractFactory("NonfungibleTokenPositionDescriptorOffChain", deployer)).deploy();
  await descriptor.deployed();
  await (await descriptor.initialize("")).wait();

  const nonfungiblePositionManager = await (await ethers.getContractFactory("NonfungiblePositionManager", deployer)).deploy(
    core.poolDeployer.address,
    core.factory.address,
    wnative,
    descriptor.address
  );
  await nonfungiblePositionManager.deployed();

  const multicall = await (await ethers.getContractFactory("BuzzingInterfaceMulticall", deployer)).deploy();
  await multicall.deployed();

  const v3Migrator = await (await ethers.getContractFactory("V3Migrator", deployer)).deploy(
    core.poolDeployer.address,
    core.factory.address,
    wnative,
    nonfungiblePositionManager.address
  );
  await v3Migrator.deployed();

  const tickLens = await (await ethers.getContractFactory("TickLens", deployer)).deploy();
  await tickLens.deployed();

  const quoterV2 = await (await ethers.getContractFactory("QuoterV2", deployer)).deploy(
    core.poolDeployer.address,
    core.factory.address,
    wnative
  );
  await quoterV2.deployed();

  return {
    swapRouter,
    descriptor,
    nonfungiblePositionManager,
    multicall,
    v3Migrator,
    tickLens,
    quoterV2,
  };
}

async function deployBusinessLayer(deployer, core, periphery) {
  const wrapped1155Factory = await (await ethers.getContractFactory("contracts/Wrapped1155Factory.sol:Wrapped1155Factory", deployer)).deploy();
  await wrapped1155Factory.deployed();

  const ctf = await (await ethers.getContractFactory("ConditionalTokens", deployer)).deploy();
  await ctf.deployed();

  const usdc = await (await ethers.getContractFactory("USDC", deployer)).deploy();
  await usdc.deployed();

  const usdb = await (await ethers.getContractFactory("USDB", deployer)).deploy(usdc.address);
  await usdb.deployed();

  const tBLPFactory = await ethers.getContractFactory("tBLP", deployer);
  const tBLP = await upgrades.deployProxy(tBLPFactory, [usdb.address], {
    initializer: "initialize",
    kind: "transparent",
  });
  await tBLP.deployed();

  const sBLPFactory = await ethers.getContractFactory("sBLP", deployer);
  const sBLP = await upgrades.deployProxy(sBLPFactory, [usdb.address], {
    initializer: "initialize",
    kind: "transparent",
  });
  await sBLP.deployed();

  const tradeManagerFactory = await ethers.getContractFactory("tradeManager", deployer);
  const tradeManager = await upgrades.deployProxy(
    tradeManagerFactory,
    [
      usdb.address,
      usdc.address,
      periphery.nonfungiblePositionManager.address,
      ctf.address,
      periphery.swapRouter.address,
      tBLP.address,
      sBLP.address,
      wrapped1155Factory.address,
      core.poolDeployer.address,
    ],
    { initializer: "initialize", kind: "transparent" }
  );
  await tradeManager.deployed();

  const sBLPToken = (await ethers.getContractFactory("sBLP", deployer)).attach(sBLP.address);
  const tBLPToken = (await ethers.getContractFactory("tBLP", deployer)).attach(tBLP.address);
  await (await sBLPToken.setPnlhandler(tradeManager.address)).wait();
  await (await tBLPToken.setPnlhandler(tradeManager.address)).wait();
  await (await usdb.setVault(tradeManager.address)).wait();
  await (await periphery.nonfungiblePositionManager.rely(tradeManager.address)).wait();
  await (await periphery.swapRouter.setVault(tradeManager.address)).wait();

  const feeAdapterFactory = await ethers.getContractFactory("FeeAdapterTransparent", deployer);
  const feeAdapter = await upgrades.deployProxy(feeAdapterFactory, [tradeManager.address], {
    initializer: "initialize",
    kind: "transparent",
  });
  await feeAdapter.deployed();

  const dynamicFeeManager = await (await ethers.getContractFactory("DynamicFeeManager", deployer)).deploy(
    DEFAULT_DYNAMIC_FEE_PARAMS.filterPeriod,
    DEFAULT_DYNAMIC_FEE_PARAMS.decayPeriod,
    DEFAULT_DYNAMIC_FEE_PARAMS.reductionFactor,
    DEFAULT_DYNAMIC_FEE_PARAMS.maxAccumulator,
    DEFAULT_DYNAMIC_FEE_PARAMS.variableFeeControl,
    DEFAULT_DYNAMIC_FEE_PARAMS.baseFeeUnit,
    tradeManager.address
  );
  await dynamicFeeManager.deployed();

  await (await tradeManager.setFeeAdapter(feeAdapter.address)).wait();
  await (await tradeManager.setFeeManager(dynamicFeeManager.address)).wait();

  return {
    wrapped1155Factory,
    ctf,
    usdc,
    usdb,
    tBLP,
    sBLP,
    sBLPToken,
    tBLPToken,
    tradeManager,
    feeAdapter,
    dynamicFeeManager,
  };
}

async function deployCleanFixture(options = {}) {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  const wnative = options.wnative || process.env.WNATIVE || DEFAULT_WNATIVE_BY_CHAIN[chainId];

  if (!wnative) {
    throw new Error(`WNATIVE is not configured for chainId=${chainId}`);
  }

  const core = await deployCore(deployer);
  const periphery = await deployPeriphery(deployer, core, wnative);
  const business = await deployBusinessLayer(deployer, core, periphery);

  return {
    deployer,
    chainId,
    wnative,
    params: {
      dynamicFee: { ...DEFAULT_DYNAMIC_FEE_PARAMS },
    },
    core,
    periphery,
    business,
  };
}

module.exports = {
  deployCleanFixture,
  assertEqAddress,
};

