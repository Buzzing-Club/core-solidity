const hre = require("hardhat");
const { ethers, upgrades } = hre;
const fs = require("fs");
const path = require("path");

const BASE_MAINNET_CHAIN_ID = 8453;

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

function loadState(statePath) {
  if (!fs.existsSync(statePath)) {
    throw new Error(`state file not found: ${statePath}`);
  }
  return JSON.parse(fs.readFileSync(statePath, "utf8"));
}

function saveState(statePath, state) {
  const next = { ...state, updatedAt: new Date().toISOString() };
  fs.writeFileSync(statePath, JSON.stringify(next, null, 2), "utf8");
}

async function waitForCode(provider, address, retries = 40, intervalMs = 3000) {
  for (let i = 0; i < retries; i++) {
    const code = await provider.getCode(address);
    if (code && code !== "0x") {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`code not found after wait: ${address}`);
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

  const deployDir = path.join(__dirname, "state");
  const statePath = buildStatePath(deployDir, networkName, deployEnv, "resume-buzzing.base-mainnet");
  const state = loadState(statePath);

  const tProxy = process.env.TBLP_PROXY_OVERRIDE || state.contracts.tBLPProxy;
  const sProxy = process.env.SBLP_PROXY_OVERRIDE || state.contracts.sBLPProxy;
  if (!ethers.utils.isAddress(tProxy) || !ethers.utils.isAddress(sProxy)) {
    throw new Error(`invalid proxy addresses. tBLP=${tProxy}, sBLP=${sProxy}`);
  }

  const tCode = await ethers.provider.getCode(tProxy);
  const sCode = await ethers.provider.getCode(sProxy);
  if (!tCode || tCode === "0x") throw new Error(`tBLP proxy has no code: ${tProxy}`);
  if (!sCode || sCode === "0x") throw new Error(`sBLP proxy has no code: ${sProxy}`);

  const tImplBefore = await upgrades.erc1967.getImplementationAddress(tProxy);
  const sImplBefore = await upgrades.erc1967.getImplementationAddress(sProxy);
  const tAdmin = await upgrades.erc1967.getAdminAddress(tProxy);
  const sAdmin = await upgrades.erc1967.getAdminAddress(sProxy);
  if (tAdmin.toLowerCase() !== sAdmin.toLowerCase()) {
    throw new Error(`proxy admin mismatch. tAdmin=${tAdmin}, sAdmin=${sAdmin}`);
  }

  const proxyAdmin = await ethers.getContractAt(
    ["function owner() view returns (address)"],
    tAdmin,
    signer
  );
  const adminOwner = await proxyAdmin.owner();
  if (adminOwner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(`signer is not ProxyAdmin owner. owner=${adminOwner}, signer=${signer.address}`);
  }

  console.log(`network:       ${networkName} (${chainId})`);
  console.log(`env:           ${deployEnv || "default"}`);
  console.log(`signer:        ${signer.address}`);
  console.log(`state:         ${statePath}`);
  console.log(`tBLP proxy:    ${tProxy}`);
  console.log(`sBLP proxy:    ${sProxy}`);
  console.log(`proxy admin:   ${tAdmin}`);
  console.log(`admin owner:   ${adminOwner}`);
  console.log(`tImpl(before): ${tImplBefore}`);
  console.log(`sImpl(before): ${sImplBefore}`);

  // Upgrade implementations in place. Proxy addresses remain unchanged.
  const tFactory = await ethers.getContractFactory("tBLP", signer);
  const sFactory = await ethers.getContractFactory("sBLP", signer);
  const upgradeOpts = {
    kind: "transparent",
    // Force deploying fresh implementation contracts instead of reusing
    // potentially stale manifest entries.
    useDeployedImplementation: false,
  };

  // 1) Deploy/prepare new implementations first.
  const tImplTarget = await upgrades.prepareUpgrade(tProxy, tFactory, upgradeOpts);
  const sImplTarget = await upgrades.prepareUpgrade(sProxy, sFactory, upgradeOpts);
  console.log(`tImpl(target): ${tImplTarget}`);
  console.log(`sImpl(target): ${sImplTarget}`);

  await waitForCode(ethers.provider, tImplTarget);
  await waitForCode(ethers.provider, sImplTarget);

  // 2) Upgrade proxies via ProxyAdmin (no proxy redeploy, no tradeManager touch).
  const proxyAdminWithUpgrade = await ethers.getContractAt(
    ["function owner() view returns (address)", "function upgrade(address proxy, address implementation) external"],
    tAdmin,
    signer
  );

  let txT = null;
  let txS = null;
  let nextNonce = await ethers.provider.getTransactionCount(signer.address, "pending");

  if (tImplBefore.toLowerCase() !== tImplTarget.toLowerCase()) {
    txT = await proxyAdminWithUpgrade.upgrade(tProxy, tImplTarget, {
      gasLimit: 3000000,
      nonce: nextNonce++,
    });
    console.log(`upgrade tBLP tx: ${txT.hash}`);
    await txT.wait(1);
  } else {
    console.log("tBLP already on target implementation, skip upgrade tx.");
  }

  if (sImplBefore.toLowerCase() !== sImplTarget.toLowerCase()) {
    txS = await proxyAdminWithUpgrade.upgrade(sProxy, sImplTarget, {
      gasLimit: 3000000,
      nonce: nextNonce++,
    });
    console.log(`upgrade sBLP tx: ${txS.hash}`);
    await txS.wait(1);
  } else {
    console.log("sBLP already on target implementation, skip upgrade tx.");
  }

  const tImplAfter = await upgrades.erc1967.getImplementationAddress(tProxy);
  const sImplAfter = await upgrades.erc1967.getImplementationAddress(sProxy);
  console.log(`tImpl(after):  ${tImplAfter}`);
  console.log(`sImpl(after):  ${sImplAfter}`);

  if (tImplAfter.toLowerCase() === tImplBefore.toLowerCase()) {
    throw new Error("tBLP implementation did not change");
  }
  if (sImplAfter.toLowerCase() === sImplBefore.toLowerCase()) {
    throw new Error("sBLP implementation did not change");
  }

  // Ensure pnlHandler still points to current TradeManager and proxies are unchanged.
  const tVault = (await ethers.getContractFactory("tBLP", signer)).attach(tProxy);
  const sVault = (await ethers.getContractFactory("sBLP", signer)).attach(sProxy);
  const tPnlHandler = await tVault.pnlHandler();
  const sPnlHandler = await sVault.pnlHandler();
  const tmProxy = state.contracts.tradeManagerProxy;
  console.log(`tradeManager:  ${tmProxy}`);
  console.log(`tBLP pnlHandler=${tPnlHandler}`);
  console.log(`sBLP pnlHandler=${sPnlHandler}`);

  if (tmProxy) {
    if (tPnlHandler.toLowerCase() !== tmProxy.toLowerCase()) {
      throw new Error(`tBLP pnlHandler changed unexpectedly: ${tPnlHandler}`);
    }
    if (sPnlHandler.toLowerCase() !== tmProxy.toLowerCase()) {
      throw new Error(`sBLP pnlHandler changed unexpectedly: ${sPnlHandler}`);
    }
  }

  state.meta = state.meta || {};
  state.meta.lastBLPImplUpgrade = {
    at: new Date().toISOString(),
    by: signer.address,
    tBLPProxy: tProxy,
    sBLPProxy: sProxy,
    tImplBefore,
    tImplAfter,
    sImplBefore,
    sImplAfter,
    tUpgradeTx: txT ? txT.hash : "",
    sUpgradeTx: txS ? txS.hash : "",
    tradeManagerProxy: tmProxy || "",
  };
  saveState(statePath, state);
  console.log(`state updated: ${statePath}`);
  console.log("done.");
}

main().catch((error) => {
  console.error("upgradeBLPVaultImpls.baseMainnet failed:", error);
  process.exitCode = 1;
});
