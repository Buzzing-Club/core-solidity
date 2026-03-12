const hre = require("hardhat");
const { ethers, upgrades } = hre;
const { ContractFactory, constants } = require("ethers");
const fs = require("fs");
const path = require("path");

const ZERO_ADDRESS = constants.AddressZero;
const DEFAULT_WNATIVE_BY_CHAIN = {
  84532: "0x4200000000000000000000000000000000000006",
  31337: "0x4200000000000000000000000000000000000006",
};

const DYNAMIC_FEE_DEFAULTS = {
  filterPeriod: 600,
  decayPeriod: 3600,
  reductionFactor: ethers.utils.parseUnits("0.9", 18),
  maxAccumulator: "1000000000000",
  variableFeeControl: 0,
  baseFeeUnit: 0,
};

const INIT_DEFAULTS = {
  usdcMintToSigner: "10000000", // 10,000,000 USDC
  usdbPrefundToTradeManager: "500000", // 500,000 USDB
  lpDepositTBLP: "50000", // 50,000 USDB
  lpDepositSBLP: "50000", // 50,000 USDB
  usdcMintToTradeManagerForYield: "1000000", // 1,000,000 USDC
  usdcDepositIntoYield: "100000", // 100,000 USDC
};
const PRETRADING_DEFAULTS = {
  thresholdRaw: "1000000000", // 1000 USDC with 6 decimals
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
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
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

async function getOrDeployContract(state, key, provider, deployFn) {
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
  logStep(`contract.${key}`, `saved ${deployed}`);
  return deployed;
}

async function main() {
  const [defaultSigner] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  const networkName = hre.network.name;

  const deployDir = path.join(__dirname, "state");
  ensureDir(deployDir);
  const statePath = path.join(deployDir, `${networkName}.resume-buzzing.json`);

  if (process.env.RESET_DEPLOY_STATE === "1" && fs.existsSync(statePath)) {
    fs.unlinkSync(statePath);
  }

  const state = loadState(statePath);
  logCheck("state.load", fs.existsSync(statePath) ? `loaded ${statePath}` : `new state ${statePath}`);
  state.meta = {
    networkName,
    chainId,
    deployer: defaultSigner.address,
  };
  saveState(statePath, state);

  const signer = defaultSigner;
  const wnative = process.env.WNATIVE || DEFAULT_WNATIVE_BY_CHAIN[chainId];
  if (!wnative) {
    throw new Error(`WNATIVE is not configured for chainId=${chainId}. Set env WNATIVE.`);
  }

  console.log(`network:  ${networkName} (${chainId})`);
  console.log(`deployer: ${signer.address}`);
  console.log(`state:    ${statePath}`);

  const coreArtifacts = {
    BuzzingSwapPoolDeployer: require("@pancakeswap/v3-core/artifacts/contracts/BuzzingSwapPoolDeployer.sol/BuzzingSwapPoolDeployer.json"),
    BuzzingSwapFactory: require("@pancakeswap/v3-core/artifacts/contracts/BuzzingSwapFactory.sol/BuzzingSwapFactory.json"),
  };

  const poolDeployerAddress = await getOrDeployContract(state, "buzzingSwapPoolDeployer", ethers.provider, async () => {
    const factory = new ContractFactory(
      coreArtifacts.BuzzingSwapPoolDeployer.abi,
      coreArtifacts.BuzzingSwapPoolDeployer.bytecode,
      signer
    );
    const c = await factory.deploy();
    await c.deployed();
    console.log("deployed buzzingSwapPoolDeployer:", c.address);
    saveState(statePath, state);
    return c.address;
  });
  saveState(statePath, state);

  const factoryAddress = await getOrDeployContract(state, "buzzingSwapFactory", ethers.provider, async () => {
    const factory = new ContractFactory(
      coreArtifacts.BuzzingSwapFactory.abi,
      coreArtifacts.BuzzingSwapFactory.bytecode,
      signer
    );
    const c = await factory.deploy(poolDeployerAddress);
    await c.deployed();
    console.log("deployed buzzingSwapFactory:", c.address);
    saveState(statePath, state);
    return c.address;
  });
  saveState(statePath, state);

  {
    const poolDeployer = new ethers.Contract(poolDeployerAddress, coreArtifacts.BuzzingSwapPoolDeployer.abi, signer);
    const linkedFactory = await poolDeployer.factoryAddress();
    logCheck("core.factoryLink", `poolDeployer.factoryAddress=${linkedFactory}`);
    if (!sameAddress(linkedFactory, factoryAddress)) {
      if (linkedFactory === ZERO_ADDRESS) {
        await (await poolDeployer.setFactoryAddress(factoryAddress)).wait();
        logStep("core.factoryLink", `setFactoryAddress(${factoryAddress}) done`);
      } else {
        throw new Error(`factoryAddress already set to ${linkedFactory}, expected ${factoryAddress}`);
      }
    } else {
      logCheck("core.factoryLink", "already linked");
    }
  }

  const swapRouterAddress = await getOrDeployContract(state, "swapRouter", ethers.provider, async () => {
    const c = await (await ethers.getContractFactory("SwapRouter", signer)).deploy(poolDeployerAddress, factoryAddress, wnative);
    await c.deployed();
    console.log("deployed swapRouter:", c.address);
    return c.address;
  });
  saveState(statePath, state);

  const descriptorAddress = await getOrDeployContract(state, "positionDescriptor", ethers.provider, async () => {
    const c = await (await ethers.getContractFactory("NonfungibleTokenPositionDescriptorOffChain", signer)).deploy();
    await c.deployed();
    await (await c.initialize("")).wait();
    console.log("deployed positionDescriptor:", c.address);
    return c.address;
  });
  saveState(statePath, state);

  const npmAddress = await getOrDeployContract(state, "nonfungiblePositionManager", ethers.provider, async () => {
    const c = await (await ethers.getContractFactory("NonfungiblePositionManager", signer)).deploy(
      poolDeployerAddress,
      factoryAddress,
      wnative,
      descriptorAddress
    );
    await c.deployed();
    console.log("deployed nonfungiblePositionManager:", c.address);
    return c.address;
  });
  saveState(statePath, state);

  const multicallAddress = await getOrDeployContract(state, "buzzingInterfaceMulticall", ethers.provider, async () => {
    const c = await (await ethers.getContractFactory("BuzzingInterfaceMulticall", signer)).deploy();
    await c.deployed();
    console.log("deployed buzzingInterfaceMulticall:", c.address);
    return c.address;
  });
  const v3MigratorAddress = await getOrDeployContract(state, "v3Migrator", ethers.provider, async () => {
    const c = await (await ethers.getContractFactory("V3Migrator", signer)).deploy(
      poolDeployerAddress,
      factoryAddress,
      wnative,
      npmAddress
    );
    await c.deployed();
    console.log("deployed v3Migrator:", c.address);
    return c.address;
  });
  const tickLensAddress = await getOrDeployContract(state, "tickLens", ethers.provider, async () => {
    const c = await (await ethers.getContractFactory("TickLens", signer)).deploy();
    await c.deployed();
    console.log("deployed tickLens:", c.address);
    return c.address;
  });
  const quoterV2Address = await getOrDeployContract(state, "quoterV2", ethers.provider, async () => {
    const c = await (await ethers.getContractFactory("QuoterV2", signer)).deploy(poolDeployerAddress, factoryAddress, wnative);
    await c.deployed();
    console.log("deployed quoterV2:", c.address);
    return c.address;
  });
  saveState(statePath, state);

  const wrapped1155FactoryAddress = await getOrDeployContract(state, "wrapped1155Factory", ethers.provider, async () => {
    const c = await (await ethers.getContractFactory("contracts/Wrapped1155Factory.sol:Wrapped1155Factory", signer)).deploy();
    await c.deployed();
    console.log("deployed wrapped1155Factory:", c.address);
    return c.address;
  });
  const ctfAddress = await getOrDeployContract(state, "ctf", ethers.provider, async () => {
    const c = await (await ethers.getContractFactory("ConditionalTokens", signer)).deploy();
    await c.deployed();
    console.log("deployed ctf:", c.address);
    return c.address;
  });
  const usdcAddress = await getOrDeployContract(state, "USDC", ethers.provider, async () => {
    const c = await (await ethers.getContractFactory("USDC", signer)).deploy();
    await c.deployed();
    console.log("deployed USDC:", c.address);
    return c.address;
  });
  const usdbAddress = await getOrDeployContract(state, "USDB", ethers.provider, async () => {
    const c = await (await ethers.getContractFactory("USDB", signer)).deploy(usdcAddress);
    await c.deployed();
    console.log("deployed USDB:", c.address);
    return c.address;
  });
  saveState(statePath, state);

  const tBLPAddress = await getOrDeployContract(state, "tBLPProxy", ethers.provider, async () => {
    const factory = await ethers.getContractFactory("tBLP", signer);
    const proxy = await upgrades.deployProxy(factory, [usdbAddress], { initializer: "initialize", kind: "transparent" });
    await proxy.deployed();
    console.log("deployed tBLPProxy:", proxy.address);
    return proxy.address;
  });
  const sBLPAddress = await getOrDeployContract(state, "sBLPProxy", ethers.provider, async () => {
    const factory = await ethers.getContractFactory("sBLP", signer);
    const proxy = await upgrades.deployProxy(factory, [usdbAddress], { initializer: "initialize", kind: "transparent" });
    await proxy.deployed();
    console.log("deployed sBLPProxy:", proxy.address);
    return proxy.address;
  });
  saveState(statePath, state);

  const tradeManagerAddress = await getOrDeployContract(state, "tradeManagerProxy", ethers.provider, async () => {
    const factory = await ethers.getContractFactory("tradeManager", signer);
    const proxy = await upgrades.deployProxy(
      factory,
      [
        usdbAddress,
        usdcAddress,
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
    console.log("deployed tradeManager:", proxy.address);
    return proxy.address;
  });
  saveState(statePath, state);

  const sBLP = (await ethers.getContractFactory("sBLP", signer)).attach(sBLPAddress);
  const tBLP = (await ethers.getContractFactory("tBLP", signer)).attach(tBLPAddress);
  const usdb = (await ethers.getContractFactory("USDB", signer)).attach(usdbAddress);
  const npm = (await ethers.getContractFactory("NonfungiblePositionManager", signer)).attach(npmAddress);
  const swapRouter = (await ethers.getContractFactory("SwapRouter", signer)).attach(swapRouterAddress);
  const tradeManager = (await ethers.getContractFactory("tradeManager", signer)).attach(tradeManagerAddress);

  if (!sameAddress(await sBLP.pnlHandler(), tradeManagerAddress)) {
    await (await sBLP.setPnlhandler(tradeManagerAddress)).wait();
    logStep("config.sBLP.pnlHandler", "updated");
  } else {
    logCheck("config.sBLP.pnlHandler", "already set");
  }
  if (!sameAddress(await tBLP.pnlHandler(), tradeManagerAddress)) {
    await (await tBLP.setPnlhandler(tradeManagerAddress)).wait();
    logStep("config.tBLP.pnlHandler", "updated");
  } else {
    logCheck("config.tBLP.pnlHandler", "already set");
  }
  if (!sameAddress(await usdb.vault(), tradeManagerAddress)) {
    await (await usdb.setVault(tradeManagerAddress)).wait();
    logStep("config.USDB.vault", "updated");
  } else {
    logCheck("config.USDB.vault", "already set");
  }
  {
    const ward = await npm.wards(tradeManagerAddress);
    logCheck("config.NPM.rely", `ward=${ward.toString()}`);
    if (ward.toString() !== "1") {
      await (await npm.rely(tradeManagerAddress)).wait();
      logStep("config.NPM.rely", "updated");
    } else {
      logCheck("config.NPM.rely", "already set");
    }
  }
  if (!sameAddress(await swapRouter.vaultaddress(), tradeManagerAddress)) {
    await (await swapRouter.setVault(tradeManagerAddress)).wait();
    logStep("config.swapRouter.vault", "updated");
  } else {
    logCheck("config.swapRouter.vault", "already set");
  }

  const feeAdapterAddress = await getOrDeployContract(state, "feeAdapterProxy", ethers.provider, async () => {
    const factory = await ethers.getContractFactory("FeeAdapterTransparent", signer);
    const proxy = await upgrades.deployProxy(factory, [tradeManagerAddress], {
      initializer: "initialize",
      kind: "transparent",
    });
    await proxy.deployed();
    console.log("deployed feeAdapter:", proxy.address);
    return proxy.address;
  });
  const dynamicFeeManagerAddress = await getOrDeployContract(state, "dynamicFeeManager", ethers.provider, async () => {
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
    console.log("deployed dynamicFeeManager:", c.address);
    return c.address;
  });
  saveState(statePath, state);

  const feeRebateDistributorAddress = await getOrDeployContract(
    state,
    "feeRebateDistributor",
    ethers.provider,
    async () => {
      const c = await (await ethers.getContractFactory("FeeRebateDistributor", signer)).deploy(feeAdapterAddress);
      await c.deployed();
      console.log("deployed feeRebateDistributor:", c.address);
      return c.address;
    }
  );
  saveState(statePath, state);

  if (!sameAddress(await tradeManager.feeAdapter(), feeAdapterAddress)) {
    await (await tradeManager.setFeeAdapter(feeAdapterAddress)).wait();
    logStep("config.tradeManager.feeAdapter", "updated");
  } else {
    logCheck("config.tradeManager.feeAdapter", "already set");
  }

  if (!sameAddress(await tradeManager.feeManager(), dynamicFeeManagerAddress)) {
    await (await tradeManager.setFeeManager(dynamicFeeManagerAddress)).wait();
    logStep("config.tradeManager.feeManager", "updated");
  } else {
    logCheck("config.tradeManager.feeManager", "already set");
  }

  // ---------- Additional business contracts ----------
  const contractFactoryAddress = await getOrDeployContract(state, "contractFactory", ethers.provider, async () => {
    const c = await (await ethers.getContractFactory("ContractFactory", signer)).deploy(usdbAddress, usdcAddress);
    await c.deployed();
    console.log("deployed contractFactory:", c.address);
    return c.address;
  });
  const preTradingThresholdRaw = ethers.BigNumber.from(
    process.env.PRETRADING_THRESHOLD_RAW || PRETRADING_DEFAULTS.thresholdRaw
  );
  const preTradingAddress = await getOrDeployContract(state, "preTrading", ethers.provider, async () => {
    const c = await (await ethers.getContractFactory("PreTrading", signer)).deploy(
      usdbAddress,
      signer.address,
      preTradingThresholdRaw
    );
    await c.deployed();
    console.log("deployed preTrading:", c.address);
    return c.address;
  });
  state.meta.preTradingThresholdRaw = preTradingThresholdRaw.toString();
  saveState(statePath, state);

  // ---------- Optional initial state bootstrap (idempotent + resumable) ----------
  const usdc = (await ethers.getContractFactory("USDC", signer)).attach(usdcAddress);

  const usdcMintToSigner = parse6Amount("INIT_USDC_MINT_TO_SIGNER", INIT_DEFAULTS.usdcMintToSigner);
  const usdbPrefundToTradeManager = parse6Amount("INIT_USDB_PREFUND_TO_TRADEMANAGER", INIT_DEFAULTS.usdbPrefundToTradeManager);
  const lpDepositTBLP = parse6Amount("INIT_LP_DEPOSIT_TBLP", INIT_DEFAULTS.lpDepositTBLP);
  const lpDepositSBLP = parse6Amount("INIT_LP_DEPOSIT_SBLP", INIT_DEFAULTS.lpDepositSBLP);
  const usdcMintToTradeManagerForYield = parse6Amount(
    "INIT_USDC_MINT_TO_TRADEMANAGER_FOR_YIELD",
    INIT_DEFAULTS.usdcMintToTradeManagerForYield
  );
  const usdcDepositIntoYield = parse6Amount("INIT_USDC_DEPOSIT_INTO_YIELD", INIT_DEFAULTS.usdcDepositIntoYield);

  // Step A: ensure signer has enough USDC to mint USDB for prefund + LP deposits.
  const signerUsdcNeeded = usdbPrefundToTradeManager.add(lpDepositTBLP).add(lpDepositSBLP);
  const signerUsdcBal = await usdc.balanceOf(signer.address);
  if (signerUsdcBal.lt(signerUsdcNeeded)) {
    await (await usdc.mint(signer.address, usdcMintToSigner)).wait();
    console.log("minted USDC to signer for initial bootstrap");
  }

  // Step B: mint USDB to signer via deposit flow.
  const signerUsdbNeeded = usdbPrefundToTradeManager.add(lpDepositTBLP).add(lpDepositSBLP);
  const signerUsdbBal = await usdb.balanceOf(signer.address);
  if (signerUsdbBal.lt(signerUsdbNeeded)) {
    const toDeposit = signerUsdbNeeded.sub(signerUsdbBal);
    await (await usdc.approve(usdbAddress, toDeposit)).wait();
    await (await usdb.deposit(signer.address, toDeposit)).wait();
    console.log(`deposited USDC->USDB for signer: ${toDeposit.toString()}`);
  }

  // Step C: prefund tradeManager with USDB.
  logCheck("flag.usdbPrefundDone", String(!!state.flags.usdbPrefundDone));
  if (!state.flags.usdbPrefundDone) {
    const tmUsdbBal = await usdb.balanceOf(tradeManagerAddress);
    logCheck("balance.tradeManager.USDB", tmUsdbBal.toString());
    if (tmUsdbBal.lt(usdbPrefundToTradeManager)) {
      const delta = usdbPrefundToTradeManager.sub(tmUsdbBal);
      await (await usdb.transfer(tradeManagerAddress, delta)).wait();
      logStep("bootstrap.USDB.prefund", `transferred ${delta.toString()}`);
    }
    state.flags.usdbPrefundDone = true;
    saveState(statePath, state);
  } else {
    logCheck("bootstrap.USDB.prefund", "skipped by flag");
  }

  // Step D: LP deposits to tBLP/sBLP through tradeManager.
  logCheck("flag.lpBootstrapDone", String(!!state.flags.lpBootstrapDone));
  if (!state.flags.lpBootstrapDone) {
    const totalLpNeed = lpDepositTBLP.add(lpDepositSBLP);
    await (await usdb.approve(tradeManagerAddress, totalLpNeed)).wait();
    if (lpDepositTBLP.gt(0)) {
      await (await tradeManager.LPDeposit(lpDepositTBLP, signer.address, true)).wait();
    }
    if (lpDepositSBLP.gt(0)) {
      await (await tradeManager.LPDeposit(lpDepositSBLP, signer.address, false)).wait();
    }
    logStep("bootstrap.LP", "done (tBLP/sBLP)");
    state.flags.lpBootstrapDone = true;
    saveState(statePath, state);
  } else {
    logCheck("bootstrap.LP", "skipped by flag");
  }

  // Step E: deploy and wire SUsds.
  const sUsdsAddress = await getOrDeployContract(state, "sUsds", ethers.provider, async () => {
    const c = await (await ethers.getContractFactory("SUsds", signer)).deploy(usdcAddress);
    await c.deployed();
    console.log("deployed sUsds:", c.address);
    return c.address;
  });
  if (!sameAddress(await tradeManager.yieldProtocol(), sUsdsAddress)) {
    await (await tradeManager.setYieldProtocol(sUsdsAddress)).wait();
    logStep("config.tradeManager.yieldProtocol", "updated");
  } else {
    logCheck("config.tradeManager.yieldProtocol", "already set");
  }

  // Step F: mint USDC to tradeManager and deposit to yield.
  logCheck("flag.yieldBootstrapDone", String(!!state.flags.yieldBootstrapDone));
  if (!state.flags.yieldBootstrapDone) {
    const tmUsdcBal = await usdc.balanceOf(tradeManagerAddress);
    logCheck("balance.tradeManager.USDC", tmUsdcBal.toString());
    if (tmUsdcBal.lt(usdcDepositIntoYield)) {
      const mintDelta = usdcMintToTradeManagerForYield.gt(usdcDepositIntoYield.sub(tmUsdcBal))
        ? usdcMintToTradeManagerForYield
        : usdcDepositIntoYield.sub(tmUsdcBal);
      await (await usdc.mint(tradeManagerAddress, mintDelta)).wait();
      logStep("bootstrap.yield.mintUSDC", mintDelta.toString());
    }
    await (await tradeManager.USDCdeposit(usdcDepositIntoYield)).wait();
    logStep("bootstrap.yield.USDCdeposit", usdcDepositIntoYield.toString());
    state.flags.yieldBootstrapDone = true;
    saveState(statePath, state);
  } else {
    logCheck("bootstrap.yield", "skipped by flag");
  }

  saveState(statePath, state);

  console.log("Resume deploy finished (up to setFeeManager + initial bootstrap).");
  console.log("Contracts:");
  Object.entries(state.contracts).forEach(([k, v]) => console.log(`${k}: ${v}`));
  console.log(`preTradingThresholdRaw: ${state.meta.preTradingThresholdRaw}`);
}

main().catch((error) => {
  console.error("resumeBuzzingDeploy failed:", error);
  process.exitCode = 1;
});
