// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/**
 * @dev Interface for BLPToken contract
 */
interface IBLPToken {

    struct Meta {
        string name;
        string symbol;
    }

    

    function distributePnl(uint256 assets) external;

    function marketCap() external view returns (uint256);

    function shareToAssetsPrice() external view returns (uint256);

    event ShareToAssetsPriceUpdated(uint256 newValue);
    

    event WithdrawRequested(
        address indexed sender,
        address indexed owner,
        uint256 shares,
        uint256 currEpoch,
        uint256 indexed unlockEpoch
    );
    event WithdrawCanceled(
        address indexed sender,
        address indexed owner,
        uint256 shares,
        uint256 currEpoch,
        uint256 indexed unlockEpoch
    );


    event PnlDistributed(address indexed sender, uint256 assets);
    event Pnlreclaimed(address indexed sender, uint256 assets);
 
    event AccPnlPerTokenUsedUpdated(
        address indexed sender,
        uint256 indexed newEpoch,
        uint256 prevPositiveOpenPnl,
        uint256 newPositiveOpenPnl,
        uint256 newEpochPositiveOpenPnl,
        int256 newAccPnlPerTokenUsed
    );

    error OnlyManager();
    error OnlyTradingPnlHandler();
    error AddressZero();
    error PriceZero();
    error ValueZero();
    error BytesZero();

    // Ownable
    error OwnableInvalidOwner(address owner);

    // ERC4626
    error ERC4626ExceededMaxDeposit();
    error ERC4626ExceededMaxMint();
    error ERC4626ExceededMaxWithdraw();
    error ERC4626ExceededMaxRedeem();
}
