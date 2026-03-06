# Trade Tests README

## Files And Scenarios

- `tradeyes.spec.js`
  - Deploy clean environment
  - Add liquidity
  - User `buyYes`
  - User `sellYes`
  - Check balance and position updates

- `tradeno.spec.js`
  - Deploy clean environment
  - Add liquidity
  - User `buyNo`
  - User `sellNo`
  - Check balance and position updates

- `redeem.outcome.spec.js`
  - `buyNo` then oracle resolves `YES/NO`, verify redeem behavior
  - `buyYes` then oracle resolves `YES/NO`, verify redeem behavior
  - When result matches side: USDB increase equals redeemed token amount
  - When result mismatches side: USDB increase is zero

## Run Commands (Linux)

Run one file:

```bash
yarn workspace @pancakeswap/v3-periphery hardhat test ./test/trade/tradeyes.spec.js --network hardhat
yarn workspace @pancakeswap/v3-periphery hardhat test ./test/trade/tradeno.spec.js --network hardhat
yarn workspace @pancakeswap/v3-periphery hardhat test ./test/trade/redeem.outcome.spec.js --network hardhat
```

Run all three:

```bash
yarn workspace @pancakeswap/v3-periphery hardhat test ./test/trade/tradeyes.spec.js ./test/trade/tradeno.spec.js ./test/trade/redeem.outcome.spec.js --network hardhat
```
