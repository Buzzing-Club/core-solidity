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

    BubblyFactory = (await ethers.getContractFactory('BubblySwapFactory',signer)).attach("0x46a5607749580c6965870968B569d745Cc1f430d");  
 
    let token0 = "0x5eC41957A1bc1aB7aF1E0c8AAC9A1c6CBf85Be53"

    let token1 = "0x87407170C57f2163c93A8770049e7fCBFb8d5c71"
    BubblyPool = (await ethers.getContractFactory('BubblySwapPool',signer)).attach("0x97200348058c70AF654c63734BB71aF6218ad90B");  
    console.log(await BubblyPool.slot0())
    // let poolcreate = await BubblyFactory.createPool(token0,token1,2500,{gasLimit:10000000});
    // let receipt = await poolcreate.wait(); 
    // let events = receipt.events;

    // // 遍历所有事件，找到你需要的事件
    // for (const event of events) {
    //     if (event.event === "PoolCreated") { // 将 "EventName" 替换为你要捕获的事件名称
    //         pooladdress = event.args.pool;
    //         console.log("Pooladdr",pooladdress)
    //     }
    // }

}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});




