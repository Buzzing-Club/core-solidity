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

    function sendAssets(uint256 assets, address receiver) external;

    function distributePnl(uint256 assets) external;

    function marketCap() external view returns (uint256);

    function shareToAssetsPrice() external view returns (uint256);

    event ManagerUpdated(address newValue);
    event AdminUpdated(address newValue);
    event PnlHandlerUpdated(address newValue);
    event OpenTradesPnlFeedUpdated(address newValue);

    event WithdrawLockThresholdsPUpdated(uint256[2] newValue);
    event MaxAccOpenPnlDeltaUpdated(uint256 newValue);
    event MaxDailyAccPnlDeltaUpdated(uint256 newValue);
    event MaxSupplyIncreaseDailyPUpdated(uint256 newValue);
    event LossesBurnPUpdated(uint256 newValue);
    event MaxGnsSupplyMintDailyPUpdated(uint256 newValue);
    event MaxDiscountPUpdated(uint256 newValue);
    event MaxDiscountThresholdPUpdated(uint256 newValue);

    event CurrentMaxSupplyUpdated(uint256 newValue);
    event DailyAccPnlDeltaReset();
    event ShareToAssetsPriceUpdated(uint256 newValue);
    event OpenTradesPnlFeedCallFailed();

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

    event AssetsSent(address indexed sender, address indexed receiver, uint256 assets);
    event AssetsReceived(address indexed sender, address indexed user, uint256 assets, uint256 assetsLessDeplete, bool burn);

    event Depleted(address indexed sender, uint256 assets, uint256 amountGns);
    event Refilled(address indexed sender, uint256 assets, uint256 amountGns);
 
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
    error OnlyPnlFeed();
    error AddressZero();
    error PriceZero();
    error ValueZero();
    error BytesZero();
    error NoActiveDiscount();
    error BelowMin();
    error AboveMax();
    error WrongValue();
    error WrongValues();
    error GnsPriceCallFailed();
    error GnsTokenPriceZero();
    error PendingWithdrawal();
    error EndOfEpoch();
    error NotAllowed();
    error NoDiscount();
    error NotUnlocked();
    error NotEnoughAssets();
    error MaxDailyPnl();
    error NotUnderCollateralized();
    error AboveInflationLimit();

    // Ownable
    error OwnableInvalidOwner(address owner);

    // ERC4626
    error ERC4626ExceededMaxDeposit();
    error ERC4626ExceededMaxMint();
    error ERC4626ExceededMaxWithdraw();
    error ERC4626ExceededMaxRedeem();
}
