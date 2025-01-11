// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// 引入USDC合约接口
interface IERC20 {
    function transfer(address recipient, uint256 amount) external returns (bool);
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract Vault {

    // 固定日利率，比如0.1%每日利率
    uint256 public constant DAILY_INTEREST_RATE = 1; // 每日利率1，即0.1%（1e-4）

    uint256 public constant SECONDS_IN_A_DAY = 1 days; // 每天的秒数
    uint256 public constant FIXED_POINT = 1e18; // 固定点常量，用于精确计算

    // USDC token地址
    address public usdcTokenAddress;
    IERC20 public usdc;

    // 存款信息
    struct Deposit {
        uint256 principal; // 本金
        uint256 interestAccrued; // 累计利息
        uint256 lastDepositTime; // 上次存入的时间
    }

    mapping(address => Deposit) public deposits;

    // 总本金和总利息
    uint256 public totalPrincipal;
    uint256 public totalInterest;

    // 合约创建时间（首次存款时间）
    uint256 public vaultCreationTime;

    // 上次更新时间戳
    uint256 public lastUpdateTimestamp;

    constructor(address _usdcTokenAddress) {
        usdcTokenAddress = _usdcTokenAddress;
        usdc = IERC20(_usdcTokenAddress);
        vaultCreationTime = block.timestamp; // 记录合约创建的时间
        lastUpdateTimestamp = block.timestamp; // 初始化更新时间戳
    }

    // 存入USDC并开始生息
    function deposit(uint256 amount) external {
        require(amount > 0, "Amount must be greater than 0");

        Deposit storage userDeposit = deposits[msg.sender];

        // 如果用户已经有存款了，先计算并更新利息
        if (userDeposit.principal > 0) {
            _accrueInterest(msg.sender);
        }

        // 从用户账户转移USDC
        usdc.transferFrom(msg.sender, address(this), amount);

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
        // 如果是第一次存款，不计算利息
        if (lastUpdateTimestamp == vaultCreationTime) {
            lastUpdateTimestamp = block.timestamp; // 更新最后更新时间
            return;
        }

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

}
