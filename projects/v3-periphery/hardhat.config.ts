import type { HardhatUserConfig, NetworkUserConfig } from 'hardhat/types'
import '@nomiclabs/hardhat-ethers'
import '@nomiclabs/hardhat-etherscan'
import '@nomiclabs/hardhat-waffle'
import '@openzeppelin/hardhat-upgrades'
import '@typechain/hardhat'
import 'hardhat-watcher'
import 'dotenv/config'
import 'solidity-docgen'
require('dotenv').config({ path: require('find-config')('.env') })

const LOW_OPTIMIZER_COMPILER_SETTINGS = {
  version: '0.7.6',
  settings: {
    evmVersion: 'istanbul',
    optimizer: {
      enabled: true,
      runs: 2_000,
    },
    metadata: {
      bytecodeHash: 'none',
    },
  },
}

const LOWEST_OPTIMIZER_COMPILER_SETTINGS = {
  version: '0.7.6',
  settings: {
    evmVersion: 'istanbul',
    optimizer: {
      enabled: true,
      runs: 1_000,
    },
    metadata: {
      bytecodeHash: 'none',
    },
  },
}

const DEFAULT_COMPILER_SETTINGS = {
  version: '0.7.6',
  settings: {
    evmVersion: 'istanbul',
    optimizer: {
      enabled: true,
      runs: 1_000_000,
    },
    metadata: {
      bytecodeHash: 'none',
    },
  },
}

const CTF_COMPILER_SETTINGS = {
  version: '0.5.17',
  settings: {
    evmVersion: 'istanbul',
    optimizer: {
      enabled: true,
      runs: 200,
    },
  },
}
const USDC_COMPILER_SETTINGS = {
  version: '0.8.0',
  settings: {
    evmVersion: 'istanbul',
    optimizer: {
      enabled: true,
      runs: 200,
    },
  },
}
const ERC1155Factory_COMPILER_SETTINGS = {
  version: '0.6.12',
  settings: {
    evmVersion: 'istanbul',
    optimizer: {
      enabled: true,
      runs: 200,
    },
  },
}

const bscTestnet: NetworkUserConfig = {
  url: 'https://data-seed-prebsc-1-s1.binance.org:8545/',
  chainId: 97,
  accounts: [process.env.KEY_TESTNET!],
}

const bscMainnet: NetworkUserConfig = {
  url: 'https://bsc-dataseed.binance.org/',
  chainId: 56,
  accounts: [process.env.KEY_MAINNET!],
}

const goerli: NetworkUserConfig = {
  url: 'https://rpc.ankr.com/eth_goerli',
  chainId: 5,
  accounts: [process.env.KEY_GOERLI!],
}

const eth: NetworkUserConfig = {
  url: 'https://eth.llamarpc.com',
  chainId: 1,
  accounts: [process.env.KEY_ETH!],
}

export default {
  networks: {
    hardhat: {
      allowUnlimitedContractSize: true,
    },
    ...(process.env.KEY_TESTNET && { bscTestnet }),
    ...(process.env.KEY_MAINNET && { bscMainnet }),
    ...(process.env.KEY_GOERLI && { goerli }),
    ...(process.env.KEY_ETH && { eth }),
    // mainnet: bscMainnet,
    sepolia: {
      url: `https://sepolia.infura.io/v3/${process.env.INFURA_API_KEY}`,
      // url:"https://eth-sepolia.g.alchemy.com/v2/_fTGQUyv6-jeDLkyqbR-Jv3ljheDDTSE",
      //url:"https://sepolia.infura.io/v3/45dc42dd02914322a6cf2a2f46359c5a",
      accounts : [process.env.PRIVATE_KEY]
    },
    swelltestnet: {
      url: `https://swell-testnet.alt.technology`,
      accounts : [process.env.PRIVATE_KEY]
    },
    swell: {
      url: `https://rpc.ankr.com/swell`,
      accounts : [process.env.PRIVATE_KEY]
    },
    injectivetestnet: {
      url: `https://k8s.testnet.evmix.json-rpc.injective.network`,
      accounts : [process.env.PRIVATE_KEY]
    },
    polygan: {
      url: `https://polygon-mainnet.g.alchemy.com/v2/_fTGQUyv6-jeDLkyqbR-Jv3ljheDDTSE`,
      accounts : [process.env.PRIVATE_KEY]
    },
    
    polygon: {
      url: `https://polygon.blockpi.network/v1/rpc/3c42c659e6f2069a718f2ca2b500d1e77cf103b5`,
      accounts : [process.env.PRIVATE_KEY]
    },
    basetestnet: {
      url: `https://base-sepolia-rpc.publicnode.com`,
      accounts : [process.env.PRIVATE_KEY]
    },
    bsctestnet: {
      url: `https://base-sepolia.gateway.tenderly.co`,
      accounts : [process.env.PRIVATE_KEY]
    },
    pharostestnet: {
      url: `https://devnet.dplabs-internal.com`,
      accounts : [process.env.PRIVATE_KEY]
    }
  },

  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY || '',
  },
  solidity: {
    compilers: [DEFAULT_COMPILER_SETTINGS],
    overrides: {
      'contracts/NonfungiblePositionManager.sol': LOW_OPTIMIZER_COMPILER_SETTINGS,
      'contracts/test/MockTimeNonfungiblePositionManager.sol': LOW_OPTIMIZER_COMPILER_SETTINGS,
      'contracts/test/NFTDescriptorTest.sol': LOWEST_OPTIMIZER_COMPILER_SETTINGS,
      'contracts/NFTDescriptorEx.sol': LOWEST_OPTIMIZER_COMPILER_SETTINGS,
      'contracts/NonfungibleTokenPositionDescriptor.sol': LOWEST_OPTIMIZER_COMPILER_SETTINGS,
      'contracts/libraries/NFTDescriptor.sol': LOWEST_OPTIMIZER_COMPILER_SETTINGS,
      'contracts/ctf.sol': CTF_COMPILER_SETTINGS,
      'contracts/USDC.sol': USDC_COMPILER_SETTINGS,
      'contracts/ERC1155Factory.sol': ERC1155Factory_COMPILER_SETTINGS
    },
  },
  watcher: {
    test: {
      tasks: [{ command: 'test', params: { testFiles: ['{path}'] } }],
      files: ['./test/**/*'],
      verbose: true,
    },
  },
  docgen: {
    pages: 'files',
  },
}
