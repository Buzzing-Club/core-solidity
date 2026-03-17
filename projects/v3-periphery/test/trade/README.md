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

- `pnl.spec.js`
  - Build pool/liquidity and execute `buyYes -> sellYes`
  - Recompute expected trader pnl using the same on-chain formula
  - Verify `PnLHandled` event values and `tBLP/sBLP` pnl allocation
  - Print `expectedHandledPnl` and `actualHandledPnl` for debugging

- `distributepnl.spec.js`
  - Build pool/liquidity and execute `buyYes -> sellYes`
  - Verify pnl settlement sync between:
    - `tBLP/sBLP` share price change
    - `tBLP/sBLP` real USDB balance change (mint/burn side)
  - Verify LP withdraw expectation under current price model:
    - `maxWithdrawByPrice` (shares * current price)
    - `maxWithdrawOnChain`
    - `requestedWithdraw(5%)` and actual `withdrawReceived`
  - Key debug logs:
    - `userPnl`, `handledPnl`
    - `alloc tBLP/sBLP`
    - `tBLP/sBLP price before -> after`
    - `tBLP/sBLP usdb before -> after`
    - `balanceMatch`, `expectedModelMatch`, `withdrawMatch`

- `blp.last-lp.divzero.spec.js`
  - Validate `sBLP/tBLP` behavior when pnl is negative and the last LP exits
  - Verify full exit succeeds and state resets (`shareToAssetsPrice = 1e18`, `accPnlPerToken = 0`)
  - Verify partial exit (`leave 1 share`) does not trigger division-by-zero paths

- `blp.inflation-attack.spec.js`
  - Simulate classic ERC4626 donation/inflation attack path
  - Verify direct token donation to `sBLP/tBLP` does not change share price
  - Verify later depositor share minting is not diluted by donation

- `wrapped1155.metadata.spec.js`
  - Validate Wrapped1155 metadata decoding behavior for two payload styles:
    - `raw-bytes32`
    - `slot-encoded`
  - Verify impact to `name/symbol/decimals`
  - Verify permit `DOMAIN_SEPARATOR` follows actual on-chain `name()`

- `test/dynamicfee/dynamic-fee.low-frequency.100.spec.js`
  - Dynamic fee low-frequency simulation
  - 100 trades, separated blocks/time (`dt > decayPeriod`), size `1000U`
  - Persist per-trade on-chain details to `test/dynamicfee/reports/*`

- `test/dynamicfee/dynamic-fee.mid-frequency.100.spec.js`
  - Dynamic fee mid-frequency simulation
  - 100 trades, `filterPeriod < dt < decayPeriod`, size `1000U`
  - Persist per-trade on-chain details to `test/dynamicfee/reports/*`

- `test/dynamicfee/dynamic-fee.high-frequency.100.spec.js`
  - Dynamic fee high-frequency simulation
  - 100 trades, `dt=1s` high-frequency path, size `1000U`
  - Persist per-trade on-chain details to `test/dynamicfee/reports/*`

- `test/dynamicfee/dynamic-fee-results.zh-CN.md`
  - Chinese result report for the 3 grouped 100-trade dynamic fee simulations

## Run Commands (Linux)

Run one file:

```bash
yarn workspace @pancakeswap/v3-periphery hardhat test ./test/trade/tradeyes.spec.js --network hardhat
yarn workspace @pancakeswap/v3-periphery hardhat test ./test/trade/tradeno.spec.js --network hardhat
yarn workspace @pancakeswap/v3-periphery hardhat test ./test/trade/redeem.outcome.spec.js --network hardhat
yarn workspace @pancakeswap/v3-periphery hardhat test ./test/trade/pnl.spec.js --network hardhat
yarn workspace @pancakeswap/v3-periphery hardhat test ./test/trade/distributepnl.spec.js --network hardhat
yarn workspace @pancakeswap/v3-periphery hardhat test ./test/trade/blp.last-lp.divzero.spec.js --network hardhat
yarn workspace @pancakeswap/v3-periphery hardhat test ./test/trade/blp.inflation-attack.spec.js --network hardhat
yarn workspace @pancakeswap/v3-periphery hardhat test ./test/trade/wrapped1155.metadata.spec.js --network hardhat
yarn workspace @pancakeswap/v3-periphery hardhat test ./test/dynamicfee/dynamic-fee.low-frequency.100.spec.js --network hardhat
yarn workspace @pancakeswap/v3-periphery hardhat test ./test/dynamicfee/dynamic-fee.mid-frequency.100.spec.js --network hardhat
yarn workspace @pancakeswap/v3-periphery hardhat test ./test/dynamicfee/dynamic-fee.high-frequency.100.spec.js --network hardhat
```

Run main trade flow + pnl:

```bash
yarn workspace @pancakeswap/v3-periphery hardhat test ./test/trade/tradeyes.spec.js ./test/trade/tradeno.spec.js ./test/trade/redeem.outcome.spec.js ./test/trade/pnl.spec.js --network hardhat
```

Run pnl + distribute settlement checks:

```bash
yarn workspace @pancakeswap/v3-periphery hardhat test ./test/trade/pnl.spec.js ./test/trade/distributepnl.spec.js --network hardhat
```

Run all trade specs:

```bash
yarn workspace @pancakeswap/v3-periphery hardhat test ./test/trade/tradeyes.spec.js ./test/trade/tradeno.spec.js ./test/trade/redeem.outcome.spec.js ./test/trade/pnl.spec.js ./test/trade/blp.last-lp.divzero.spec.js ./test/trade/blp.inflation-attack.spec.js ./test/trade/wrapped1155.metadata.spec.js --network hardhat
```
