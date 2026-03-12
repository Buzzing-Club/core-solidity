# Permission Model Summary

This document summarizes access control patterns used in the current Buzzing contracts.

## Scope
- `projects/v3-core/contracts`
- `projects/v3-periphery/contracts`
- Excludes third-party libraries, interfaces, and OpenZeppelin internals.

## 1) Owner / onlyOwner Pattern

### v3-core
- `BuzzingSwapFactory.sol`
  - Owner state: `owner`
  - Owner-controlled functions:
    - `createPool`
    - `enableFeeAmount`
    - `setWhiteListAddress`
    - `setFeeAmountExtraInfo`
    - `setLmPoolDeployer`
    - `setFeeProtocol`
    - `collectProtocol`
  - Ownership transfer: `setOwner(address _owner)`

### v3-periphery
- `DynamicFeeManager.sol`
  - Owner-controlled: `reset`, `transferOwnership`
- `FeeAdapterTransparent.sol`
  - Owner-controlled: `setVault`, `setPoolTotalFeeRatio`, `setPoolRole`, `setPoolReferShare`, `transferOwnership`
- `PreTrading.sol`
  - Owner-controlled: `withdrawMarketFee`, `setDelay`, `transferOwnership`
- `USDB.sol`
  - Owner-controlled: `setVault`, `transferOwnership`
- `CumulativeMerkleClaim.sol`
  - Owner-controlled: `updateMerkleRoot`, `withdraw`, `transferOwnership`
- `contractFactory.sol`
  - Owner-controlled: `deploy`, `transferOwnership`
- `SwapRouter.sol`
  - Owner-controlled: `setVault`
  - Note: no explicit `transferOwnership` currently
- `NFTDescriptorEx.sol`
  - Owner-controlled: `setOwner`, `toggleSwitchAndUpdateNFTDomain`
- `PositionExitCoordinator.sol`
  - Owner-controlled: `transferOwnership`, `rescueToken`

## 2) Auth / wards (multi-admin) Pattern

- `TradeManager.sol`
  - Admin model: `mapping(address => uint256) wards`
  - Permission modifier: `auth`
  - Admin management: `rely(address)`, `deny(address)`
  - `auth`-gated functions include:
    - `setFeeAdapter`, `setFeeManager`
    - `addLiquidity`, `decreaseLiquidity`
    - `setYieldProtocol`, `USDCdeposit`, `USDCwithdraw`, `ERC20tranfser`
    - `handleMarketPnl`, `marketReport`

- `NonfungiblePositionManager.sol`
  - Admin model: `wards + auth`
  - Admin management: `rely`, `deny`
  - `auth` gates key management flow (e.g. `mint`)

- `tBLP.sol`
  - Admin model: `wards + auth`
  - Admin management: `rely`, `deny`
  - Admin-settable: `setPnlhandler`, `setUSDB`

- `sBLP.sol`
  - Same as `tBLP`: `wards + auth`, with `rely`, `deny`, `setPnlhandler`, `setUSDB`

- `sparkMock.sol`
  - Admin model: `wards + auth`
  - Admin management: `rely`, `deny`
  - Admin function: `file(...)`

## 3) Other Role-Based Permissions

- `PreTrading.sol`
  - `onlyOracle`: `resolveMarket`, `unsetMarket`

- `USDB.sol`
  - `onlyVault`: `mint`, `burn`, `distribute`

- `FeeAdapterTransparent.sol`
  - `onlyVault`: `recordFee`

- `SwapRouter.sol`
  - `onlyVault`: swap execution entrypoints

- `BuzzingSwapPool.sol`
  - `onlyFactoryOrFactoryOwner`: protocol-fee related actions

- `BuzzingSwapPoolDeployer.sol`
  - `onlyFactory`: deploy pool

- `Wrapped1155Factory.sol` / `Wrapped1155`
  - `onlyFactory` controls wrapped token `mint` / `burn`

- `depositContract.sol`
  - `onlyFactoryOnwer` controls `deposit` (factory-provided owner)

## 4) Important Clarifications

- In `TradeManager.sol`, checks like `require(msg.sender == owner, "NA")` inside some methods use the function argument named `owner`, not a global governance owner.
- For upgradeable contracts, business owner and proxy upgrade admin are separate authorities. Changing contract-level owner does not automatically change proxy upgrade permission.
