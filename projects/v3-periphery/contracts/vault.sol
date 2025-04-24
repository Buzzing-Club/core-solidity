// SPDX-License-Identifier: MIT
pragma solidity ^0.7.0;
pragma abicoder v2;
import './interfaces/INonfungiblePositionManager.sol';
import './base/PeripheryValidation.sol';
import { ERC1155Receiver } from "@openzeppelin/contracts/token/ERC1155/ERC1155Receiver.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import './libraries/PoolAddress.sol';
import './interfaces/ISwapRouter.sol';
import '@pancakeswap/v3-core/contracts/interfaces/IBubblySwapPool.sol';

// 引入USDC合约接口
// interface IERC20 {
//     function transfer(address recipient, uint256 amount) external returns (bool);
//     function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
//     function balanceOf(address account) external view returns (uint256);
//     function approve(address spender, uint256 amount) external returns (bool);
// }
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
contract Vault is PeripheryValidation,ERC1155Receiver,ERC20{

    // 固定日利率，比如0.1%每日利率
    uint256 public constant DAILY_INTEREST_RATE = 1; // 每日利率1，即0.1%（1e-4）

    uint256 public constant SECONDS_IN_A_DAY = 1 days; // 每天的秒数
    uint256 public constant FIXED_POINT = 1e18; // 固定点常量，用于精确计算

    // USDC token地址
    address public NonfungiblePositionManager;
    address public SwapRouter;
    address public usdbTokenAddress;
    address public ctfAddress;
    IERC20 public usdc;

    // 存款信息
    struct Deposit {
        uint256 principal; // 本金
        uint256 interestAccrued; // 累计利息
        uint256 lastDepositTime; // 上次存入的时间
    }

    mapping(address => Deposit) public deposits;
    mapping(address => uint256) public poolExposure;
    mapping(address => uint256) public LPshares;

    // 总本金和总利息
    uint256 public totalPrincipal;
    uint256 public totalInterest;
    uint256 public totalInterestCanUse;
    uint256 public totalshares;

    // 上次更新时间戳
    uint256 public lastUpdateTimestamp;
    event BuyYes(uint256 amountIn, uint256 amountOut,address pool);
    event SellYes(uint256 amountIn, uint256 amountOut,address pool);
    event BuyNo(uint256 amountIn, uint256 amountOut,address pool);
    event SellNo(uint256 amountIn, uint256 amountOut,address pool);
    event IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);
    constructor(address _usdcTokenAddress, address _NonfungiblePositionManager, address _ctf, address _swaprouter) 
    ERC20('USD Bubbly', 'USDB')
    {
        usdbTokenAddress = address(this);
        usdc = IERC20(_usdcTokenAddress);
        lastUpdateTimestamp = block.timestamp; // 初始化更新时间戳
        NonfungiblePositionManager = _NonfungiblePositionManager;
        ctfAddress = _ctf;
        SwapRouter = _swaprouter;
    }
    //add for test
    function mint(uint256 amount) external{
        _mint(msg.sender,amount);
    }
   
    function traderDeposit(uint256 amount) external {
        usdc.transferFrom(msg.sender, address(this), amount);
        //mint for swap
        _mint(msg.sender,amount);        
    }
    function traderWithdraw(uint256 amount) external {
        _burn(msg.sender,amount);
        usdc.transfer(msg.sender,amount);      
    }
    function deposit(uint256 amount) external {
        require(amount > 0, "Amount must be greater than 0");

        Deposit storage userDeposit = deposits[msg.sender];

        // 如果用户已经有存款了，先计算并更新利息
        if (userDeposit.principal > 0) {
            _accrueInterest(msg.sender);
        }

        // 从用户账户转移USDC
        usdc.transferFrom(msg.sender, address(this), amount);
        //mint for addliquidity
        _mint(address(this),amount);
        //add shares for removeliquidity calculation
        LPshares[msg.sender] += amount;
        totalshares += amount; 
        // 如果是首次存款，初始化 lastDepositTime
        if (userDeposit.principal == 0) {
            userDeposit.lastDepositTime = block.timestamp;
        }

        // 更新用户存款信息
        userDeposit.principal += amount;

        // 更新总本金
        totalPrincipal += amount;

        // 更新总利息
        _updateTotalInterest();
    }

    // 计算并更新总利息
    function _updateTotalInterest() internal {
        uint256 timeElapsed = block.timestamp - lastUpdateTimestamp; // 计算从上次更新时间到当前时间的差值
        
        // 利用秒数计算总利息
        uint256 interestPerSecond = totalPrincipal * DAILY_INTEREST_RATE / 1000 / SECONDS_IN_A_DAY; // 每秒的利息
        uint256 accruedInterest = interestPerSecond * timeElapsed; // 基于秒数计算的利息

        totalInterest += accruedInterest;
        lastUpdateTimestamp = block.timestamp; // 更新上次更新时间
    }

    // 计算并更新用户的利息
    function _accrueInterest(address user) internal {
        Deposit storage userDeposit = deposits[user];
        uint256 timeElapsed = block.timestamp - userDeposit.lastDepositTime;
        
        // 计算利息
        uint256 interestPerSecond = userDeposit.principal * DAILY_INTEREST_RATE / 1000 / SECONDS_IN_A_DAY; // 每秒的利息
        uint256 accruedInterest = interestPerSecond * timeElapsed; // 基于秒数计算的利息

        userDeposit.interestAccrued += accruedInterest;

        // 更新最后一次存款时间
        userDeposit.lastDepositTime = block.timestamp;
    }

    // 提取用户的本金和利息
    function withdraw() external {
        Deposit storage userDeposit = deposits[msg.sender];

        // 计算并更新利息
        _accrueInterest(msg.sender);

        uint256 totalAmount = userDeposit.principal + userDeposit.interestAccrued;
        require(totalAmount > 0, "No funds to withdraw");

        // 清除用户存款信息
        totalPrincipal -= userDeposit.principal;
        totalInterest -= userDeposit.interestAccrued;

        // 更新用户存款
        userDeposit.principal = 0;
        userDeposit.interestAccrued = 0;

        // 转账USDC给用户
        usdc.transfer(msg.sender, totalAmount);
    }

    // 查询用户当前的本金和利息
    function getBalance(address user) external view returns (uint256 principal, uint256 interest) {
        Deposit storage userDeposit = deposits[user];
        uint256 timeElapsed = block.timestamp - userDeposit.lastDepositTime;
        
        uint256 interestPerSecond = userDeposit.principal * DAILY_INTEREST_RATE / 1000 / SECONDS_IN_A_DAY; // 每秒的利息
        uint256 accruedInterest = interestPerSecond * timeElapsed; // 基于秒数计算的利息

        return (userDeposit.principal, userDeposit.interestAccrued + accruedInterest);
    }

    // 获取合约中当前总本金和总利息
    function getTotalBalance() external view returns (uint256 totalPrincipalAmount, uint256 totalInterestAmount) {
        uint256 timeElapsed = block.timestamp - lastUpdateTimestamp; // 计算自上次更新以来的时间
        
        uint256 interestPerSecond = totalPrincipal * DAILY_INTEREST_RATE / 1000 / SECONDS_IN_A_DAY; // 每秒的利息
        uint256 accruedInterest = interestPerSecond * timeElapsed; // 基于秒数计算的利息

        return (totalPrincipal, totalInterest + accruedInterest);
    }
    function addLiquidity(INonfungiblePositionManager.MintParams calldata mintParams,
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
        //udsc-> usdb -> approve to ctf
        //get erc1155 from ctf contract 
        //IERC20(splitPositionParmas.collateralToken).transferFrom(msg.sender, address(this), splitPositionParmas.amount);
        //require(mintParams.amount0Desired + mintParams.amount1Desired <= totalInterest, "no enough Interest");
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
        address wrappedERC1155Adress = Wrapped1155Factory(ERC1155Factory).getWrapped1155(ctfAddress,transferParmas.id, transferParmas.data);
        // max approve for mint
        
        IERC20(wrappedERC1155Adress).approve(NonfungiblePositionManager,type(uint256).max);
        
        IERC20(splitPositionParmas.collateralToken).approve(NonfungiblePositionManager,type(uint256).max);
       
        (tokenId, liquidity,amount0, amount1) = INonfungiblePositionManager(NonfungiblePositionManager).mint(mintParams); 
        //update exposure
        emit IncreaseLiquidity(tokenId, liquidity, amount0, amount1);
        
    }
    function decreaseLiquidity(INonfungiblePositionManager.DecreaseLiquidityParams calldata params)
        external
    {
        INonfungiblePositionManager(NonfungiblePositionManager).decreaseLiquidity(params);
        //update occupied principal
    }
    function buyYes(ISwapRouter.ExactInputSingleParams calldata params, address pool) external {
        //tokenIn always usd
        usdc.transferFrom(msg.sender, address(this), params.amountIn);
        //mint usdb for ctf
        _traderDeposit(address(this), params.amountIn);
        require(params.tokenIn == usdbTokenAddress);
        
        IERC20(params.tokenIn).approve(SwapRouter,type(uint256).max);

        uint256 amountOut = ISwapRouter(SwapRouter).exactInputSingle(params);
        //todo event trigger 
        emit BuyYes(params.amountIn, amountOut, pool);
    }
    function sellYes(ISwapRouter.ExactInputSingleParams calldata params, address pool) external {
        //tokenIn always wrapped1155
        IERC20(params.tokenIn).transferFrom(msg.sender,address(this),params.amountIn);
        require(params.tokenIn != usdbTokenAddress);
        IERC20(params.tokenIn).approve(SwapRouter,type(uint256).max);
        uint256 amountOut = ISwapRouter(SwapRouter).exactInputSingle(params);
        _traderWithdraw(msg.sender, amountOut);
        //todo event trigger 
        emit SellYes(params.amountIn, amountOut, pool);
    }

    function buyNo(ISwapRouter.ExactInputSingleParams calldata params,                           
                   SplitPositionParams calldata splitPositionParmas,
                   ERC1155TransferParams calldata transferParmas,
                   uint256 noPositionId,
                   address ERC1155Factory,
                   address pool) 
                   external 
    {
        //transfer usdc for usdb
        usdc.transferFrom(msg.sender, address(this), params.amountIn);
        //mint usdb for ctf
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
        CTF(ctfAddress).safeTransferFrom(address(this), 
                                         msg.sender, 
                                         noPositionId, 
                                         splitPositionParmas.amount, 
                                         "");       
        //get wrapped erc1155 from factory ,transfer without approve
        CTF(ctfAddress).safeTransferFrom(transferParmas.from, 
                                         transferParmas.to, 
                                         transferParmas.id, 
                                         transferParmas.value, 
                                         transferParmas.data);

        address wrappedERC1155Adress = Wrapped1155Factory(ERC1155Factory).getWrapped1155(ctfAddress,transferParmas.id, transferParmas.data);
        
        // max approve for swap yes to usd
        IERC20(wrappedERC1155Adress).approve(SwapRouter,type(uint256).max);

        uint256 amountOut = ISwapRouter(SwapRouter).exactInputSingle(params);
        _traderWithdraw(msg.sender, amountOut);
        //todo event trigger 
        emit BuyNo(params.amountIn, amountOut, pool);
    }

    function sellNo(ISwapRouter.ExactOutputSingleParams calldata params, 
                    SplitPositionParams calldata splitPositionParmas, 
                    UnwrappedParams calldata unwrappedParams,
                    uint256 noPositionId,
                    address ERC1155Factory,
                    address pool) external 
    {
        //buy yes && mergeposition to collateral
        //transfer usdc for usdb
        usdc.transferFrom(msg.sender, address(this), params.amountOut);
        //mint usdb for ctf
        _traderDeposit(address(this), params.amountOut);
        require(params.tokenIn == usdbTokenAddress);
        IERC20(params.tokenIn).approve(SwapRouter,type(uint256).max);

        uint256 amountIn = ISwapRouter(SwapRouter).exactOutputSingle(params);
        Wrapped1155Factory(ERC1155Factory).unwrap(unwrappedParams.multiToken, 
                                                  unwrappedParams.tokenId, 
                                                  params.amountOut, 
                                                  unwrappedParams.recipient, 
                                                  unwrappedParams.data);
        //transfer no to vault for merge
        CTF(ctfAddress).safeTransferFrom(msg.sender, address(this), noPositionId, params.amountOut, "");
        CTF(ctfAddress).mergePositions(splitPositionParmas.collateralToken, 
                                      splitPositionParmas.parentCollectionId, 
                                      splitPositionParmas.conditionId, 
                                      splitPositionParmas.partition, 
                                      params.amountOut);
        //transfer usdc to user
        _traderWithdraw(msg.sender, params.amountOut - amountIn);
        //todo event trigger 
        emit SellNo(amountIn, params.amountOut, pool);
    }
    function _traderDeposit(address account,uint256 amount) internal{
        _mint(account,amount);
    }
    function _traderWithdraw(address account,uint256 amount) internal{
        //_burn(account,amount);
        usdc.transfer(account,amount);
    }
    function onERC1155Received(
        address operator,
        address /* from */,
        uint256 id,
        uint256 value,
        bytes calldata data
    )
        external
        override
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
        override
        returns (bytes4)
    {      
        return this.onERC1155BatchReceived.selector;
    }

}