# PreTrading Tests README

## Files And Scenarios

- `scenario1.claim-payouts.spec.js`
  - Multiple users bet YES/NO
  - Oracle resolves market to YES and NO in two different conditions
  - Winning users claim and payouts are checked against expected formula

- `scenario2.cancel-within-lock.spec.js`
  - Multiple users place bets
  - Some users request withdraw and then cancel within lock period
  - `claimWithdraw` during lock is rejected (`Too early`)

- `scenario3.claim-after-lock.spec.js`
  - Multiple users request withdraw
  - After lock period, `claimWithdraw` succeeds
  - Received amount matches withdraw amount minus withdraw fee

- `scenario4.terminated-threshold.spec.js`
  - Market threshold is set to `1000000000` (1000 USDC with 6 decimals)
  - Once total deposit exceeds threshold, market status becomes `TERMINATED`
  - New deposits are rejected (`Market not open`)

## Shared Helper

- `helpers.js`
  - fixture deployment
  - amount utility (`usdcAmount`)
  - expected payout calculation

## Run Commands (Linux)

Run one scenario:

```bash
yarn workspace @pancakeswap/v3-periphery hardhat test ./test/pretrading/scenario1.claim-payouts.spec.js --network hardhat
yarn workspace @pancakeswap/v3-periphery hardhat test ./test/pretrading/scenario2.cancel-within-lock.spec.js --network hardhat
yarn workspace @pancakeswap/v3-periphery hardhat test ./test/pretrading/scenario3.claim-after-lock.spec.js --network hardhat
yarn workspace @pancakeswap/v3-periphery hardhat test ./test/pretrading/scenario4.terminated-threshold.spec.js --network hardhat
```

Run all four:

```bash
yarn workspace @pancakeswap/v3-periphery hardhat test ./test/pretrading/scenario1.claim-payouts.spec.js ./test/pretrading/scenario2.cancel-within-lock.spec.js ./test/pretrading/scenario3.claim-after-lock.spec.js ./test/pretrading/scenario4.terminated-threshold.spec.js --network hardhat
```
