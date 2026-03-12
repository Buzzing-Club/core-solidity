// SPDX-License-Identifier: AGPL-3.0-or-later

pragma solidity ^0.8.20;
import {ERC20Upgradeable, IERC20Upgradeable, IERC20MetadataUpgradeable} from "./openzeppelin-contracts-upgradeable/lib/openzeppelin-contracts/contracts/token/ERC20/ERC20Upgradeable.sol";
import {ERC4626Upgradeable, SafeERC20Upgradeable} from "./openzeppelin-contracts-upgradeable/lib/openzeppelin-contracts/contracts/token/ERC20/extensions/ERC4626Upgradeable.sol";
import "./openzeppelin-contracts-upgradeable/contracts/proxy/utils/Initializable.sol";
import "./openzeppelin-contracts-upgradeable/lib/openzeppelin-contracts/contracts/utils/math/MathUpgradeable.sol";
import './interfaces/IDynamicFeeManager.sol';
import "./interfaces/IBLPToken.sol";


interface IERC20{
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function burn(address from, uint256 amount) external;
    function mint(address to, uint256 amount) external;
}
interface IERC1271 {
    function isValidSignature(
        bytes32,
        bytes memory
    ) external view returns (bytes4);
}

interface UsdbLike {
    function transfer(address, uint256) external;
    function transferFrom(address, address, uint256) external;
    function distribute(address, uint256) external;
}
contract tBLP is ERC20Upgradeable, ERC4626Upgradeable,IBLPToken {
    using MathUpgradeable for uint256;
    // --- Storage Variables ---
    mapping (address => uint256) public wards;

    UsdbLike public usdb;
    address public usdbTokenAddress;
    address public pnlHandler;
    // Price state
    uint256 constant PRECISION_18 = 1e18;
    uint256 public shareToAssetsPrice; 
    int256 public accPnlPerTokenUsed;
    int256 public accPnlPerToken; 
    uint256 public accRewardsPerToken; 
    uint256 public totalDeposited;

    // --- Events ---

    // Admin
    event Rely(address indexed usr);
    event Deny(address indexed usr);

    // Buzzing
    event BuyYes(uint256 amountIn, uint256 amountOut,address pool, address recipient);
    event SellYes(uint256 amountIn, uint256 amountOut,address pool, address recipient);
    event BuyNo(uint256 amountIn, uint256 amountOut,address pool, address recipient);
    event SellNo(uint256 amountIn, uint256 amountOut,address pool, address recipient);
    event IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);

    // --- Modifiers ---

    modifier auth {
        require(wards[msg.sender] == 1, "tBLP/not-authorized");
        _;
    }
    function _blockTimestamp() internal view virtual returns (uint256) {
        return block.timestamp;
    }
    modifier checkDeadline(uint256 deadline) {
        require(_blockTimestamp() <= deadline, 'Transaction too old');
        _;
    }
   modifier checks(uint256 assetsOrShares) {
        _checks(assetsOrShares);
        _;
    }

    function _checks(uint256 assetsOrShares) private view {
        require(shareToAssetsPrice != 0, "shareToAssetsPrice is zero");
        require(assetsOrShares != 0, "assetsOrShares is zero");
    }
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers(); // Avoid initializing in the context of the implementation
    }
    // --- Upgradability ---

    function initialize(address _usdb) initializer external {
        __ERC20_init('tBLP token', 'tBLP');
        __ERC4626_init(IERC20MetadataUpgradeable(_usdb));
        wards[msg.sender] = 1;
        usdb = UsdbLike(_usdb);
        usdbTokenAddress = _usdb;
        shareToAssetsPrice = PRECISION_18;
        emit Rely(msg.sender);
    }

    // --- Admin external functions ---

    function rely(address usr) external auth {
        wards[usr] = 1;
        emit Rely(usr);
    }

    function deny(address usr) external auth {
        wards[usr] = 0;
        emit Deny(usr);
    }
    function setPnlhandler(address _pnlHandler) external auth{
        pnlHandler = _pnlHandler;
    }
    // --- ERC-4626 ---
    function decimals() public view override(ERC20Upgradeable, ERC4626Upgradeable) returns (uint8) {
        return ERC4626Upgradeable.decimals();
    }
    function _assetIERC20() private view returns (IERC20Upgradeable) {
        return IERC20Upgradeable(asset());
    }
    function _convertToShares(
        uint256 assets,
        MathUpgradeable.Rounding rounding
    ) internal view override returns (uint256 shares) {
        return assets.mulDiv(PRECISION_18, shareToAssetsPrice, rounding);
    }

    function _convertToAssets(
        uint256 shares,
        MathUpgradeable.Rounding rounding
    ) internal view override returns (uint256 assets) {
        
        if (shares == type(uint256).max && shareToAssetsPrice >= PRECISION_18) {
            return shares;
        }
        return shares.mulDiv(shareToAssetsPrice, PRECISION_18, rounding);
    }

    function maxMint(address) public view override returns (uint256) {
        return type(uint256).max;
    }

    function maxDeposit(address) public view override returns (uint256) {
        return type(uint256).max;
    }

    function maxRedeem(address owner) public view override returns (uint256) {
        return balanceOf(owner);
    }

    function maxWithdraw(address owner) public view override returns (uint256) {
        return _convertToAssets(maxRedeem(owner), MathUpgradeable.Rounding.Down);
    }

    // Override ERC-4626 interactions (call scaleVariables on every deposit / withdrawal)
    function deposit(uint256 assets, address receiver) public override checks(assets) returns (uint256) {
        if (assets > maxDeposit(receiver)) revert ERC4626ExceededMaxDeposit();
        if (_msgSender() != pnlHandler) revert OnlyTradingPnlHandler();
        uint256 shares = previewDeposit(assets);
        scaleVariables(shares, assets, true);
        //totalDeposited += assets;
        _deposit(_msgSender(), receiver, assets, shares);
        return shares;
    }

    function mint(uint256 shares, address receiver) public override checks(shares) returns (uint256) {
        if (shares > maxMint(receiver)) revert ERC4626ExceededMaxMint();
        if (_msgSender() != pnlHandler) revert OnlyTradingPnlHandler();
        uint256 assets = previewMint(shares);
        scaleVariables(shares, assets, true);
        //totalDeposited += assets;
        _deposit(_msgSender(), receiver, assets, shares);
        return assets;
    }

    function withdraw(
        uint256 assets,
        address receiver,
        address owner
    ) public override checks(assets) returns (uint256) {
        if (assets > maxWithdraw(owner)) revert ERC4626ExceededMaxWithdraw();
        if (_msgSender() != pnlHandler) revert OnlyTradingPnlHandler();
        uint256 shares = previewWithdraw(assets);

        scaleVariables(shares, assets, false);
        //totalDeposited -= assets;
        _withdraw(_msgSender(), receiver, owner, assets, shares);
        return shares;
    }

    function redeem(uint256 shares, address receiver, address owner) public override checks(shares) returns (uint256) {
        if (shares > maxRedeem(owner)) revert ERC4626ExceededMaxRedeem();
        if (_msgSender() != pnlHandler) revert OnlyTradingPnlHandler();
        uint256 assets = previewRedeem(shares);
        scaleVariables(shares, assets, false);
        //totalDeposited -= assets;
        _withdraw(_msgSender(), receiver, owner, assets, shares);
        return assets;
    }

    function scaleVariables(uint256 shares, uint256 assets, bool isDeposit) private {
        uint256 supply = totalSupply();

        if (accPnlPerToken < 0) {
            if (!isDeposit && shares == supply) {
                accPnlPerToken = 0;
                updateShareToAssetsPrice();
                totalDeposited = totalDeposited - assets;
                return;
            }
            accPnlPerToken =
                (accPnlPerToken * int256(supply)) /
                (isDeposit ? int256(supply + shares) : int256(supply - shares));
        } 

        totalDeposited = isDeposit ? totalDeposited + assets : totalDeposited - assets;
    }
    //vault interaction
    function distributePnl(uint256 assets) external {
        address sender = _msgSender();
        if (sender != pnlHandler) revert OnlyTradingPnlHandler();
        accPnlPerToken += int256((assets * PRECISION_18) / totalSupply());
        updateShareToAssetsPrice();

        emit PnlDistributed(sender, assets);
    }
    function reclaimPnl(uint256 assets) external  {
        address sender = _msgSender();
        if (sender != pnlHandler) revert OnlyTradingPnlHandler();

        int256 accPnlDelta = int256((assets * PRECISION_18) / totalSupply());
        accPnlPerToken -= accPnlDelta;
        updateShareToAssetsPrice();
        emit Pnlreclaimed(sender, assets);
    }

    function updateShareToAssetsPrice() private {
        shareToAssetsPrice = AccPnlPerToken(); 
        emit ShareToAssetsPriceUpdated(shareToAssetsPrice);
    }
    function AccPnlPerToken() public view returns (uint256) {
        if (accPnlPerToken >= 0) {

            return PRECISION_18 + uint256(accPnlPerToken);

        } else {

            return PRECISION_18 - uint256(-accPnlPerToken);

        }
    }
    // PnL interactions (happens often, so also used to trigger other actions)
    // function sendAssets(uint256 assets, address receiver) external {
    //     address sender = _msgSender();
    //     if (sender != pnlHandler) revert OnlyTradingPnlHandler();

    //     int256 accPnlDelta = int256(
    //         assets.mulDiv(
    //             PRECISION_18,
    //             totalSupply(),
    //             MathUpgradeable.Rounding.Up
    //         )
    //     );
    //     accPnlPerToken += accPnlDelta;
    //     SafeERC20Upgradeable.safeTransfer(_assetIERC20(), receiver, assets);

    //     emit AssetsSent(sender, receiver, assets);
    // }

    function setUSDB(address _USDB) public auth{
        usdb = UsdbLike(_USDB);
    }
    function marketCap() public view returns (uint256) {
        return (totalSupply() * shareToAssetsPrice) / PRECISION_18; // collateralConfig.precision
    }

}
