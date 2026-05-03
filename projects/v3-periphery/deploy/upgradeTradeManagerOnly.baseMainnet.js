const hre = require("hardhat");
const { ethers, upgrades } = hre;

const BASE_MAINNET_CHAIN_ID = 8453;
const TM_PROXY = "0x4a8793AE855AE40A00504D61d2ac4074B5214669";

function ensureAddr(name, value) {
  if (!ethers.utils.isAddress(value)) {
    throw new Error(`${name} is not a valid address: ${value}`);
  }
}

async function main() {
  const [signer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  const networkName = hre.network.name;

  if (chainId !== BASE_MAINNET_CHAIN_ID) {
    throw new Error(`This script is for Base mainnet only. Expected chainId=8453, got ${chainId}`);
  }

  ensureAddr("TM_PROXY", TM_PROXY);

  const tmAbi = ["function wards(address) view returns (uint256)"];

  console.log(`network:  ${networkName} (${chainId})`);
  console.log(`signer:   ${signer.address}`);
  console.log(`tmProxy:  ${TM_PROXY}`);

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

  const tmFactory = await ethers.getContractFactory("tradeManager", signer);
  const tmUpgraded = await upgrades.upgradeProxy(TM_PROXY, tmFactory, { kind: "transparent" });
  await tmUpgraded.deployed();

  const afterImpl = await upgrades.erc1967.getImplementationAddress(TM_PROXY);
  console.log(`impl(after):  ${afterImpl}`);
  console.log("upgrade done: TradeManager implementation only");
}

main().catch((error) => {
  console.error("upgradeTradeManagerOnly.baseMainnet failed:", error);
  process.exitCode = 1;
});

