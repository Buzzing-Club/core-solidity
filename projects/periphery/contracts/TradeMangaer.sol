// SPDX-License-Identifier: AGPL-3.0-or-later

pragma solidity >=0.8.0;

import "./openzeppelin-contracts-upgradeable/contracts/proxy/utils/Initializable.sol";
import "./openzeppelin-contracts-upgradeable/lib/openzeppelin-contracts/contracts/utils/math/MathUpgradeable.sol";
import './interfaces/IDynamicFeeManager.sol';

interface INonfungiblePositionManager {
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
    function balanceOf(address to) external returns (uint256);
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
contract tradeManager is Initializable {
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
    uint256 public constant FEE_SCALE = 1_000_000;
    address public NonfungiblePositionManager;
    address public SwapRouter;
    address public usdbTokenAddress;
    address public ctfAddress;
    address public feeAdapter;
    address public feeManager;
    address public yieldProtocol;
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
    //vault
    address public rBLP;
    address public sBLP;
    int256 public RiskCoefficient;
    int256 public riskThreshold;

    // --- Events ---

    // Admin
    event Rely(address indexed usr);
    // Buzzing
    event BuyYes(uint256 amountIn, uint256 amountOut,address pool, address recipient);
    event SellYes(uint256 amountIn, uint256 amountOut,address pool, address recipient);
    event BuyNo(uint256 amountIn, uint256 amountOut,address pool, address recipient);
    event SellNo(uint256 amountIn, uint256 amountOut,address pool, address recipient);
    event IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);
    event PnLHandled(int256 indexed totalPnl, int256 sBLPPnl, int256 rBLPPnl);
    event MarketReported(
    address indexed reporter,
    address indexed pool,
    bool isYes,
    uint256 reportIndex
);

    // --- Modifiers ---

    modifier auth {
        require(wards[msg.sender] == 1, "TraderManager/not-authorized");
        _;
    }
    function _blockTimestamp() internal view virtual returns (uint256) {
        return block.timestamp;
    }
    modifier checkDeadline(uint256 deadline) {
        require(_blockTimestamp() <= deadline, 'Transaction too old');
        _;
    }
    function setFeeAdapter(address _feeAdapter) auth external {
        feeAdapter = _feeAdapter;
    }
    function setFeeManager(address _feeManager) auth external {
        feeManager = _feeManager;
    }


    // --- Upgradability ---

    function initialize(address _usdb , address _usdcTokenAddress, address _NonfungiblePositionManager, address _ctf, address _swaprouter,address _rBLP,address _sBLP) initializer external {
        wards[msg.sender] = 1;
        usdb = UsdbLike(_usdb);
        
        usdbTokenAddress = _usdb;
        usdc = IERC20(_usdcTokenAddress);
        NonfungiblePositionManager = _NonfungiblePositionManager;
        ctfAddress = _ctf;
        SwapRouter = _swaprouter;
        rBLP = _rBLP;
        sBLP = _sBLP;
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
                          address poolAddress)
        external
        checkDeadline(mintParams.deadline)
        returns (
            uint256 tokenId,
            uint128 liquidity,
            uint256 amount0,
            uint256 amount1
        )
    {

        _exposureCheck();
        IERC20(usdbTokenAddress).mint(address(this), splitPositionParmas.amount);   
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
        
        emit IncreaseLiquidity(tokenId, liquidity, amount0, amount1);
        
    }
    function decreaseLiquidity(DecreaseLiquidityParams calldata params)
        external
    {
        INonfungiblePositionManager(NonfungiblePositionManager).decreaseLiquidity(params);
    
    }

    function buyYes(ExactInputSingleParams calldata params, address pool, uint256 minAmount,address receiver) external {
        _checkPool(pool);
        IERC20(usdbTokenAddress).transferFrom(msg.sender,address(this), params.amountIn);
        require(params.tokenIn == usdbTokenAddress);

        IERC20(params.tokenIn).approve(SwapRouter,type(uint256).max);   

        uint256 amountOut = ISwapRouter(SwapRouter).exactInputSingle(params);
        _tickcheck(pool);
        //user position update
        UserYesPosition storage pos = userYesPositions[receiver][pool];
        pos.yesTokenAmount += amountOut;
        pos.usdSpent += params.amountIn;
        buyYesAmount[pool] = buyYesAmount[pool] +  amountOut;
        buyYesUSD[pool] = buyYesUSD[pool] +  params.amountIn;
        require(amountOut >= minAmount,"yes not enough");
        _updateExposure(pool);
        _exposureCheck();
        emit BuyYes(params.amountIn, amountOut, pool, receiver);
    }

