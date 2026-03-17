// SPDX-License-Identifier: AGPL-3.0-or-later

pragma solidity 0.8.20;

import "./openzeppelin-contracts-upgradeable/contracts/proxy/utils/Initializable.sol";
import "./openzeppelin-contracts-upgradeable/lib/openzeppelin-contracts/contracts/utils/math/MathUpgradeable.sol";
import './interfaces/IDynamicFeeManager.sol';
import "./libraries/ExposureLib.sol";

interface INonfungiblePositionManager {
    struct CollectParams {
        uint256 tokenId;
        address recipient;
        uint128 amount0Max;
        uint128 amount1Max;
    }
    function mint(MintParams calldata params)
    external
    payable
    returns (
        uint256 tokenId,
        uint128 liquidity,
        uint256 amount0,
        uint256 amount1
    );
    function decreaseLiquidity(DecreaseLiquidityParams calldata params)
        external
        payable
        returns (uint256 amount0, uint256 amount1);
    function decreaseLiquidityAdv(DecreaseLiquidityParams calldata params)
        external
        payable
        returns (uint256 amount0, uint256 amount1);
    
    function collect(CollectParams calldata params) external payable returns (uint256 amount0, uint256 amount1);
    function positions(uint256 tokenId)
        external
        view
        returns (
            uint96 nonce,
            address operator,
            address token0,
            address token1,
            uint24 fee,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity,
            uint256 feeGrowthInside0LastX128,
            uint256 feeGrowthInside1LastX128,
            uint128 tokensOwed0,
            uint128 tokensOwed1
        );
}

interface ISwapRouter{
    function exactOutputSingle(ExactOutputSingleParams calldata params) external payable returns (uint256 amountIn);
    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}
interface IERC20{
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function burn(address from, uint256 amount) external;
    function mint(address to, uint256 amount) external;
    function LPdeposit(address to, uint256 amount) external;
    function balanceOf(address to) external returns (uint256);
    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external;
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
    function burn(address from, uint256 amount) external;
}

//--interface for buzzing ---
interface CTF {
    function splitPosition(
        IERC20 collateralToken,
        bytes32 parentCollectionId,
        bytes32 conditionId,
        uint[] calldata partition,
        uint amount
    ) external;
    function mergePositions(
        IERC20 collateralToken,
        bytes32 parentCollectionId,
        bytes32 conditionId,
        uint[] calldata partition,
        uint amount
    ) external;
    function safeTransferFrom(address from, address to, uint256 id, uint256 value, bytes calldata data) external;
    function balanceOf(address owner, uint256 id) external returns (uint256);
}
interface Wrapped1155Factory{
    function getWrapped1155(
        address multiToken,
        uint256 tokenId,
        bytes memory data
    )
        external
        view
        returns (address);

    function unwrap(
        address multiToken,
        uint256 tokenId,
        uint256 amount,
        address recipient,
        bytes calldata data
    ) external;
}

interface SwapPool{
    function slot0()
        external
        view
        returns (
            uint160 sqrtPriceX96,
            int24 tick,
            uint16 observationIndex,
            uint16 observationCardinality,
            uint16 observationCardinalityNext,
            uint32 feeProtocol,
            bool unlocked
        );
    function token0() external view returns (address);
}
interface IFeeAdapter {
    function recordFee(
        address pool,
        address refer,
        address token,
        uint256 totalFeeAmount
    ) external;
    function poolTotalFeeRatio(address pool) external view returns (uint256);
    function poolRoleShares(address pool, bytes32 role) external view returns (uint256 share);
}
interface IYieldProtocol {
    function deposit(uint256 assets, address receiver) external returns (uint256);
    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256);
    function redeem(uint256 shares, address receiver, address owner) external returns (uint256);
    function maxWithdraw(address owner) external returns (uint256);
    function previewWithdraw(uint256 assets) external returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function convertToAssets(uint256 shares) external view returns (uint256);
}
interface IBLPToken {
    function marketCap() external view returns (uint256);
    function totalDeposited() external view returns (uint256);
    function distributePnl(uint256 assets) external;
    function reclaimPnl(uint256 assets) external;
    function deposit(uint256 assets, address receiver) external returns (uint256);
    function withdraw(uint256 assets,address receiver,address owner) external returns (uint256);
}
struct SplitPositionParams {
    IERC20 collateralToken;
    bytes32 parentCollectionId;
    bytes32 conditionId;
    uint[] partition;
    uint amount;
}

