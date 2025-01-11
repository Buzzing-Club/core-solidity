import { tryVerify } from '@pancakeswap/common/verify'
import { ContractFactory } from 'ethers'
import { ethers, network } from 'hardhat'
import fs from 'fs'

type ContractJson = { abi: any; bytecode: string }
const artifacts: { [name: string]: ContractJson } = {
  // eslint-disable-next-line global-require
  BubblySwapPoolDeployer: require('../artifacts/contracts/BubblySwapPoolDeployer.sol/BubblySwapPoolDeployer.json'),
  // eslint-disable-next-line global-require
  BubblySwapFactory: require('../artifacts/contracts/BubblySwapFactory.sol/BubblySwapFactory.json'),
}

async function main() {
  const [owner] = await ethers.getSigners()
  // const networkName = network.name
  const networkName = "swelltestnet"
  console.log('owner', owner.address)

  let bubblySwapPoolDeployer_address = ''
  let bubblySwapPoolDeployer
  const BubblySwapPoolDeployer = new ContractFactory(
    artifacts.BubblySwapPoolDeployer.abi,
    artifacts.BubblySwapPoolDeployer.bytecode,
    owner
  )
  if (!bubblySwapPoolDeployer_address) {
    bubblySwapPoolDeployer = await BubblySwapPoolDeployer.deploy()

    bubblySwapPoolDeployer_address = bubblySwapPoolDeployer.address
    console.log('bubblySwapPoolDeployer', bubblySwapPoolDeployer_address)
  } else {
    bubblySwapPoolDeployer = new ethers.Contract(
      bubblySwapPoolDeployer_address,
      artifacts.BubblySwapPoolDeployer.abi,
      owner
    )
  }

  let bubblySwapFactory_address = ''
  let bubblySwapFactory
  if (!bubblySwapFactory_address) {
    const BubblySwapFactory = new ContractFactory(
      artifacts.BubblySwapFactory.abi,
      artifacts.BubblySwapFactory.bytecode,
      owner
    )
    bubblySwapFactory = await BubblySwapFactory.deploy(bubblySwapPoolDeployer_address)

    bubblySwapFactory_address = bubblySwapFactory.address
    console.log('bubblySwapFactory', bubblySwapFactory_address)
  } else {
    bubblySwapFactory = new ethers.Contract(bubblySwapFactory_address, artifacts.BubblySwapFactory.abi, owner)
  }

  // Set FactoryAddress for bubblySwapPoolDeployer.
  await bubblySwapPoolDeployer.setFactoryAddress(bubblySwapFactory_address);


  const contracts = {
    BubblySwapFactory: bubblySwapFactory_address,
    BubblySwapPoolDeployer: bubblySwapPoolDeployer_address,
  }

  fs.writeFileSync(`./deployments/${networkName}.json`, JSON.stringify(contracts, null, 2))
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