    function sellYes(ExactInputSingleParams calldata params, address pool, uint256 minAmount,address referrer) external {
        //tokenIn always wrapped1155
        _checkPool(pool);
        
        IERC20(params.tokenIn).transferFrom(msg.sender,address(this),params.amountIn);
        require(params.tokenIn != usdbTokenAddress);
        IERC20(params.tokenIn).approve(SwapRouter,type(uint256).max); 
        
        (,int24 tickBeforeSwap, , , , , ) = SwapPool(pool).slot0();      
        
        uint256 amountOut = ISwapRouter(SwapRouter).exactInputSingle(params);
        
        (,int24 tickAfterSwap, , , , , ) = SwapPool(pool).slot0();  
        uint256 ticksCrossed = tickBeforeSwap > tickAfterSwap
            ? uint256(int256(tickBeforeSwap) - int256(tickAfterSwap))
            : uint256(int256(tickAfterSwap) - int256(tickBeforeSwap));

        uint256 feeRatio = IFeeAdapter(feeAdapter).poolTotalFeeRatio(pool);
       
        uint256 totalFeeAmount = amountOut * feeRatio / FEE_SCALE ;
      
        //dynamic fee
        // 1. Update pool volatility before trade
        IFeeManager(feeManager).updateVolatility(pool, tickAfterSwap, ticksCrossed);
        // 2. Compute fee based on volatility and ticks crossed
        uint256 dynamicfee = IFeeManager(feeManager).computeFee(pool, ticksCrossed, amountOut);
        //base fee for roles
        IERC20(usdbTokenAddress).transfer(msg.sender, amountOut - totalFeeAmount - dynamicfee);
        IERC20(usdbTokenAddress).transfer(feeAdapter, totalFeeAmount + dynamicfee);
        IFeeAdapter(feeAdapter).recordFee(pool, referrer, usdbTokenAddress, totalFeeAmount + dynamicfee);
        sellYesAmount[pool] = sellYesAmount[pool] +  params.amountIn;
        sellYesUSD[pool] = sellYesUSD[pool] +  amountOut - totalFeeAmount - dynamicfee;
        require(amountOut >= minAmount,"usd not enough");
       
        //LPfee
        uint256 LPfee = (totalFeeAmount + dynamicfee) * IFeeAdapter(feeAdapter).poolRoleShares(pool,'LP') / IFeeAdapter(feeAdapter).poolTotalFeeRatio(pool);
        //buffer
        uint256 bufferfee = (totalFeeAmount + dynamicfee) * IFeeAdapter(feeAdapter).poolRoleShares(pool,'Buffer') / IFeeAdapter(feeAdapter).poolTotalFeeRatio(pool);
        bufferFunds += bufferfee;
        //exposure check
        _updateExposure(pool);
        _exposureCheck();
        UserYesPosition storage pos = userYesPositions[msg.sender][pool];
        uint256 avgPrice = pos.usdSpent * PRECISION / pos.yesTokenAmount;
       
        uint256 sellPrice = amountOut * PRECISION / params.amountIn;
        
        int256 pnl = ((int256(sellPrice) - int256(avgPrice))  * int256(params.amountIn) / int256(PRECISION));
       
        _handlePnl(pnl + int256(LPfee));
        
        emit SellYes(params.amountIn, amountOut, pool, msg.sender);
    }