struct ERC1155TransferParams {
    address from;
    address to;
    uint256 id; 
    uint256 value;
    bytes data;
}
struct UnwrappedParams {
    address multiToken;
    uint256 tokenId; 
    uint256 amount;
    address recipient;
    bytes data;
}
struct MintParams {
    address token0;
    address token1;
    uint24 fee;
    int24 tickLower;
    int24 tickUpper;
    uint256 amount0Desired;
    uint256 amount1Desired;
    uint256 amount0Min;
    uint256 amount1Min;
    address recipient;
    uint256 deadline;
}
struct DecreaseLiquidityParams {
    uint256 tokenId;
    uint128 liquidity;
    uint256 amount0Min;
    uint256 amount1Min;
    uint256 deadline;
}



struct ExactInputSingleParams {
    address tokenIn;
    address tokenOut;
    uint24 fee;
    address recipient;
    uint256 deadline;
    uint256 amountIn;
    uint256 amountOutMinimum;
    uint160 sqrtPriceLimitX96;
}

struct ExactOutputSingleParams {
    address tokenIn;
    address tokenOut;
    uint24 fee;
    address recipient;
    uint256 deadline;
    uint256 amountOut;
    uint256 amountInMaximum;
    uint160 sqrtPriceLimitX96;
}
struct UserYesPosition {
    uint256 yesTokenAmount;  
    uint256 usdSpent;   
}
struct UserNoPosition {
    uint256 noTokenAmount;  
    uint256 usdSpent;   
}
struct Permit {
    address owner;
    address spender;
    uint256 value;
    uint256 deadline;
    uint8 v;
    bytes32 r;
    bytes32 s;
}
contract tradeManager2 is Initializable {
    using MathUpgradeable for uint256;
    // --- Storage Variables ---

    // Admin
    mapping (address => uint256) public wards;

    // --- Constants ---
    uint256 PRECISION ;
    uint256 reportCount;
    // --- Immutables ---

    // Savings yield

    UsdbLike public usdb;
    // Buzzing
    bytes32 internal constant POOL_INIT_CODE_HASH = 0xd0994b279f6cb816ee7d1763d7420e40973803132c6737b74c0734eb4837d2f0;
    uint256 public constant FEE_SCALE = 1_000_000;
    address public NonfungiblePositionManager;
    address public SwapRouter;
    address public usdbTokenAddress;
    address public ctfAddress;
    address public feeAdapter;
    address public feeManager;
    address public yieldProtocol;
    address public erc1155Factory;
    address public deployer;
    uint256 public yieldPrincipal;
    uint256 public yieldPrincipalUsed;
    int256 public totalExposure;
    int256 public totalPnl;
    uint256 public bufferFunds;
    uint256 public yieldInterest;
    IERC20 public usdc;
    mapping(address => uint256) public sellYesAmount;
    mapping(address => uint256) public sellNoAmount;
    mapping(address => uint256) public buyYesAmount;
    mapping(address => uint256) public buyNoAmount;
    mapping(address => uint256) public sellYesUSD;
    mapping(address => uint256) public sellNoUSD;
    mapping(address => uint256) public buyYesUSD;
    mapping(address => uint256) public buyNoUSD;
    mapping(address => int256) public marketExposure;
    mapping(address => int256) public marketUSDB;
    mapping(address => uint256) public userRiskFreePrincipal;
    mapping(address => uint256) public userRiskPrincipal;
    mapping(address => mapping(address => UserYesPosition)) public userYesPositions; // user => pool => position
    mapping(address => mapping(address => UserNoPosition)) public userNoPositions;   // user => pool => position
    mapping(address => uint256) public reportedCounts;
    mapping(address => address) public refers;
    //vault
    address public tBLP;
    address public sBLP;
    int256 public RiskCoefficient;
    int256 public riskThreshold;
    //liquidity
    mapping(uint256 => address) public tokenOwnership; // tokenId => owner


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
    event PnLHandled(int256 indexed totalPnl, int256 sBLPPnl, int256 tBLPPnl);
    event MarketReported(
    address indexed reporter,
    address indexed pool,
    bool isYes,
    uint256 reportIndex
);
    event ReferSet(address indexed user, address indexed referrer);
    event UserWithdraw(
        address indexed owner,
        address indexed receiver,
        uint256 assets
    );

    // --- Modifiers ---

    modifier auth {
        require(wards[msg.sender] == 1, "TNA");
        _;
    }
    function _blockTimestamp() internal view virtual returns (uint256) {
        return block.timestamp;
    }
    modifier checkDeadline(uint256 deadline) {
        require(_blockTimestamp() <= deadline, 'TTO');
        _;
    }
    function setFeeAdapter(address _feeAdapter) auth external {
        feeAdapter = _feeAdapter;
    }
    function setFeeManager(address _feeManager) auth external {
        feeManager = _feeManager;
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
    // --- Upgradability ---
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers(); // Avoid initializing in the context of the implementation
    }
    function initialize(address _usdb , address _usdcTokenAddress, address _NonfungiblePositionManager, address _ctf, address _swaprouter,address _tBLP,address _sBLP,address _erc1155Factory,address _deployer) initializer external {
        wards[msg.sender] = 1;
        usdb = UsdbLike(_usdb);
        
        usdbTokenAddress = _usdb;
        usdc = IERC20(_usdcTokenAddress);
        erc1155Factory = _erc1155Factory;
        NonfungiblePositionManager = _NonfungiblePositionManager;
        ctfAddress = _ctf;
        SwapRouter = _swaprouter;
        tBLP = _tBLP;
        sBLP = _sBLP;
        deployer = _deployer;
        PRECISION = 1e18;
        reportCount = 2;
        RiskCoefficient = 9 * 1e17;
        emit Rely(msg.sender);
    }

    // --- BUZZING---
    function addLiquidity(MintParams calldata mintParams,
                          SplitPositionParams calldata splitPositionParmas,
                          ERC1155TransferParams calldata transferParmas,
                          address ERC1155Factory,
                          address poolAddress,
                          bool isYes,
                          uint256 initialTokenAmount,
                          uint256 initialUsdCost,
                          uint256 usdbForLiquidity)
        external
        checkDeadline(mintParams.deadline)
        auth
        returns (
            uint256 tokenId,
            uint128 liquidity,
            uint256 amount0,
            uint256 amount1
        )
    {
        require(ERC1155Factory == erc1155Factory,"IF");
        _exposureCheck();
        IERC20(usdbTokenAddress).mint(address(this), splitPositionParmas.amount + usdbForLiquidity);   
        IERC20(splitPositionParmas.collateralToken).approve(ctfAddress, type(uint256).max);
        
        
        
        CTF(ctfAddress).splitPosition(splitPositionParmas.collateralToken, 
                                      splitPositionParmas.parentCollectionId, 
                                      splitPositionParmas.conditionId, 
                                      splitPositionParmas.partition, 
                                      splitPositionParmas.amount);
        //get wrapped erc1155 from factory ,transfer without approve
        
        
        CTF(ctfAddress).safeTransferFrom(transferParmas.from, 
                                         transferParmas.to, 
                                         transferParmas.id, 
                                         transferParmas.value, 
                                         transferParmas.data);
        address wrappedERC1155Address = Wrapped1155Factory(ERC1155Factory).getWrapped1155(ctfAddress,transferParmas.id, transferParmas.data);
        // max approve for mint
        
        IERC20(wrappedERC1155Address).approve(NonfungiblePositionManager,type(uint256).max);
        
        IERC20(splitPositionParmas.collateralToken).approve(NonfungiblePositionManager,type(uint256).max);
        
        (tokenId, liquidity,amount0, amount1) = INonfungiblePositionManager(NonfungiblePositionManager).mint(mintParams); 
        tokenOwnership[tokenId] = mintParams.recipient;
        if (wards[mintParams.recipient] != 1) {
            if (isYes) {
                UserYesPosition storage yesPos = userYesPositions[mintParams.recipient][poolAddress];
                yesPos.yesTokenAmount += initialTokenAmount;
                yesPos.usdSpent += initialUsdCost;
            } else {
                UserNoPosition storage noPos = userNoPositions[mintParams.recipient][poolAddress];
                noPos.noTokenAmount += initialTokenAmount;
                noPos.usdSpent += initialUsdCost;
            }
        }
        emit IncreaseLiquidity(tokenId, liquidity, amount0, amount1);
        
    }
    function decreaseLiquidity(DecreaseLiquidityParams calldata params) external auth()
    {
        INonfungiblePositionManager(NonfungiblePositionManager).decreaseLiquidity(params);
    
    }
    
    function decreaseLiquidityForNoLp(
        DecreaseLiquidityParams calldata params,
        ERC1155TransferParams calldata transferParams,
        uint256 noPositionId,
        bool adv
    ) public returns (uint256 amount0, uint256 amount1,uint256 transferAmount) {
        INonfungiblePositionManager npm =
            INonfungiblePositionManager(NonfungiblePositionManager);

        // 1. decrease liquidity
        if(adv){
            npm.decreaseLiquidityAdv(params);
            
        }else{
            npm.decreaseLiquidity(params);
        }
        
        // 2. collect
        (amount0, amount1) = npm.collect(
            INonfungiblePositionManager.CollectParams({
                tokenId: params.tokenId,
                recipient: address(this),
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );

        // 3. read tokens
        (, , address token0, address token1, , , , , , , , ) =
            npm.positions(params.tokenId);

        // 4. decide which amount to use
        uint256 amountOut;
        uint256 usdbAmount;
        if (token0 != usdbTokenAddress) {
            amountOut = amount0;
            usdbAmount = amount1;
        } else if (token1 != usdbTokenAddress) {
            amountOut = amount1;    
            usdbAmount = amount0;
        } 
        transferAmount = amountOut < (CTF(ctfAddress).balanceOf(address(this), noPositionId))
    ? amountOut
    : CTF(ctfAddress).balanceOf(address(this), noPositionId);
        // 5. transfer ERC1155
        CTF(ctfAddress).safeTransferFrom(
            address(this),
            transferParams.to,
            transferParams.id,
            transferAmount,
            transferParams.data
        );

        // 6. get wrapped NO token
        address noToken = Wrapped1155Factory(erc1155Factory).getWrapped1155(
            ctfAddress,
            noPositionId,
            transferParams.data
        );

        // 7. transfer NO token
        IERC20(noToken).transfer(tokenOwnership[params.tokenId], transferAmount);
        IERC20(usdbTokenAddress).transfer(tokenOwnership[params.tokenId], usdbAmount);
        return (amount0, amount1,transferAmount);
    }

    function _pullTokenWithOptionalPermit(
        address token,
        uint256 amount,
        Permit calldata permitparams
    ) internal {
        if (permitparams.owner != msg.sender) {
            require(wards[msg.sender] == 1);
            IERC20(token).permit(
                permitparams.owner,
                permitparams.spender,
                permitparams.value,
                permitparams.deadline,
                permitparams.v,
                permitparams.r,
                permitparams.s
            );
        }
        IERC20(token).transferFrom(permitparams.owner, address(this), amount);
    }

    function _absTickDelta(int24 tickBeforeSwap, int24 tickAfterSwap) internal pure returns (uint256) {
        return tickBeforeSwap > tickAfterSwap
            ? uint256(int256(tickBeforeSwap) - int256(tickAfterSwap))
            : uint256(int256(tickAfterSwap) - int256(tickBeforeSwap));
    }

    function _settlePoolFees(
        address pool,
        address owner,
        uint256 grossPayout,
        uint256 feeBaseAmount,
        uint256 feeInputAmount,
        int24 tickAfterSwap,
        uint256 ticksCrossed
    ) internal {
        IFeeManager feeMgr = IFeeManager(feeManager);
        feeMgr.updateVolatility(pool, tickAfterSwap, ticksCrossed);
        uint256 dynamicfee = feeMgr.computeFee(pool, ticksCrossed, feeInputAmount);

        IFeeAdapter feeAdpt = IFeeAdapter(feeAdapter);
        uint256 feeRatio = feeAdpt.poolTotalFeeRatio(pool);
        uint256 totalFeeAmount = feeBaseAmount * feeRatio / FEE_SCALE;
        uint256 totalCharged = totalFeeAmount + dynamicfee;

        IERC20(usdbTokenAddress).transfer(owner, grossPayout - totalCharged);
        IERC20(usdbTokenAddress).transfer(feeAdapter, totalCharged);
        feeAdpt.recordFee(pool, refers[owner], usdbTokenAddress, totalCharged);
    }

    function buyYes(ExactInputSingleParams calldata params, address pool, uint256 minAmount,address receiver,Permit calldata permitparams) external {
        _checkaddress(pool,params.tokenIn,params.tokenOut,params.fee);
        _checkPool(pool);
        _pullTokenWithOptionalPermit(usdbTokenAddress, params.amountIn, permitparams);
        // require(params.tokenIn == usdbTokenAddress);

        IERC20(params.tokenIn).approve(SwapRouter,type(uint256).max);   

        uint256 amountOut = ISwapRouter(SwapRouter).exactInputSingle(params);
        _tickcheck(pool);
        //user position update
        UserYesPosition storage pos = userYesPositions[permitparams.owner][pool];
        pos.yesTokenAmount += amountOut;
        pos.usdSpent += params.amountIn;
        buyYesAmount[pool] = buyYesAmount[pool] +  amountOut;
        buyYesUSD[pool] = buyYesUSD[pool] +  params.amountIn;
        require(amountOut >= minAmount,"yne");
        _postTradeExposureChecks(pool);
        emit BuyYes(params.amountIn, amountOut, pool, permitparams.owner);
    }

    function sellYes(ExactInputSingleParams calldata params, address pool, uint256 minAmount,address referrer,Permit calldata permitparams) external {
        //tokenIn always wrapped1155
        _checkaddress(pool,params.tokenIn,params.tokenOut,params.fee);
        _checkPool(pool);
        _pullTokenWithOptionalPermit(params.tokenIn, params.amountIn, permitparams);
        //require(params.tokenIn != usdbTokenAddress);
        IERC20(params.tokenIn).approve(SwapRouter,type(uint256).max); 
        
        (,int24 tickBeforeSwap, , , , , ) = SwapPool(pool).slot0();      
        
        uint256 amountOut = ISwapRouter(SwapRouter).exactInputSingle(params);
        
        (,int24 tickAfterSwap, , , , , ) = SwapPool(pool).slot0();  
        uint256 ticksCrossed = _absTickDelta(tickBeforeSwap, tickAfterSwap);
        _settlePoolFees(pool, permitparams.owner, amountOut, amountOut, amountOut, tickAfterSwap, ticksCrossed);
        sellYesAmount[pool] = sellYesAmount[pool] +  params.amountIn;
        sellYesUSD[pool] = sellYesUSD[pool] +  amountOut ;
        require(amountOut >= minAmount,"une");

        //exposure check
        _postTradeExposureChecks(pool);
        UserYesPosition storage pos = userYesPositions[permitparams.owner][pool];
        uint256 avgPrice = pos.usdSpent * PRECISION / pos.yesTokenAmount;
       
        uint256 sellPrice = amountOut * PRECISION / params.amountIn;
        
        int256 pnl = ((int256(sellPrice) - int256(avgPrice))  * int256(params.amountIn) / int256(PRECISION));
        
        _handlePnl(pnl); 
        uint256 costReduced = pos.usdSpent * params.amountIn / pos.yesTokenAmount;
        pos.yesTokenAmount -= params.amountIn;
        pos.usdSpent -= costReduced;
        
        emit SellYes(params.amountIn, amountOut, pool, permitparams.owner);
    }

    function buyNo(ExactInputSingleParams calldata params,                           
                   SplitPositionParams calldata splitPositionParmas,
                   ERC1155TransferParams calldata transferParmas,
                   uint256 noPositionId,
                   address ERC1155Factory,
                   address pool,
                   uint256 maxAmount,
                   address receiver,
                   Permit calldata permitparams) 
                   external 
    {
        require(ERC1155Factory == erc1155Factory,"IF");
        _checkaddress(pool,params.tokenIn,params.tokenOut,params.fee);
        _checkPool(pool);
        _traderDeposit(address(this), params.amountIn);
        //tokenIn always not usd
        //require(params.tokenIn != usdbTokenAddress);
        IERC20(usdbTokenAddress).approve(ctfAddress, type(uint256).max);
        CTF(ctfAddress).splitPosition(splitPositionParmas.collateralToken, 
                                      splitPositionParmas.parentCollectionId, 
                                      splitPositionParmas.conditionId, 
                                      splitPositionParmas.partition, 
                                      params.amountIn); 
        //transfer no to factory to get erc20
        CTF(ctfAddress).safeTransferFrom(address(this), 
                                         transferParmas.to, 
                                         noPositionId, 
                                         params.amountIn, 
                                         transferParmas.data); 
        address noTokenAddress = Wrapped1155Factory(ERC1155Factory).getWrapped1155(ctfAddress,noPositionId, transferParmas.data);  
        //transfer erc20 notoken to user
        IERC20(noTokenAddress).transfer(receiver,params.amountIn);  

        //get wrapped erc1155 from factory ,transfer without approve
        CTF(ctfAddress).safeTransferFrom(address(this), 
                                         transferParmas.to, 
                                         transferParmas.id, 
                                         params.amountIn, 
                                         transferParmas.data);

        address wrappedERC1155Address = Wrapped1155Factory(ERC1155Factory).getWrapped1155(ctfAddress,transferParmas.id, transferParmas.data);
        // max approve for swap yes to usd
        IERC20(wrappedERC1155Address).approve(SwapRouter,type(uint256).max);

        uint256 amountOut = ISwapRouter(SwapRouter).exactInputSingle(params);
        //pull usdb from user
        _pullTokenWithOptionalPermit(usdbTokenAddress, params.amountIn - amountOut, permitparams);
        IERC20(usdbTokenAddress).burn(address(this),params.amountIn);

        UserNoPosition storage pos = userNoPositions[permitparams.owner][pool];
        pos.noTokenAmount += params.amountIn;
        
        pos.usdSpent += params.amountIn - amountOut;
        
        buyNoAmount[pool] = buyNoAmount[pool] +  params.amountIn;
        buyNoUSD[pool] = buyNoUSD[pool] +  params.amountIn - amountOut;
        require(params.amountIn - amountOut < maxAmount,"tmu");
        _postTradeExposureChecks(pool);

        emit BuyNo(params.amountIn, amountOut, pool , permitparams.owner);
    }
    function sellNo(ExactOutputSingleParams calldata params, 
                    SplitPositionParams calldata splitPositionParmas, 
                    UnwrappedParams calldata unwrappedParams,
                    uint256 noPositionId,
                    address ERC1155Factory,
                    address pool,
                    uint256 minAmount,
                    address referrer,
                    Permit calldata permitparams) external 
    {
        require(ERC1155Factory == erc1155Factory,"IF");
        _checkaddress(pool,params.tokenIn,params.tokenOut,params.fee);
        _checkPool(pool);
        _traderDeposit(address(this), params.amountOut);
        //mint usdb for ctf

        IERC20(params.tokenIn).approve(SwapRouter,type(uint256).max);
        (,int24 tickBeforeSwap, , , , , ) = SwapPool(pool).slot0(); 
        uint256 amountIn = ISwapRouter(SwapRouter).exactOutputSingle(params);
        
        _tickcheck(pool);
        
        Wrapped1155Factory(ERC1155Factory).unwrap(unwrappedParams.multiToken, 
                                                  unwrappedParams.tokenId, 
                                                  params.amountOut, 
                                                  unwrappedParams.recipient, 
                                                  unwrappedParams.data);
        //transfer no to vault for merge
        //CTF(ctfAddress).safeTransferFrom(msg.sender, address(this), noPositionId, params.amountOut, "");
        address noTokenAddress = Wrapped1155Factory(ERC1155Factory).getWrapped1155(ctfAddress,noPositionId, unwrappedParams.data);  
        //transfer erc20 notoken to contract
        _pullTokenWithOptionalPermit(noTokenAddress, params.amountOut, permitparams);

        Wrapped1155Factory(ERC1155Factory).unwrap(unwrappedParams.multiToken, 
                                                  noPositionId, 
                                                  params.amountOut, 
                                                  unwrappedParams.recipient, 
                                                  unwrappedParams.data);

        CTF(ctfAddress).mergePositions(splitPositionParmas.collateralToken, 
                                      splitPositionParmas.parentCollectionId, 
                                      splitPositionParmas.conditionId, 
                                      splitPositionParmas.partition, 
                                      params.amountOut);
        
        
        //transfer usdc to user
        
        IERC20(usdbTokenAddress).burn(address(this),amountIn);
        (,int24 tickAfterSwap, , , , , ) = SwapPool(pool).slot0();  
        uint256 ticksCrossed = _absTickDelta(tickBeforeSwap, tickAfterSwap);
        uint256 userPayout = params.amountOut - amountIn;
        _settlePoolFees(pool, permitparams.owner, userPayout, userPayout, amountIn, tickAfterSwap, ticksCrossed);
        sellNoAmount[pool] = sellNoAmount[pool] +  params.amountOut;
        
        sellNoUSD[pool] = sellNoUSD[pool] +  params.amountOut - amountIn;
       
        _postTradeExposureChecks(pool);
        require(params.amountOut - amountIn >= minAmount,"une");
        //pnl calculation
        UserNoPosition storage pos = userNoPositions[permitparams.owner][pool];
        
        uint256 avgPrice = pos.usdSpent * PRECISION / pos.noTokenAmount;
    
        uint256 sellPrice = (params.amountOut - amountIn) * PRECISION / amountIn;
        
        int256 pnl = ((int256(sellPrice) - int256(avgPrice)) * int256(amountIn)  / int256(PRECISION));
        _handlePnl(pnl);
        uint256 costReduced = pos.usdSpent * params.amountOut / pos.noTokenAmount;
        pos.noTokenAmount -= params.amountOut;
        pos.usdSpent -= costReduced;
        emit SellNo(amountIn, params.amountOut, pool, permitparams.owner);
    }
    function _traderDeposit(address account,uint256 amount) internal{
        IERC20(usdbTokenAddress).mint(account,amount);
    }
    
    function onERC1155Received(
        address operator,
        address /* from */,
        uint256 id,
        uint256 value,
        bytes calldata data
    )
        external
        returns (bytes4)
    {
        return this.onERC1155Received.selector;
    }
    function onERC1155BatchReceived(
        address operator,
        address /* from */,
        uint256[] calldata ids,
        uint256[] calldata values,
        bytes calldata data
    )
        external
        returns (bytes4)
    {      
        return this.onERC1155BatchReceived.selector;
    }

    function _tickcheck(address pool) internal {
        int24 tickAfter;
        address token0;
        (, tickAfter, , , , , ) = SwapPool(pool).slot0();
        token0 = SwapPool(pool).token0();

        if (token0 == usdbTokenAddress) {
            //usdb is token0, base token , price -> 1 means tick < 0
            require(tickAfter > 0 ,"t<0");
        }
        else{
            //usdb is token1, quote token, price ->1 means tick > 0
            require(tickAfter < 0, "t>0");
        }
    }
    function _checkPool(address pool) internal {
        require(reportedCounts[pool] == 0, 'ISP');
    }
    function _checkaddress(address pool,address tokenIn,address tokenOut,uint24 fee) internal view {
        require(tokenIn == usdbTokenAddress || tokenOut == usdbTokenAddress,"usdbError");
        require(tokenIn != tokenOut, "sameToken");
        (address token0, address token1) = tokenIn < tokenOut ? (tokenIn, tokenOut) : (tokenOut, tokenIn);
        address expectedPool = address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(
                            hex"ff",
                            deployer,
                            keccak256(abi.encode(token0, token1, fee)),
                            POOL_INIT_CODE_HASH
                        )
                    )
                )
            )
        );
        require(pool == expectedPool, "PM");
    }

    function _postTradeExposureChecks(address pool) internal {
        _updateExposure(pool);
        _exposureCheck();
    }


