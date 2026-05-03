const hre = require("hardhat");
const { ethers, upgrades } = hre;
const fs = require("fs");
const path = require("path");

const BASE_MAINNET_CHAIN_ID = 8453;
const TM_PROXY = "0x4a8793AE855AE40A00504D61d2ac4074B5214669";
const NEW_TBLP = "0x1DBC025A07c904F876946C98dfa3B36dAc365Ca3";
const NEW_SBLP = "0x360A3417a4192B6D49a31c1AcabB59E10Da29dfB";

function normalizeDeployEnv(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";

  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!normalized) {
    throw new Error(`DEPLOY_ENV="${raw}" is invalid after normalization`);
  }
  return normalized;
}

function buildStatePath(deployDir, networkName, deployEnv, stateTag) {
  const filename = deployEnv
    ? `${networkName}.${deployEnv}.${stateTag}.json`
    : `${networkName}.${stateTag}.json`;
  return path.join(deployDir, filename);
}

function ensureAddr(name, value) {
  if (!ethers.utils.isAddress(value)) {
    throw new Error(`${name} is not a valid address: ${value}`);
  }
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

async function main() {
  const [signer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  const networkName = hre.network.name;
  const deployEnv = normalizeDeployEnv(process.env.DEPLOY_ENV);

  if (chainId !== BASE_MAINNET_CHAIN_ID) {
    throw new Error(`This script is for Base mainnet only. Expected chainId=8453, got ${chainId}`);
  }

  ensureAddr("TM_PROXY", TM_PROXY);
  ensureAddr("NEW_TBLP", NEW_TBLP);
  ensureAddr("NEW_SBLP", NEW_SBLP);

  const deployDir = path.join(__dirname, "state");
  const statePath = buildStatePath(deployDir, networkName, deployEnv, "resume-buzzing.base-mainnet");
  const state = loadState(statePath);

  const tmAbi = [
    "function wards(address) view returns (uint256)",
    "function tBLP() view returns (address)",
    "function sBLP() view returns (address)",
    "function setBLPVaults(address _tBLP, address _sBLP) external",
  ];
  const tAbi = ["function pnlHandler() view returns (address)"];

  console.log(`network:  ${networkName} (${chainId})`);
  console.log(`env:      ${deployEnv || "default"}`);
  console.log(`signer:   ${signer.address}`);
  console.log(`tmProxy:  ${TM_PROXY}`);
  console.log(`new tBLP: ${NEW_TBLP}`);
  console.log(`new sBLP: ${NEW_SBLP}`);

  // Basic on-chain sanity.
  const codeTm = await ethers.provider.getCode(TM_PROXY);
  if (!codeTm || codeTm === "0x") throw new Error(`TM proxy has no code: ${TM_PROXY}`);

  const beforeImpl = await upgrades.erc1967.getImplementationAddress(TM_PROXY);
  const beforeAdmin = await upgrades.erc1967.getAdminAddress(TM_PROXY);
  console.log(`impl(before): ${beforeImpl}`);
  console.log(`admin:        ${beforeAdmin}`);

  const tmBefore = new ethers.Contract(TM_PROXY, tmAbi, signer);
  const wardBefore = await tmBefore.wards(signer.address);
  if (!wardBefore.eq(1)) {
    throw new Error(`Signer is not auth in TradeManager wards. ward=${wardBefore.toString()}`);
  }

  // Verify newly deployed vaults and pnl handler wiring.
  const t = new ethers.Contract(NEW_TBLP, tAbi, signer);
  const s = new ethers.Contract(NEW_SBLP, tAbi, signer);
  const [tp, sp] = await Promise.all([t.pnlHandler(), s.pnlHandler()]);
  if (tp.toLowerCase() !== TM_PROXY.toLowerCase()) {
    throw new Error(`NEW_TBLP pnlHandler mismatch. expected ${TM_PROXY}, got ${tp}`);
  }
  if (sp.toLowerCase() !== TM_PROXY.toLowerCase()) {
    throw new Error(`NEW_SBLP pnlHandler mismatch. expected ${TM_PROXY}, got ${sp}`);
  }

  // 1) Upgrade TradeManager implementation.
  const tmFactory = await ethers.getContractFactory("tradeManager", signer);
  const tmUpgraded = await upgrades.upgradeProxy(TM_PROXY, tmFactory, { kind: "transparent" });
  await tmUpgraded.deployed();
  const afterImpl = await upgrades.erc1967.getImplementationAddress(TM_PROXY);
  console.log(`impl(after):  ${afterImpl}`);

  // 2) Switch BLP vault pointers.
  const tx = await tmUpgraded.setBLPVaults(NEW_TBLP, NEW_SBLP);
  console.log(`setBLPVaults tx: ${tx.hash}`);
  const rc = await tx.wait(1);
  console.log(`setBLPVaults mined block=${rc.blockNumber} status=${rc.status}`);

  const [onT, onS] = await Promise.all([tmUpgraded.tBLP(), tmUpgraded.sBLP()]);
  console.log(`tm.tBLP=${onT}`);
  console.log(`tm.sBLP=${onS}`);
  if (onT.toLowerCase() !== NEW_TBLP.toLowerCase() || onS.toLowerCase() !== NEW_SBLP.toLowerCase()) {
    throw new Error("Post-switch verification failed");
  }

  // 3) Persist state primary pointers.
  state.contracts = state.contracts || {};
  state.meta = state.meta || {};
  state.contracts.tradeManagerProxy = TM_PROXY;
  state.contracts.tBLPProxy = NEW_TBLP;
  state.contracts.sBLPProxy = NEW_SBLP;
  state.meta.deployEnv = deployEnv || "default";
  state.meta.lastTradeManagerUpgrade = {
    at: new Date().toISOString(),
    by: signer.address,
    proxy: TM_PROXY,
    implBefore: beforeImpl,
    implAfter: afterImpl,
    setBLPVaultsTx: tx.hash,
    tBLP: NEW_TBLP,
    sBLP: NEW_SBLP,
  };
  saveState(statePath, state);
  console.log(`state updated: ${statePath}`);
}

main().catch((error) => {
  console.error("upgradeTradeManagerAndSwitchBLP.baseMainnet failed:", error);
  process.exitCode = 1;
});
