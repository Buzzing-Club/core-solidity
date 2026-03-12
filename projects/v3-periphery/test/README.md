# Test Suite README

## Overview

This folder contains integration tests for:

- `trade/`: deployment + liquidity + trading + redeem flows
- `pretrading/`: pre-market betting, withdraw, claim, termination flows

All commands below assume you run them from the workspace root.

## Run Trade Tests

```bash
yarn workspace @pancakeswap/v3-periphery hardhat test ./test/trade/tradeyes.spec.js --network hardhat
yarn workspace @pancakeswap/v3-periphery hardhat test ./test/trade/tradeno.spec.js --network hardhat
yarn workspace @pancakeswap/v3-periphery hardhat test ./test/trade/redeem.outcome.spec.js --network hardhat
yarn workspace @pancakeswap/v3-periphery hardhat test ./test/trade/pnl.spec.js --network hardhat
yarn workspace @pancakeswap/v3-periphery hardhat test ./test/trade/blp.last-lp.divzero.spec.js --network hardhat
yarn workspace @pancakeswap/v3-periphery hardhat test ./test/trade/blp.inflation-attack.spec.js --network hardhat
yarn workspace @pancakeswap/v3-periphery hardhat test ./test/trade/wrapped1155.metadata.spec.js --network hardhat
```

Run all trade specs:

```bash
yarn workspace @pancakeswap/v3-periphery hardhat test ./test/trade/tradeyes.spec.js ./test/trade/tradeno.spec.js ./test/trade/redeem.outcome.spec.js ./test/trade/pnl.spec.js ./test/trade/blp.last-lp.divzero.spec.js ./test/trade/blp.inflation-attack.spec.js ./test/trade/wrapped1155.metadata.spec.js --network hardhat
```

## Run PreTrading Tests

```bash
yarn workspace @pancakeswap/v3-periphery hardhat test ./test/pretrading/scenario1.claim-payouts.spec.js --network hardhat
yarn workspace @pancakeswap/v3-periphery hardhat test ./test/pretrading/scenario2.cancel-within-lock.spec.js --network hardhat
yarn workspace @pancakeswap/v3-periphery hardhat test ./test/pretrading/scenario3.claim-after-lock.spec.js --network hardhat
yarn workspace @pancakeswap/v3-periphery hardhat test ./test/pretrading/scenario4.terminated-threshold.spec.js --network hardhat
```
