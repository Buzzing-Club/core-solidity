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

    Factory = (await ethers.getContractFactory('BubblySwapFactory',signer)).attach("0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512");
    usdbaddr = "0x68B1D87F95878fE05B998F19b66F4baba5De1aed"
    erc1155addr = "0x0e0E6EA21bF9C9996551f7F1974a4Fb5fA6b3906"
    pooladdress = "0xB39095550ec63B9B83089d0C831b840bc109bB34"
    const ERC20 = await ethers.getContractAt(
        "@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20",
        usdbaddr
      );
      const ERC201 = await ethers.getContractAt(
        "@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20",
        erc1155addr
      );      
    console.log(await ERC20.balanceOf(pooladdress));
    console.log(await ERC201.balanceOf(pooladdress))

}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});




