const { ethers } = require('hardhat');
const fs = require('fs');
const path = require('path');
// const csv = require('csv-parser');

async function main() {
    const privateKey = process.env.PRIVATE_KEY;
    const signer = new ethers.Wallet(privateKey, ethers.provider);

    // 输出 Signer 地址
    const network = await ethers.provider.getNetwork();
    console.log('network', network);
    console.log('Chain ID:', network.chainId);
    console.log(`Signer address: ${signer.address}`);
    const balance = await ethers.provider.getBalance(signer.address);
    console.log(`Balance: ${ethers.utils.formatEther(balance)} ETH`);
    const gasPrice = await ethers.provider.getGasPrice();
    console.log(`Current gas price: ${ethers.utils.formatUnits(gasPrice, "gwei")} gwei`);
    const networkname = network.name + 'alpha'
    console.log(`Deploying contracts with the account: ${signer.address}`);
    console.log(`Account balance: ${(await signer.getBalance()).toString()}`);




    //console.log(users); // 在此处输出 users 数组
    //Stone = (await ethers.getContractFactory('Stone',signer)).attach(deployedContracts.networks[networkname].Stone);    
    //USDC = (await ethers.getContractFactory('USDe',signer)).attach(deployedContracts.networks[networkname].USDC);  
    //Hyperliquid = (await ethers.getContractFactory('Hyperliquid',signer)).attach("0x044c4057FAA2A968211fB0f4c4C1b4098EF0d577");
    //Eigen = (await ethers.getContractFactory('Eigen',signer)).attach(deployedContracts.networks[networkname].Eigen); 
    //CPM = (await ethers.getContractFactory('CollateralPositionManager', signer)).attach(deployedContracts.networks[networkname].CPM);
    Quoter = (await ethers.getContractFactory('QuoterV2',signer)).attach("0xE141FcbaAE02C7E328563c53c65B1312bB83A020");
    //shortposition = await CPM.getLongPosition("0xaD15832a86477F020e79aA890F688C5857719E2B","0xA807c913CB59D4Ad3c8239ab726eCd9B83B6cd03")
    //console.log("user3 空仓仓位：",shortposition[0].toString());
    // console.log('quoter addr',Quoter.address)
    // console.log('quoter facotyr',await Quoter.factory());
    // console.log(Stone.address)
    // console.log(Eigen.address)
    let quoterInputSingleParams = {
        //quoteToken : USDC.address,
        tokenIn: "0x844a20386A8c36A19d81738910dC2148A67F1813", // 替换为实际的 tokenIn 地址
        tokenOut: "0xFD9AdBa765274f5A05d6a8A9b48b9F769383f0Fd", // 替换为实际的 tokenOut 地址
        //amountIn: ethers.utils.parseUnits("110188592922653", 6), // 1.0 tokenIn                
        amountIn: "10000000000000000",
        fee: 2500,
        sqrtPriceLimitX96: "0" // 根据实际需要设置s
        //isOpen: false // 或 false，根据实际情况设置          
      }
      
    //   let quoterOutputSingleParams = {
    //       quoteToken : USDC.address,
    //       tokenIn: USDC.address, // 替换为实际的 tokenIn 地址
    //       tokenOut: Eigen.address, // 替换为实际的 tokenOut 地址
    //       //amountIn: ethers.utils.parseUnits("110188592922653", 6), // 1.0 tokenIn                
    //       amount: (shortposition[0] -70932).toString(),
    //       fee: 15000,
    //       sqrtPriceLimitX96: "0", // 根据实际需要设置s
    //       isOpen: false // 或 false，根据实际情况设置          
    //     }
    //let quotercall = await Quoter.callStatic.quoteExactInputSingle(quoterInputSingleParams);
    
    let quotercall = await Quoter.connect(signer).callStatic.quoteExactInputSingle(quoterInputSingleParams);
    console.log('user quoter:',quotercall)
    // console.log(quotercall.amountOut.toString())
    // let minpreviewpara = {token0:"0x1be3fc5A0Bd010d046709bEbf704305444FdDaa3",
    //                       token1:"0xbA798E91fFEe4CFe5000eEBEc5d2A473Aa27F1a6",
    //                       fee:3000,
    //                       tickLower:-37440,
    //                       tickUpper:-34440,
    //                       amount1Desired:ethers.BigNumber.from("10000000000000000000"),
    //                       amount0Desired:ethers.BigNumber.from("309976000000000000000")
    //                     }
    // let quotercall = await Quoter.connect(signer).callStatic.mintPreview(minpreviewpara);
    // console.log('user quoter:',quotercall)

}

main().catch((error) => {
    console.error('Error in main function:', error);
    process.exitCode = 1;
});
