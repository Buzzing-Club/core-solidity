const hre = require("hardhat");
const { ethers, upgrades } = hre;
const { ContractFactory, constants } = require("ethers");
const fs = require("fs");
const path = require("path");

const ZERO_ADDRESS = constants.AddressZero;
const BASE_MAINNET_CHAIN_ID = 8453;
const BASE_MAINNET_WNATIVE = "0x4200000000000000000000000000000000000006";

// User-provided external addresses on Base mainnet.
const EXTERNAL_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const EXTERNAL_SUSDC = "0x3128a0f7f0ea68e7b7c9b00afa7e41045828e858";

const DYNAMIC_FEE_DEFAULTS = {
  filterPeriod: 600,
  decayPeriod: 3600,
  reductionFactor: ethers.utils.parseUnits("0.9", 18),
  maxAccumulator: "1000000000000",
  variableFeeControl: 0,
  baseFeeUnit: 0,
};

const PREFUND_DEFAULTS = {
  usdbPrefundToTradeManager: "500000", // 500,000 USDB
  lpDepositTBLP: "50000", // 50,000 USDB
  lpDepositSBLP: "50000", // 50,000 USDB
  usdcDepositIntoYield: "100000", // 100,000 USDC
};

const PRETRADING_DEFAULTS = {
  thresholdRaw: "1000000000", // 1000 USDB with 6 decimals
};

function lower(addr) {
  return addr.toLowerCase();
}

function sameAddress(a, b) {
  return lower(a) === lower(b);
}

