# Buzzing Onchain Modules


## Deployments

1. Add Key in `.env` file. It's a private key of the account that will deploy the contracts and should be gitignored.
2. bscTestnet `KEY_TESTNET` or bsc `KEY_MAINNET`
3. add `ETHERSCAN_API_KEY` in `.env` file. It's an API key for etherscan.
4. `yarn` in root directory
5. `NETWORK=$NETWORK yarn zx v3-deploy.mjs` where `$NETWORK` is either `eth`, `goerli`, `bscMainnet`, `bscTestnet` or `hardhat` (for local testing)
6. `NETWORK=$NETWORK yarn zx v3-verify.mjs` where `$NETWORK` is either `eth`, `goerli`, `bscMainnet`, `bscTestnet` or `hardhat` (for local testing)

Pharostestnet
wrapped1155Factory deployed to: 0x33a6d08bb2b58d88acDd398A0A815715d66Ee869
ctf deployed to: 0x801EE630b30Dcf4C3B85EcdC0c4f62422bC123d2
USDC deployed to: 0xC8Ebbf08Cb2A87aB90cC8EeC34C721764b7755e9
vault deployed to: 0xf3Bb95A1974aB49aa0399420e1030fC9f566c8Ba
swapRouter 0x1DC36db0d05DdA9B03E376cDfA4E098bFd925503
nonfungibleTokenPositionDescriptor 0x3D8Bd7b54631F5A98BE9Ca97aa5f7B1b2078FC5D
nonfungiblePositionManager 0xD85e83f44fe1E849f7fb61d0853CE19DE79E7520
BuzzingInterfaceMulticall 0x56cA9bD47C90564DdDD1b781c68dba2d1fE9Ffd6
V3Migrator 0x26dd0eE2cc023caDA22Ff34ef59F70A3175dFb21
TickLens 0xa2d02534A8f6467CBA81fB6e5371365905B95b73
QuoterV2 0x82294863d2a8dd9aeD73C144043D5c1E15D596FC
buzzingSwapPoolDeployer 0x3aca72274c050Da37866948DC1bB4aFF1718B5dE
buzzingSwapFactory 0xbB1952ADCF4Ae8f27289200d2e9b7ee6950b2a37
