const { ethers } = require('hardhat');
const fs = require('fs');
const path = require('path');


async function main() {

    privateKey = process.env.PRIVATE_KEY;
    const signer = new ethers.Wallet(privateKey, ethers.provider);

    // 输出 Signer 地址
    const network = await ethers.provider.getNetwork();
    console.log('network', network);
    console.log('Chain ID:', network.chainId);
    console.log(`Signer address: ${signer.address}`);
    const balance = await ethers.provider.getBalance(signer.address);
    console.log('balance bofore format', balance)
    const balanceInEth = ethers.utils.formatEther(balance);
    console.log(`Balance: ${balanceInEth} ETH`);
    const gasPrice = await ethers.provider.getGasPrice();
    const networkname = network.name
    console.log(`Current gas price: ${ethers.utils.formatUnits(gasPrice, "gwei")} gwei`);


    console.log(`Deploying contracts with the account: ${signer.address}`);
    console.log(`Account balance: ${(await signer.getBalance()).toString()}`);
    //ScrollMarksPool = (await ethers.getContractFactory('BubblyPool',signer)).attach(deployedContracts.networks[networkname].ScrollMarksPool);
    //ZircuitPool = (await ethers.getContractFactory('BubblyPool',signer)).attach(deployedContracts.networks[networkname].CookPool);
    //SwellPool = (await ethers.getContractFactory('BubblyPool',signer)).attach(deployedContracts.networks[networkname].SwellPool);
    //HyperliquidPool = (await ethers.getContractFactory('BubblyPool',signer)).attach(deployedContracts.networks[networkname].Morpho_USDCPool);
    EigenPool = (await ethers.getContractFactory('BubblySwapPool',signer)).attach("0x28b8436614Ee9817f056D75188CAA691559cE685");
    
    const sqrtpirice = ethers.BigNumber.from("56022770974786143748341366784");
    //const sqrtpirice = ethers.BigNumber.from("112045541949572287496682733568");
    await(await EigenPool.initialize(sqrtpirice)).wait();
    console.log(await EigenPool.slot0());
    console.log(await EigenPool.token0());
    console.log(await EigenPool.token1());








}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});




