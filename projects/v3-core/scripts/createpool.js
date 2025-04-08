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

    BubblyFactory = (await ethers.getContractFactory('BubblySwapFactory',signer)).attach("0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512");  
 
    let token0 = "0x7FB1F229CF87f6dDE8298DAa176b76D3EaB43aC7"
    
    let token1 = "0x959922bE3CAee4b8Cd9a407cc3ac1C251C2007B1"
    
    let poolcreate = await BubblyFactory.createPool(token0,token1,2500);
    let receipt = await poolcreate.wait(); 
    let events = receipt.events;

    // 遍历所有事件，找到你需要的事件
    for (const event of events) {
        if (event.event === "PoolCreated") { // 将 "EventName" 替换为你要捕获的事件名称
            pooladdress = event.args.pool;
            console.log("Pooladdr",pooladdress)
        }
    }

}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});