    function buyNo(ExactInputSingleParams calldata params,                           
                   SplitPositionParams calldata splitPositionParmas,
                   ERC1155TransferParams calldata transferParmas,
                   uint256 noPositionId,
                   address ERC1155Factory,
                   address pool,
                   uint256 maxAmount,
                   address receiver) 
                   external 
    {

        _checkPool(pool);
        _traderDeposit(address(this), params.amountIn);
        //tokenIn always usd
        require(params.tokenIn != usdbTokenAddress);
        IERC20(usdbTokenAddress).approve(ctfAddress, type(uint256).max);
        CTF(ctfAddress).splitPosition(splitPositionParmas.collateralToken, 
                                      splitPositionParmas.parentCollectionId, 
                                      splitPositionParmas.conditionId, 
                                      splitPositionParmas.partition, 
                                      splitPositionParmas.amount);
        //transfer no to user
        // CTF(ctfAddress).safeTransferFrom(address(this), 
        //                                  msg.sender, 
        //                                  noPositionId, 
        //                                  splitPositionParmas.amount, 
        //                                  "");       
        //transfer no to factory to get erc20
        CTF(ctfAddress).safeTransferFrom(transferParmas.from, 
                                         transferParmas.to, 
                                         noPositionId, 
                                         splitPositionParmas.amount, 
                                         transferParmas.data); 
        address noTokenAddress = Wrapped1155Factory(ERC1155Factory).getWrapped1155(ctfAddress,noPositionId, transferParmas.data);  
        //transfer erc20 notoken to user
        IERC20(noTokenAddress).transfer(receiver,splitPositionParmas.amount);  

        //get wrapped erc1155 from factory ,transfer without approve
        CTF(ctfAddress).safeTransferFrom(transferParmas.from, 
                                         transferParmas.to, 
                                         transferParmas.id, 
                                         transferParmas.value, 
                                         transferParmas.data);

        address wrappedERC1155Address = Wrapped1155Factory(ERC1155Factory).getWrapped1155(ctfAddress,transferParmas.id, transferParmas.data);
        // max approve for swap yes to usd
        IERC20(wrappedERC1155Address).approve(SwapRouter,type(uint256).max);

        uint256 amountOut = ISwapRouter(SwapRouter).exactInputSingle(params);
        //pull usdb from user
        IERC20(usdbTokenAddress).transferFrom(msg.sender,address(this), params.amountIn - amountOut);
        IERC20(usdbTokenAddress).burn(address(this),params.amountIn);

        UserNoPosition storage pos = userNoPositions[receiver][pool];
        pos.noTokenAmount += params.amountIn;
        
        pos.usdSpent += params.amountIn - amountOut;
        
        buyNoAmount[pool] = buyNoAmount[pool] +  params.amountIn;
        buyNoUSD[pool] = buyNoUSD[pool] +  params.amountIn - amountOut;
        require(params.amountIn - amountOut < maxAmount,"too much usd");
        _updateExposure(pool);
        _exposureCheck();
        emit BuyNo(params.amountIn, amountOut, pool , receiver);
    }
    function sellNo(ExactOutputSingleParams calldata params, 
                    SplitPositionParams calldata splitPositionParmas, 
                    UnwrappedParams calldata unwrappedParams,
                    uint256 noPositionId,
                    address ERC1155Factory,
                    address pool,
                    uint256 minAmount,
                    address referrer) external 
    {
        _checkPool(pool);
        _traderDeposit(address(this), params.amountOut);
        //mint usdb for ctf
        require(params.tokenIn == usdbTokenAddress);
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
        IERC20(noTokenAddress).transferFrom(msg.sender, address(this), params.amountOut);

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
        uint256 feeRatio = IFeeAdapter(feeAdapter).poolTotalFeeRatio(pool);
        uint256 totalFeeAmount = (params.amountOut - amountIn) * feeRatio / FEE_SCALE ;
        (,int24 tickAfterSwap, , , , , ) = SwapPool(pool).slot0();  
        uint256 ticksCrossed = tickBeforeSwap > tickAfterSwap
            ? uint256(int256(tickBeforeSwap) - int256(tickAfterSwap))
            : uint256(int256(tickAfterSwap) - int256(tickBeforeSwap));
        //dynamic fee
        // 1. Update pool volatility before trade
        IFeeManager(feeManager).updateVolatility(pool, tickAfterSwap, ticksCrossed);
        // 2. Compute fee based on volatility and ticks crossed
        uint256 dynamicfee = IFeeManager(feeManager).computeFee(pool, ticksCrossed, amountIn);
        //usdb transfer without fee
        IERC20(usdbTokenAddress).transfer(msg.sender, params.amountOut - amountIn - totalFeeAmount - dynamicfee);
        //fee transfer
        IERC20(usdbTokenAddress).transfer(feeAdapter, totalFeeAmount + dynamicfee);
        IFeeAdapter(feeAdapter).recordFee(pool, referrer, usdbTokenAddress, totalFeeAmount + dynamicfee);
        sellNoAmount[pool] = sellNoAmount[pool] +  params.amountOut;
        
        sellNoUSD[pool] = sellNoUSD[pool] +  params.amountOut - amountIn - totalFeeAmount - dynamicfee;
       
        _updateExposure(pool);
        _exposureCheck();
        require(params.amountOut - amountIn >= minAmount,"usd not enough");
        //LP fee
        uint256 LPfee = (totalFeeAmount + dynamicfee) * IFeeAdapter(feeAdapter).poolRoleShares(pool,'LP') / IFeeAdapter(feeAdapter).poolTotalFeeRatio(pool);
        //buffer
        uint256 bufferfee = (totalFeeAmount + dynamicfee) * IFeeAdapter(feeAdapter).poolRoleShares(pool,'Buffer') / IFeeAdapter(feeAdapter).poolTotalFeeRatio(pool);
        bufferFunds += bufferfee;
        //pnl calculation
        UserNoPosition storage pos = userNoPositions[msg.sender][pool];
        
        uint256 avgPrice = pos.usdSpent * PRECISION / pos.noTokenAmount;
    
        uint256 sellPrice = (params.amountOut - amountIn) * PRECISION / amountIn;
        int256 pnl = ((int256(sellPrice) - int256(avgPrice)) / int256(PRECISION) * int256(amountIn));
        _handlePnl(pnl + int256(LPfee));
        emit SellNo(amountIn, params.amountOut, pool, msg.sender);
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
            require(tickAfter > 0 ,"tickAfter < 0");
        }
        else{
            //usdb is token1, quote token, price ->1 means tick > 0
            require(tickAfter < 0, "tickAfter > 0");
        }
    }
    function _checkPool(address pool) internal {
        require(reportedCounts[pool] == 0, 'in settlement phase');
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

    //---Exposure---
    function _exposureCalculate(address pool) internal returns (int256) {
        uint256 sellyesamount = sellYesAmount[pool];
        uint256 sellnoamount = sellNoAmount[pool];
        uint256 buyyesamount = buyYesAmount[pool];
        
        uint256 buynoamount = buyNoAmount[pool];
        uint256 sellyesUSD = sellYesUSD[pool];
        uint256 sellnoUSD = sellNoUSD[pool];
        uint256 buyyesUSD = buyYesUSD[pool];
        
        uint256 buynoUSD = buyNoUSD[pool];
        int256 yesAmountDiff = int256(buyyesamount) - int256(sellyesamount);
        int256 noAmountDiff = int256(buynoamount) - int256(sellnoamount);
        int256 usdDiff = int256(buyyesUSD) + int256(buynoUSD) - int256(sellyesUSD) - int256(sellnoUSD);
        int256 yesExposure =  yesAmountDiff - usdDiff;
        int256 noExposure =   noAmountDiff - usdDiff;
        return yesExposure >= noExposure ? yesExposure : noExposure;
    }
    //for pnl calculation
    function exposureCalculate(address pool, bool isYes) public view returns (int256) {
        uint256 sellyesamount = sellYesAmount[pool];
        uint256 sellnoamount = sellNoAmount[pool];
        uint256 buyyesamount = buyYesAmount[pool];
        uint256 buynoamount = buyNoAmount[pool];
        uint256 sellyesUSD = sellYesUSD[pool];
        uint256 sellnoUSD = sellNoUSD[pool];
        uint256 buyyesUSD = buyYesUSD[pool];
        uint256 buynoUSD = buyNoUSD[pool];

        int256 yesAmountDiff = int256(buyyesamount) - int256(sellyesamount);
        int256 noAmountDiff = int256(buynoamount) - int256(sellnoamount);
        int256 usdDiff = int256(buyyesUSD) + int256(buynoUSD) - int256(sellyesUSD) - int256(sellnoUSD);

        int256 yesExposure = yesAmountDiff - usdDiff;
        int256 noExposure = noAmountDiff - usdDiff;

        if (isYes) {
            return yesExposure;
        } else {
            return noExposure;
        }
    }
    function _exposureCheck() internal {
        int256 availableFunds = _availableFunds();
        
        require(availableFunds >= 0 , 'availableFunds < 0');
        require(totalExposure <= int256(availableFunds * RiskCoefficient),'exposure risk');
        
    }
    function _updateExposure(address pool) internal {
        int256 exposurebefore = marketExposure[pool];
        totalExposure -= exposurebefore;
        int256 exposureafter = _exposureCalculate(pool);
        
        totalExposure += exposureafter;
        marketExposure[pool] = exposureafter; 

    }
    function _checkpool(address pool) internal {
        int256 exposurebefore = marketExposure[pool];
        totalExposure -= exposurebefore;
        int256 exposureafter = _exposureCalculate(pool);
        totalExposure += exposureafter;
        marketExposure[pool] = exposureafter; 
    }
    function _availableFunds() internal returns (int256) {
        uint256 shares = IYieldProtocol(yieldProtocol).balanceOf(address(this)); 

        _handleInterest();
        int256 availableFunds = int256(IBLPToken(rBLP).marketCap()) + int256(IBLPToken(sBLP).marketCap()) + int256(bufferFunds) - int256(IBLPToken(sBLP).totalDeposited());

        return availableFunds;
    }
    function _handlePnl(int256 pnl) internal {
       
        int256 rBLPPnl = pnl * RiskCoefficient / 1e18;
        
        int256 sBLPPnl = pnl - rBLPPnl;
        
        //require(pnl != 0);
       
        if (pnl < 0){
            
            IBLPToken(rBLP).distributePnl(uint256(-rBLPPnl));
            
            IBLPToken(sBLP).distributePnl(uint256(-sBLPPnl));
            
        }
        else if (pnl > 0){
            
            IBLPToken(rBLP).reclaimPnl(uint256(rBLPPnl));
            IBLPToken(sBLP).reclaimPnl(uint256(sBLPPnl));
            
        }
        totalPnl += pnl;
        
        emit PnLHandled(pnl, sBLPPnl, rBLPPnl);
    }

    function handleMarketPnl(address pool,bool isYes) external auth() {
        int256 marketPnl = exposureCalculate(pool,isYes);
        _handlePnl(marketPnl);
    }
    function _handleInterest() internal {
        
        uint256 shares = IYieldProtocol(yieldProtocol).balanceOf(address(this)); 
        uint256 assets = IYieldProtocol(yieldProtocol).convertToAssets(shares);
        int256 interest = int256(assets - yieldPrincipalUsed);
        yieldPrincipalUsed = assets;
        yieldInterest += uint256(interest);
        _handlePnl(-interest);
    }
    function marketReport(address pool,bool isYes) external auth() {
        require(reportedCounts[pool] < reportCount, 'market end');
        reportedCounts[pool] = reportedCounts[pool] + 1;
        if(reportedCounts[pool] == reportCount ){
            int256 marketPnl = exposureCalculate(pool,isYes);
            _handlePnl(marketPnl);
            totalExposure -= _exposureCalculate(pool);
        }
        emit MarketReported(msg.sender, pool, isYes, reportedCounts[pool]);
        
    }
    function LPDeposit(uint256 assets, address receiver,bool isRisk) public {
        if(isRisk){
            IBLPToken(rBLP).deposit(assets, receiver);
        }
        else{
            IBLPToken(sBLP).deposit(assets, receiver);
        }
    }
    function LPWithdraw(uint256 assets, address receiver,address owner,bool isRisk) public {
        _withdrawcheck(assets);

        if(isRisk){
            IBLPToken(rBLP).withdraw(assets, receiver, owner);
        }
        else{
            IBLPToken(rBLP).withdraw(assets, receiver, owner);
        }
        
    }
    function _withdrawcheck(uint256 assets) internal {
        int256 dynamicReservedFunds = riskThreshold * _availableFunds();
        require(dynamicReservedFunds - int256(assets) > totalExposure,'wdc');
    }
}