//-------Yield---------
    function setYieldProtocol(address _yieldProtocol) auth public {
        yieldProtocol = _yieldProtocol;
    }
    function USDCdeposit(uint256 amount) auth external  {
      
        usdc.approve(yieldProtocol, amount);
      
        IYieldProtocol(yieldProtocol).deposit(amount,address(this));
        
        uint256 shares = IYieldProtocol(yieldProtocol).balanceOf(address(this)); 
       
        uint256 assets = IYieldProtocol(yieldProtocol).convertToAssets(shares);
        yieldPrincipalUsed = assets;
    }

    function USDCwithdraw(uint256 amount) auth external  {
        IYieldProtocol(yieldProtocol).withdraw(amount,address(this),address(this));
        uint256 shares = IYieldProtocol(yieldProtocol).balanceOf(address(this)); 
        uint256 assets = IYieldProtocol(yieldProtocol).convertToAssets(shares);
        yieldPrincipalUsed = assets;
    }
    function ERC20tranfser(address token,address to,uint256 amount) auth external {
        IERC20(token).transfer(to,amount);
    }

    //---Exposure---
    function _exposureCalculate(address pool) internal view returns (int256) {
        (int256 yesAmountDiff, int256 noAmountDiff, int256 usdDiff) = _exposureDiffs(pool);
        int256 yesExposure =  yesAmountDiff - usdDiff;
        int256 noExposure =   noAmountDiff - usdDiff;
        return yesExposure >= noExposure ? yesExposure : noExposure;
    }
    //for pnl calculation

    function exposureCalculate(address pool, bool isYes) internal view returns (int256) {
        (int256 yesAmountDiff, int256 noAmountDiff, int256 usdDiff) = _exposureDiffs(pool);

        int256 yesExposure = yesAmountDiff - usdDiff;
        int256 noExposure = noAmountDiff - usdDiff;

        if (isYes) {
            return yesExposure;
        } else {
            return noExposure;
        }
    }

    function _exposureDiffs(address pool) internal view returns (int256 yesAmountDiff, int256 noAmountDiff, int256 usdDiff) {
        yesAmountDiff = int256(buyYesAmount[pool]) - int256(sellYesAmount[pool]);
        noAmountDiff = int256(buyNoAmount[pool]) - int256(sellNoAmount[pool]);
        usdDiff = int256(buyYesUSD[pool]) + int256(buyNoUSD[pool]) - int256(sellYesUSD[pool]) - int256(sellNoUSD[pool]);
    }
    
    function _exposureCheck() internal {
        int256 availableFunds = _availableFunds();
        
        require(availableFunds >= 0 , 'AFunds < 0');
        require(totalExposure <= int256(availableFunds * RiskCoefficient / 1e18),'er');
        
    }
    function _updateExposure(address pool) internal {
        int256 exposurebefore = marketExposure[pool];
        totalExposure -= exposurebefore;
        int256 exposureafter = _exposureCalculate(pool);
        
        totalExposure += exposureafter;
        marketExposure[pool] = exposureafter; 

    }
    
    function _availableFunds() internal returns (int256) {
        //uint256 shares = IYieldProtocol(yieldProtocol).balanceOf(address(this)); 

        _handleInterest();
        int256 availableFunds = int256(IBLPToken(tBLP).marketCap()) + int256(IBLPToken(sBLP).marketCap()) - int256(IBLPToken(sBLP).totalDeposited());

        return availableFunds;
    }
    function _handlePnl(int256 pnl) internal {
       
        int256 tBLPPnl = pnl * RiskCoefficient / 1e18;
        
        int256 sBLPPnl = pnl - tBLPPnl;
        
        //require(pnl != 0);
       
        if (pnl < 0){
            uint256 tBLPAmount = uint256(-tBLPPnl);
            uint256 sBLPAmount = uint256(-sBLPPnl);
            // User loss / LP gain: increase vault assets to match higher share price.
            IERC20(usdbTokenAddress).mint(tBLP, tBLPAmount);
            IERC20(usdbTokenAddress).mint(sBLP, sBLPAmount);
            
            IBLPToken(tBLP).distributePnl(tBLPAmount);
            
            IBLPToken(sBLP).distributePnl(sBLPAmount);
            
        }
        else if (pnl > 0){
            uint256 tBLPAmount = uint256(tBLPPnl);
            uint256 sBLPAmount = uint256(sBLPPnl);
            // User gain / LP loss: decrease vault assets to match lower share price.
            IERC20(usdbTokenAddress).burn(tBLP, tBLPAmount);
            IERC20(usdbTokenAddress).burn(sBLP, sBLPAmount);
            
            IBLPToken(tBLP).reclaimPnl(tBLPAmount);
            IBLPToken(sBLP).reclaimPnl(sBLPAmount);
            
        }
        totalPnl += pnl;
        
        emit PnLHandled(pnl, sBLPPnl, tBLPPnl);
    }

    function handleMarketPnl(address pool,bool isYes) external auth() {
        int256 marketPnl = exposureCalculate(pool,isYes);
        _handlePnl(marketPnl);
    }
    function _handleInterest() internal {
        
        uint256 shares = IYieldProtocol(yieldProtocol).balanceOf(address(this)); 
        uint256 assets = IYieldProtocol(yieldProtocol).convertToAssets(shares);
        int256 interest = int256(assets) - int256(yieldPrincipalUsed);
        yieldPrincipalUsed = assets;
        // Keep yieldInterest idle for now; this path can produce negative interest.
        _handlePnl(-interest);
    }
    function marketReport(address pool,bool isYes) external auth() {
        require(reportedCounts[pool] < reportCount, 'ME');
        reportedCounts[pool] = reportedCounts[pool] + 1;
        if(reportedCounts[pool] == reportCount ){
            int256 marketPnl = exposureCalculate(pool,isYes);
            _handlePnl(marketPnl);
            totalExposure -= _exposureCalculate(pool);
        }
        emit MarketReported(msg.sender, pool, isYes, reportedCounts[pool]);
        
    }
    function LPDeposit(uint256 assets, address receiver,bool isRisk) public {
        IERC20 usdbToken = IERC20(address(usdb));
        usdbToken.transferFrom(msg.sender,address(this),assets);
        if(isRisk){
            IERC20(usdbTokenAddress).approve(tBLP, assets);
            IBLPToken(tBLP).deposit(assets, receiver);
        }
        else{
            IERC20(usdbTokenAddress).approve(sBLP, assets);
            IBLPToken(sBLP).deposit(assets, receiver);
        }
    }
    function LPWithdraw(uint256 assets, address receiver,address owner,bool isRisk) public {
        _withdrawcheck(assets);
        require(msg.sender == owner, "NA");

        if(isRisk){
            IBLPToken(tBLP).withdraw(assets, receiver, owner);
        }
        else{
            IBLPToken(sBLP).withdraw(assets, receiver, owner);
        }
        
    }
    function userWithdraw(
        uint256 assets,
        address receiver,
        address owner
    ) public {

        require(msg.sender == owner, "NA");

        // check current USDC balance in vault
        uint256 currentBalance = usdc.balanceOf(address(this));

        // if not enough, withdraw from yield protocol
        if (currentBalance < assets) {

            uint256 need = assets - currentBalance;

            IYieldProtocol(yieldProtocol).withdraw(need,address(this),address(this));

            // Sync yield principal snapshot after a yield withdrawal.
            uint256 shares = IYieldProtocol(yieldProtocol).balanceOf(address(this));
            yieldPrincipalUsed = IYieldProtocol(yieldProtocol).convertToAssets(shares);

            // refresh balance after withdraw
            currentBalance = usdc.balanceOf(address(this));

            require(currentBalance >= assets, "IU");
        }
        // transfer USDC to user
        bool success = usdc.transfer(receiver, assets);
        // burn user's USDB
        usdb.burn(owner, assets);

        require(success, "UTF");

        emit UserWithdraw(owner, receiver, assets);
    }
    function _withdrawcheck(uint256 assets) internal {
        int256 dynamicReservedFunds = RiskCoefficient  * _availableFunds() / 1e18;
        require(dynamicReservedFunds - int256(assets) > totalExposure,'wdc');
    }
    // function setRefer(address user, address referrer) external auth {
    //     require(user != address(0), "Invalid user");
    //     require(referrer != address(0), "Invalid referrer");

    //     refers[user] = referrer;

    //     emit ReferSet(user, referrer);
    // }

}

