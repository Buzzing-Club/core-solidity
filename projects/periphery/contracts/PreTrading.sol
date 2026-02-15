// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

contract PreTrading {
    IERC20 public immutable usdc;
    address public oracle;
    address public owner;

    uint256 public constant WITHDRAW_FEE_BPS = 500; // 5%
    uint256 public constant BPS_DENOM = 10_000;
    uint256 public constant WITHDRAW_DELAY = 1 days;

    uint256 public marketTransferThreshold;

    enum MarketStatus {
        OPEN,
        TERMINATED,
        RESOLVED
    }

    enum MarketResult {
        UNSET,
        YES,
        NO
    }

    struct Position {
        uint256 yesUSDAmount;
        uint256 noUSDAmount;
        uint256 pendingWithdraw;
        uint256 withdrawAvailableAt;
        bool claimed;
    }

    /* ===================== EVENTS ===================== */

    event Deposit(
        bytes32 indexed conditionId,
        address indexed user,
        bool isYes,
        uint256 amount
    );

    event WithdrawRequested(
        bytes32 indexed conditionId,
        address indexed user,
        bool isYes,
        uint256 amount,
        uint256 availableAt
    );

    event WithdrawCancelled(
        bytes32 indexed conditionId,
        address indexed user,
        bool isYes,
        uint256 amount
    );

    event WithdrawClaimed(
        bytes32 indexed conditionId,
        address indexed user,
        uint256 amount,
        uint256 fee
    );

    event MarketResolved(
        bytes32 indexed conditionId,
        MarketResult result
    );

    event Claimed(
        bytes32 indexed conditionId,
        address indexed user,
        uint256 payout
    );

    event MarketTerminated(
        bytes32 indexed conditionId
    );

    event FeeWithdrawn(
        address indexed to,
        uint256 amount
    );

    /* ===================== STORAGE ===================== */

    mapping(bytes32 => MarketStatus) public marketStatus;
    mapping(bytes32 => MarketResult) public marketResult;

    mapping(bytes32 => uint256) public totalYesUSD;
    mapping(bytes32 => uint256) public totalNoUSD;
    mapping(bytes32 => uint256) public totalUSD;

    uint256 public marketFeeUSD;

    mapping(bytes32 => mapping(address => Position)) public positions;

    /* ===================== MODIFIERS ===================== */

    modifier onlyOracle() {
        require(msg.sender == oracle, "Not oracle");
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    /* ===================== CONSTRUCTOR ===================== */

    constructor(address _usdc, address _oracle, uint256 _threshold) {
        usdc = IERC20(_usdc);
        oracle = _oracle;
        marketTransferThreshold = _threshold;
        owner = msg.sender;
    }

    /* ===================================================== */
    /* ===================== USER ACTIONS ================== */
    /* ===================================================== */

    function deposit(bytes32 conditionId, bool isYes, uint256 amount) external {
        require(amount > 0, "Zero amount");
        require(marketStatus[conditionId] == MarketStatus.OPEN, "Market not open");

        require(usdc.transferFrom(msg.sender, address(this), amount), "Transfer failed");

        Position storage p = positions[conditionId][msg.sender];

        if (isYes) {
            p.yesUSDAmount += amount;
            totalYesUSD[conditionId] += amount;
        } else {
            p.noUSDAmount += amount;
            totalNoUSD[conditionId] += amount;
        }

        totalUSD[conditionId] += amount;

        if (totalUSD[conditionId] >= marketTransferThreshold) {
            marketStatus[conditionId] = MarketStatus.TERMINATED;
            emit MarketTerminated(conditionId);
        }

        emit Deposit(conditionId, msg.sender, isYes, amount);
    }

    function withdraw(bytes32 conditionId, bool isYes, uint256 amount) external {
        require(marketStatus[conditionId] == MarketStatus.OPEN, "Market not open");
        require(amount > 0, "Zero amount");

        Position storage p = positions[conditionId][msg.sender];

        if (isYes) {
            require(p.yesUSDAmount >= amount, "Insufficient YES");
            p.yesUSDAmount -= amount;
            totalYesUSD[conditionId] -= amount;
        } else {
            require(p.noUSDAmount >= amount, "Insufficient NO");
            p.noUSDAmount -= amount;
            totalNoUSD[conditionId] -= amount;
        }

        totalUSD[conditionId] -= amount;

        p.pendingWithdraw += amount;

        uint256 availableAt = block.timestamp + WITHDRAW_DELAY;

        if (availableAt > p.withdrawAvailableAt) {
            p.withdrawAvailableAt = availableAt;
        }

        emit WithdrawRequested(
            conditionId,
            msg.sender,
            isYes,
            amount,
            p.withdrawAvailableAt
        );
    }

    function cancelWithdraw(bytes32 conditionId, bool isYes) external {
        Position storage p = positions[conditionId][msg.sender];

        require(p.pendingWithdraw > 0, "No pending withdraw");
        require(block.timestamp < p.withdrawAvailableAt, "Already claimable");

        uint256 amount = p.pendingWithdraw;

        if (isYes) {
            p.yesUSDAmount += amount;
            totalYesUSD[conditionId] += amount;
        } else {
            p.noUSDAmount += amount;
            totalNoUSD[conditionId] += amount;
        }

        totalUSD[conditionId] += amount;

        p.pendingWithdraw = 0;
        p.withdrawAvailableAt = 0;

        emit WithdrawCancelled(conditionId, msg.sender, isYes, amount);
    }

    function claimWithdraw(bytes32 conditionId) external {
        Position storage p = positions[conditionId][msg.sender];

        require(p.pendingWithdraw > 0, "Nothing to claim");
        require(block.timestamp >= p.withdrawAvailableAt, "Too early");

        uint256 amount = p.pendingWithdraw;

        uint256 fee = (amount * WITHDRAW_FEE_BPS) / BPS_DENOM;
        uint256 receiveAmount = amount - fee;

        marketFeeUSD += fee;

        p.pendingWithdraw = 0;
        p.withdrawAvailableAt = 0;

        require(usdc.transfer(msg.sender, receiveAmount), "Transfer failed");

        emit WithdrawClaimed(conditionId, msg.sender, receiveAmount, fee);
    }

    /* ===================================================== */
    /* ===================== ORACLE ======================== */
    /* ===================================================== */

    function resolveMarket(bytes32 conditionId, MarketResult result) external onlyOracle {
        require(marketStatus[conditionId] == MarketStatus.OPEN, "Market not open");
        require(result == MarketResult.YES || result == MarketResult.NO, "Invalid");

        marketStatus[conditionId] = MarketStatus.RESOLVED;
        marketResult[conditionId] = result;

        emit MarketResolved(conditionId, result);
    }

    /* ===================================================== */
    /* ===================== CLAIM WINNINGS ================ */
    /* ===================================================== */

    function claim(bytes32 conditionId) external {
        require(marketStatus[conditionId] == MarketStatus.RESOLVED, "Market not resolved");

        Position storage p = positions[conditionId][msg.sender];
        require(!p.claimed, "Already claimed");

        uint256 payout;

        if (marketResult[conditionId] == MarketResult.YES) {
            require(p.yesUSDAmount > 0, "No winning position");
            payout = (p.yesUSDAmount * totalUSD[conditionId]) / totalYesUSD[conditionId];
            p.yesUSDAmount = 0;
        } else {
            require(p.noUSDAmount > 0, "No winning position");
            payout = (p.noUSDAmount * totalUSD[conditionId]) / totalNoUSD[conditionId];
            p.noUSDAmount = 0;
        }

        p.claimed = true;

        require(usdc.transfer(msg.sender, payout), "Transfer failed");

        emit Claimed(conditionId, msg.sender, payout);
    }

    /* ===================================================== */
    /* ===================== OWNER ========================= */
    /* ===================================================== */

    function withdrawMarketFee(address to) external onlyOwner {
        require(to != address(0), "Invalid receiver");

        uint256 amount = marketFeeUSD;
        require(amount > 0, "No fee available");

        marketFeeUSD = 0;

        require(usdc.transfer(to, amount), "Transfer failed");

        emit FeeWithdrawn(to, amount);
    }
}
