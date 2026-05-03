const hre = require('hardhat');
const { ethers } = hre;

async function runtimeHashFromArtifact(name) {
  const artifact = await hre.artifacts.readArtifact(name);
  return ethers.utils.keccak256(artifact.deployedBytecode);
}

async function runtimeHashOnChain(addr) {
  const code = await ethers.provider.getCode(addr);
  return ethers.utils.keccak256(code);
}

(async () => {
  const addrs = ['0x6e1f958c092Ce96A29b9ac126899882Bd07d0429','0xb697820ad863b4288693a09cc1ae5b5a2463d781'];
  const tHash = await runtimeHashFromArtifact('tBLP');
  const sHash = await runtimeHashFromArtifact('sBLP');
  console.log('LOCAL_tBLP=' + tHash);
  console.log('LOCAL_sBLP=' + sHash);
  for (const a of addrs) {
    const h = await runtimeHashOnChain(a);
    console.log('ONCHAIN_' + a + '=' + h);
  }
})();
