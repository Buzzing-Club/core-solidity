const hre = require("hardhat");
const { ethers, upgrades } = hre;
const fs = require("fs");
const path = require("path");

const BASE_MAINNET_CHAIN_ID = 8453;
const ZERO_ADDRESS = ethers.constants.AddressZero;

function lower(addr) {
  return String(addr).toLowerCase();
}

function sameAddress(a, b) {
  return lower(a) === lower(b);
}

function existsCode(code) {
  return code && code !== "0x";
}

async function hasContractCode(provider, addr) {
  if (!addr || addr === ZERO_ADDRESS) return false;
  const code = await provider.getCode(addr);
  return existsCode(code);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
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

function envBool(key, defaultValue = false) {
  const raw = process.env[key];
  if (raw == null || raw === "") return defaultValue;
  return ["1", "true", "yes", "y", "on"].includes(String(raw).toLowerCase());
}

function migrationTagNow() {
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, "0");
  return (
    String(d.getUTCFullYear()) +
    p2(d.getUTCMonth() + 1) +
    p2(d.getUTCDate()) +
    "-" +
    p2(d.getUTCHours()) +
    p2(d.getUTCMinutes()) +
    p2(d.getUTCSeconds()) +
    "Z"
  );
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
  const state = loadState(statePath);

  const switchTradeManager = envBool("SWITCH_TRADEMANAGER", false);
  const updatePrimary = envBool("UPDATE_STATE_PRIMARY", switchTradeManager);
  const tag = process.env.MIGRATION_TAG || migrationTagNow();

  const usdbAddress = process.env.USDB_OVERRIDE || state.contracts.USDB;
  const tradeManagerAddress = process.env.TRADEMANAGER_OVERRIDE || state.contracts.tradeManagerProxy;

  if (!usdbAddress) throw new Error("USDB address missing. Set state.contracts.USDB or USDB_OVERRIDE");
  if (!tradeManagerAddress) {
    throw new Error("tradeManagerProxy missing. Set state.contracts.tradeManagerProxy or TRADEMANAGER_OVERRIDE");
  }
  if (!(await hasContractCode(ethers.provider, usdbAddress))) {
    throw new Error(`USDB has no code: ${usdbAddress}`);
  }
  if (!(await hasContractCode(ethers.provider, tradeManagerAddress))) {
    throw new Error(`TradeManager has no code: ${tradeManagerAddress}`);
  }

  console.log(`network:             ${networkName} (${chainId})`);
  console.log(`deployer:            ${signer.address}`);
  console.log(`state:               ${statePath}`);
  console.log(`USDB:                ${usdbAddress}`);
  console.log(`tradeManagerProxy:   ${tradeManagerAddress}`);
  console.log(`tag:                 ${tag}`);
  console.log(`SWITCH_TRADEMANAGER: ${switchTradeManager}`);
  console.log(`UPDATE_STATE_PRIMARY:${updatePrimary}`);

  // 1) Deploy fresh vault proxies.
  const tBLPFactory = await ethers.getContractFactory("tBLP", signer);
  const sBLPFactory = await ethers.getContractFactory("sBLP", signer);

  const tProxy = await upgrades.deployProxy(tBLPFactory, [usdbAddress], {
    initializer: "initialize",
    kind: "transparent",
  });
  await tProxy.deployed();
  console.log(`deployed new tBLPProxy: ${tProxy.address}`);

  const sProxy = await upgrades.deployProxy(sBLPFactory, [usdbAddress], {
    initializer: "initialize",
    kind: "transparent",
  });
  await sProxy.deployed();
  console.log(`deployed new sBLPProxy: ${sProxy.address}`);

  // 2) Wire pnlHandler -> tradeManagerProxy
  const tBLP = (await ethers.getContractFactory("tBLP", signer)).attach(tProxy.address);
  const sBLP = (await ethers.getContractFactory("sBLP", signer)).attach(sProxy.address);

  if (!sameAddress(await tBLP.pnlHandler(), tradeManagerAddress)) {
    const tx = await tBLP.setPnlhandler(tradeManagerAddress);
    await tx.wait();
    console.log(`set tBLP.pnlHandler -> ${tradeManagerAddress} tx=${tx.hash}`);
  }
  if (!sameAddress(await sBLP.pnlHandler(), tradeManagerAddress)) {
    const tx = await sBLP.setPnlhandler(tradeManagerAddress);
    await tx.wait();
    console.log(`set sBLP.pnlHandler -> ${tradeManagerAddress} tx=${tx.hash}`);
  }

  // 3) Optionally switch TradeManager to new vaults.
  let switchTxHash = "";
  if (switchTradeManager) {
    const tm = await ethers.getContractAt(
      [
        "function wards(address) view returns (uint256)",
        "function tBLP() view returns (address)",
        "function sBLP() view returns (address)",
        "function setBLPVaults(address _tBLP, address _sBLP) external",
      ],
      tradeManagerAddress,
      signer
    );

    const ward = await tm.wards(signer.address);
    if (!ward.eq(1)) {
      throw new Error(`Signer is not auth on TradeManager. wards(${signer.address})=${ward.toString()}`);
    }

    const tx = await tm.setBLPVaults(tProxy.address, sProxy.address);
    await tx.wait();
    switchTxHash = tx.hash;
    console.log(`switched TradeManager vaults tx=${tx.hash}`);

    const [tOnchain, sOnchain] = await Promise.all([tm.tBLP(), tm.sBLP()]);
    if (!sameAddress(tOnchain, tProxy.address) || !sameAddress(sOnchain, sProxy.address)) {
      throw new Error(`Switch verification failed. tBLP=${tOnchain}, sBLP=${sOnchain}`);
    }
    console.log(`switch verified: tBLP=${tOnchain}, sBLP=${sOnchain}`);
  }

  // 4) Persist migration snapshot into state.
  state.contracts = state.contracts || {};
  state.meta = state.meta || {};

  const tTagKey = `tBLPProxy_${tag}`;
  const sTagKey = `sBLPProxy_${tag}`;
  state.contracts[tTagKey] = tProxy.address;
  state.contracts[sTagKey] = sProxy.address;

  if (updatePrimary) {
    state.contracts.tBLPProxy = tProxy.address;
    state.contracts.sBLPProxy = sProxy.address;
  }

  state.meta.lastBLPVaultRedeploy = {
    tag,
    at: new Date().toISOString(),
    by: signer.address,
    usdb: usdbAddress,
    tradeManagerProxy: tradeManagerAddress,
    tBLPProxy: tProxy.address,
    sBLPProxy: sProxy.address,
    switchTradeManager,
    switchTxHash,
  };

  saveState(statePath, state);

  console.log("done.");
  console.log(`state saved: ${statePath}`);
  console.log(`new tBLPProxy: ${tProxy.address}`);
  console.log(`new sBLPProxy: ${sProxy.address}`);
}

main().catch((error) => {
  console.error("redeployBLPVaults.baseMainnet failed:", error);
  process.exitCode = 1;
});