function existsCode(code) {
  return code && code !== "0x";
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function hasContractCode(provider, addr) {
  if (!addr || addr === ZERO_ADDRESS) return false;
  const code = await provider.getCode(addr);
  return existsCode(code);
}

function loadState(statePath) {
  if (!fs.existsSync(statePath)) {
    return {
      version: 1,
      contracts: {},
      flags: {},
      pending: {},
      meta: {},
    };
  }
  return JSON.parse(fs.readFileSync(statePath, "utf8"));
}

function saveState(statePath, state) {
  const next = { ...state, updatedAt: new Date().toISOString() };
  fs.writeFileSync(statePath, JSON.stringify(next, null, 2), "utf8");
}

function logCheck(name, detail) {
  console.log(`[CHECK] ${name} -> ${detail}`);
}

function logStep(name, detail) {
  console.log(`[STEP] ${name} -> ${detail}`);
}

function parse6Amount(envKey, fallback) {
  const raw = process.env[envKey] || fallback;
  return ethers.utils.parseUnits(String(raw), 6);
}

function setPending(state, key, payload) {
  state.pending = state.pending || {};
  state.pending[key] = {
    ...payload,
    updatedAt: new Date().toISOString(),
  };
}

function clearPending(state, key) {
  if (state.pending && state.pending[key]) delete state.pending[key];
}

async function getOrDeployContract(state, statePath, key, provider, deployFn) {
  const existing = state.contracts[key];
  if (existing && (await hasContractCode(provider, existing))) {
    logCheck(`contract.${key}`, `reuse ${existing}`);
    return existing;
  }
  if (existing) {
    logCheck(`contract.${key}`, `state had ${existing}, but code missing; redeploy`);
  } else {
    logCheck(`contract.${key}`, "not found in state; deploy");
  }
  const deployed = await deployFn();
  state.contracts[key] = deployed;
  saveState(statePath, state);
  logStep(`contract.${key}`, `saved ${deployed}`);
  return deployed;
}

async function main() {
  const [signer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  const networkName = hre.network.name;

  if (chainId !== BASE_MAINNET_CHAIN_ID) {
    throw new Error(`This script is for Base mainnet only. Expected chainId=8453, got ${chainId}`);
  }

  const deployDir = path.join(__dirname, "state");
  ensureDir(deployDir);
  const statePath = path.join(deployDir, `${networkName}.resume-buzzing.base-mainnet.json`);

  if (process.env.RESET_DEPLOY_STATE === "1" && fs.existsSync(statePath)) {
    fs.unlinkSync(statePath);
  }

  const state = loadState(statePath);
  state.meta = {
    networkName,
    chainId,
    deployer: signer.address,
    externalUSDC: EXTERNAL_USDC,
    externalSUSDC: EXTERNAL_SUSDC,
  };
  saveState(statePath, state);

  console.log(`network:  ${networkName} (${chainId})`);
  console.log(`deployer: ${signer.address}`);
  console.log(`state:    ${statePath}`);

  if (!(await hasContractCode(ethers.provider, EXTERNAL_USDC))) {
    throw new Error(`External USDC has no code: ${EXTERNAL_USDC}`);
  }
  if (!(await hasContractCode(ethers.provider, EXTERNAL_SUSDC))) {
    throw new Error(`External sUSDC has no code: ${EXTERNAL_SUSDC}`);
  }

  // ---------- Core ----------
  const coreArtifacts = {
    BuzzingSwapPoolDeployer: require("@pancakeswap/v3-core/artifacts/contracts/BuzzingSwapPoolDeployer.sol/BuzzingSwapPoolDeployer.json"),
    BuzzingSwapFactory: require("@pancakeswap/v3-core/artifacts/contracts/BuzzingSwapFactory.sol/BuzzingSwapFactory.json"),
  };

  const poolDeployerAddress = await getOrDeployContract(state, statePath, "buzzingSwapPoolDeployer", ethers.provider, async () => {
    const f = new ContractFactory(
      coreArtifacts.BuzzingSwapPoolDeployer.abi,
      coreArtifacts.BuzzingSwapPoolDeployer.bytecode,
      signer
    );
    const c = await f.deploy();
    await c.deployed();
    return c.address;
  });

  const factoryAddress = await getOrDeployContract(state, statePath, "buzzingSwapFactory", ethers.provider, async () => {
    const f = new ContractFactory(
      coreArtifacts.BuzzingSwapFactory.abi,
      coreArtifacts.BuzzingSwapFactory.bytecode,
      signer
    );
    const c = await f.deploy(poolDeployerAddress);
    await c.deployed();
    return c.address;
  });

  {
    const poolDeployer = new ethers.Contract(poolDeployerAddress, coreArtifacts.BuzzingSwapPoolDeployer.abi, signer);
    const linkedFactory = await poolDeployer.factoryAddress();
    if (!sameAddress(linkedFactory, factoryAddress)) {
      if (linkedFactory === ZERO_ADDRESS) {
        await (await poolDeployer.setFactoryAddress(factoryAddress)).wait();
        logStep("core.factoryLink", `setFactoryAddress(${factoryAddress})`);
      } else {
        throw new Error(`factoryAddress already set to ${linkedFactory}, expected ${factoryAddress}`);
      }
    }
  }

  // ---------- Periphery ----------
  const swapRouterAddress = await getOrDeployContract(state, statePath, "swapRouter", ethers.provider, async () => {
    const c = await (await ethers.getContractFactory("SwapRouter", signer)).deploy(
      poolDeployerAddress,
      factoryAddress,
      BASE_MAINNET_WNATIVE
    );
    await c.deployed();
    return c.address;
  });

  const descriptorAddress = await getOrDeployContract(state, statePath, "positionDescriptor", ethers.provider, async () => {
    const c = await (await ethers.getContractFactory("NonfungibleTokenPositionDescriptorOffChain", signer)).deploy();
    await c.deployed();
    await (await c.initialize("")).wait();
    return c.address;
  });

  const npmAddress = await getOrDeployContract(state, statePath, "nonfungiblePositionManager", ethers.provider, async () => {
    const c = await (await ethers.getContractFactory("NonfungiblePositionManager", signer)).deploy(
      poolDeployerAddress,
      factoryAddress,
      BASE_MAINNET_WNATIVE,
      descriptorAddress
    );
    await c.deployed();
    return c.address;
  });

  await getOrDeployContract(state, statePath, "buzzingInterfaceMulticall", ethers.provider, async () => {
    const c = await (await ethers.getContractFactory("BuzzingInterfaceMulticall", signer)).deploy();
    await c.deployed();
    return c.address;
  });
  await getOrDeployContract(state, statePath, "v3Migrator", ethers.provider, async () => {
    const c = await (await ethers.getContractFactory("V3Migrator", signer)).deploy(
      poolDeployerAddress,
      factoryAddress,
      BASE_MAINNET_WNATIVE,
      npmAddress
    );
    await c.deployed();
    return c.address;
  });
  await getOrDeployContract(state, statePath, "tickLens", ethers.provider, async () => {
    const c = await (await ethers.getContractFactory("TickLens", signer)).deploy();
    await c.deployed();
    return c.address;
  });
  await getOrDeployContract(state, statePath, "quoterV2", ethers.provider, async () => {
    const c = await (await ethers.getContractFactory("QuoterV2", signer)).deploy(
      poolDeployerAddress,
      factoryAddress,
      BASE_MAINNET_WNATIVE
    );
    await c.deployed();
    return c.address;
  });

  // ---------- Business ----------
  const wrapped1155FactoryAddress = await getOrDeployContract(state, statePath, "wrapped1155Factory", ethers.provider, async () => {
    const c = await (await ethers.getContractFactory("contracts/Wrapped1155Factory.sol:Wrapped1155Factory", signer)).deploy();
    await c.deployed();
    return c.address;
  });
  const ctfAddress = await getOrDeployContract(state, statePath, "ctf", ethers.provider, async () => {
    const c = await (await ethers.getContractFactory("ConditionalTokens", signer)).deploy();
    await c.deployed();
    return c.address;
  });

  // Reuse external USDC; do NOT deploy USDC.
  state.contracts.USDC = EXTERNAL_USDC;
  saveState(statePath, state);

  const usdbAddress = await getOrDeployContract(state, statePath, "USDB", ethers.provider, async () => {
    const c = await (await ethers.getContractFactory("USDB", signer)).deploy(EXTERNAL_USDC);
    await c.deployed();
    return c.address;
  });

  const tBLPAddress = await getOrDeployContract(state, statePath, "tBLPProxy", ethers.provider, async () => {
    const factory = await ethers.getContractFactory("tBLP", signer);
    const proxy = await upgrades.deployProxy(factory, [usdbAddress], { initializer: "initialize", kind: "transparent" });
    await proxy.deployed();
    return proxy.address;
  });
  const sBLPAddress = await getOrDeployContract(state, statePath, "sBLPProxy", ethers.provider, async () => {
    const factory = await ethers.getContractFactory("sBLP", signer);
    const proxy = await upgrades.deployProxy(factory, [usdbAddress], { initializer: "initialize", kind: "transparent" });
    await proxy.deployed();
    return proxy.address;
  });

  const tradeManagerAddress = await getOrDeployContract(state, statePath, "tradeManagerProxy", ethers.provider, async () => {
    const factory = await ethers.getContractFactory("tradeManager", signer);
    const proxy = await upgrades.deployProxy(
      factory,
      [
        usdbAddress,
        EXTERNAL_USDC,
        npmAddress,
        ctfAddress,
        swapRouterAddress,
        tBLPAddress,
        sBLPAddress,
        wrapped1155FactoryAddress,
        poolDeployerAddress,
      ],
      { initializer: "initialize", kind: "transparent" }
    );
    await proxy.deployed();
    return proxy.address;
  });

  // ---------- Wiring ----------
  const sBLP = (await ethers.getContractFactory("sBLP", signer)).attach(sBLPAddress);
  const tBLP = (await ethers.getContractFactory("tBLP", signer)).attach(tBLPAddress);
  const usdb = (await ethers.getContractFactory("USDB", signer)).attach(usdbAddress);
  const npm = (await ethers.getContractFactory("NonfungiblePositionManager", signer)).attach(npmAddress);
  const swapRouter = (await ethers.getContractFactory("SwapRouter", signer)).attach(swapRouterAddress);
  const tradeManager = (await ethers.getContractFactory("tradeManager", signer)).attach(tradeManagerAddress);

  if (!sameAddress(await sBLP.pnlHandler(), tradeManagerAddress)) await (await sBLP.setPnlhandler(tradeManagerAddress)).wait();
  if (!sameAddress(await tBLP.pnlHandler(), tradeManagerAddress)) await (await tBLP.setPnlhandler(tradeManagerAddress)).wait();
  if (!sameAddress(await usdb.vault(), tradeManagerAddress)) await (await usdb.setVault(tradeManagerAddress)).wait();
  {
    const ward = await npm.wards(tradeManagerAddress);
    if (ward.toString() !== "1") await (await npm.rely(tradeManagerAddress)).wait();
  }
  if (!sameAddress(await swapRouter.vaultaddress(), tradeManagerAddress)) await (await swapRouter.setVault(tradeManagerAddress)).wait();

  const feeAdapterAddress = await getOrDeployContract(state, statePath, "feeAdapterProxy", ethers.provider, async () => {
    const factory = await ethers.getContractFactory("FeeAdapterTransparent", signer);
    const proxy = await upgrades.deployProxy(factory, [tradeManagerAddress], {
      initializer: "initialize",
      kind: "transparent",
    });
    await proxy.deployed();
    return proxy.address;
  });
  const dynamicFeeManagerAddress = await getOrDeployContract(state, statePath, "dynamicFeeManager", ethers.provider, async () => {
    const c = await (await ethers.getContractFactory("DynamicFeeManager", signer)).deploy(
      DYNAMIC_FEE_DEFAULTS.filterPeriod,
      DYNAMIC_FEE_DEFAULTS.decayPeriod,
      DYNAMIC_FEE_DEFAULTS.reductionFactor,
      DYNAMIC_FEE_DEFAULTS.maxAccumulator,
      DYNAMIC_FEE_DEFAULTS.variableFeeControl,
      DYNAMIC_FEE_DEFAULTS.baseFeeUnit,
      tradeManagerAddress
    );
    await c.deployed();
    return c.address;
  });

  await getOrDeployContract(state, statePath, "feeRebateDistributor", ethers.provider, async () => {
    const c = await (await ethers.getContractFactory("FeeRebateDistributor", signer)).deploy(feeAdapterAddress);
    await c.deployed();
    return c.address;
  });

  if (!sameAddress(await tradeManager.feeAdapter(), feeAdapterAddress)) await (await tradeManager.setFeeAdapter(feeAdapterAddress)).wait();
  if (!sameAddress(await tradeManager.feeManager(), dynamicFeeManagerAddress)) await (await tradeManager.setFeeManager(dynamicFeeManagerAddress)).wait();

  const contractFactoryAddress = await getOrDeployContract(state, statePath, "contractFactory", ethers.provider, async () => {
    const c = await (await ethers.getContractFactory("ContractFactory", signer)).deploy(usdbAddress, EXTERNAL_USDC);
    await c.deployed();
    return c.address;
  });
  const preTradingThresholdRaw = ethers.BigNumber.from(
    process.env.PRETRADING_THRESHOLD_RAW || PRETRADING_DEFAULTS.thresholdRaw
  );
  await getOrDeployContract(state, statePath, "preTrading", ethers.provider, async () => {
    const c = await (await ethers.getContractFactory("PreTrading", signer)).deploy(
      usdbAddress,
      signer.address,
      preTradingThresholdRaw
    );
    await c.deployed();
    return c.address;
  });
  state.meta.preTradingThresholdRaw = preTradingThresholdRaw.toString();

  // Reuse external sUSDC as yield protocol; do NOT deploy SUsds.
  state.contracts.sUsds = EXTERNAL_SUSDC;
  if (!sameAddress(await tradeManager.yieldProtocol(), EXTERNAL_SUSDC)) {
    await (await tradeManager.setYieldProtocol(EXTERNAL_SUSDC)).wait();
    logStep("config.tradeManager.yieldProtocol", `set to external sUSDC ${EXTERNAL_SUSDC}`);
  } else {
    logCheck("config.tradeManager.yieldProtocol", "already set to external sUSDC");
  }

  // ---------- Optional prefund/bootstrap ----------
  const enablePrefund = process.env.ENABLE_PREFUND === "1";
  state.meta.enablePrefund = enablePrefund;

  const usdbPrefundToTradeManager = parse6Amount("INIT_USDB_PREFUND_TO_TRADEMANAGER", PREFUND_DEFAULTS.usdbPrefundToTradeManager);
  const lpDepositTBLP = parse6Amount("INIT_LP_DEPOSIT_TBLP", PREFUND_DEFAULTS.lpDepositTBLP);
  const lpDepositSBLP = parse6Amount("INIT_LP_DEPOSIT_SBLP", PREFUND_DEFAULTS.lpDepositSBLP);
  const usdcDepositIntoYield = parse6Amount("INIT_USDC_DEPOSIT_INTO_YIELD", PREFUND_DEFAULTS.usdcDepositIntoYield);

  if (!enablePrefund) {
    setPending(state, "usdbPrefund", {
      status: "pending",
      reason: "ENABLE_PREFUND is not 1",
      requiredUSDB: usdbPrefundToTradeManager.toString(),
    });
    setPending(state, "lpBootstrap", {
      status: "pending",
      reason: "ENABLE_PREFUND is not 1",
      requiredUSDB: lpDepositTBLP.add(lpDepositSBLP).toString(),
    });
    setPending(state, "yieldBootstrap", {
      status: "pending",
      reason: "ENABLE_PREFUND is not 1",
      requiredUSDC: usdcDepositIntoYield.toString(),
      note: "tradeManager.USDCdeposit not executed",
    });
    state.flags.usdbPrefundDone = false;
    state.flags.lpBootstrapDone = false;
    state.flags.yieldBootstrapDone = false;
    logCheck("bootstrap", "skipped all prefund/yield steps; recorded pending state");
  } else {
    const usdc = await ethers.getContractAt(
      ["function balanceOf(address) view returns (uint256)", "function approve(address,uint256) returns (bool)"],
      EXTERNAL_USDC,
      signer
    );

    // A) Ensure signer has enough USDC to deposit into USDB for prefund + LP.
    const signerUsdcNeeded = usdbPrefundToTradeManager.add(lpDepositTBLP).add(lpDepositSBLP);
    const signerUsdcBal = await usdc.balanceOf(signer.address);
    if (signerUsdcBal.lt(signerUsdcNeeded)) {
      setPending(state, "usdbPrefund", {
        status: "pending",
        reason: "insufficient signer USDC",
        signerUsdcBal: signerUsdcBal.toString(),
        signerUsdcNeeded: signerUsdcNeeded.toString(),
      });
      setPending(state, "lpBootstrap", {
        status: "pending",
        reason: "insufficient signer USDC",
        signerUsdcBal: signerUsdcBal.toString(),
        signerUsdcNeeded: signerUsdcNeeded.toString(),
      });
    } else {
      const signerUsdbBal = await usdb.balanceOf(signer.address);
      const signerUsdbNeeded = signerUsdcNeeded;
      if (signerUsdbBal.lt(signerUsdbNeeded)) {
        const toDeposit = signerUsdbNeeded.sub(signerUsdbBal);
        await (await usdc.approve(usdbAddress, toDeposit)).wait();
        await (await usdb.deposit(signer.address, toDeposit)).wait();
      }

      const tmUsdbBal = await usdb.balanceOf(tradeManagerAddress);
      if (tmUsdbBal.lt(usdbPrefundToTradeManager)) {
        const delta = usdbPrefundToTradeManager.sub(tmUsdbBal);
        await (await usdb.transfer(tradeManagerAddress, delta)).wait();
      }
      state.flags.usdbPrefundDone = true;
      clearPending(state, "usdbPrefund");

      const totalLpNeed = lpDepositTBLP.add(lpDepositSBLP);
      await (await usdb.approve(tradeManagerAddress, totalLpNeed)).wait();
      if (lpDepositTBLP.gt(0)) await (await tradeManager.LPDeposit(lpDepositTBLP, signer.address, true)).wait();
      if (lpDepositSBLP.gt(0)) await (await tradeManager.LPDeposit(lpDepositSBLP, signer.address, false)).wait();
      state.flags.lpBootstrapDone = true;
      clearPending(state, "lpBootstrap");
    }

    // B) Yield bootstrap using external USDC only if tradeManager already funded.
    const tmUsdcBal = await usdc.balanceOf(tradeManagerAddress);
    if (tmUsdcBal.lt(usdcDepositIntoYield)) {
      setPending(state, "yieldBootstrap", {
        status: "pending",
        reason: "insufficient tradeManager USDC",
        tradeManagerUsdcBal: tmUsdcBal.toString(),
        requiredUSDC: usdcDepositIntoYield.toString(),
      });
      state.flags.yieldBootstrapDone = false;
    } else {
      await (await tradeManager.USDCdeposit(usdcDepositIntoYield)).wait();
      state.flags.yieldBootstrapDone = true;
      clearPending(state, "yieldBootstrap");
    }
  }

  saveState(statePath, state);

  console.log("Base mainnet resume deploy finished.");
  console.log("Contracts:");
  Object.entries(state.contracts).forEach(([k, v]) => console.log(`${k}: ${v}`));
  console.log("Flags:", state.flags);
  if (state.pending && Object.keys(state.pending).length > 0) {
    console.log("Pending tasks:");
    Object.entries(state.pending).forEach(([k, v]) => console.log(`- ${k}: ${JSON.stringify(v)}`));
  }
}

main().catch((error) => {
  console.error("resumeBuzzingDeploy.baseMainnet failed:", error);
  process.exitCode = 1;
});

