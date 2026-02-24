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
    uint256 public constant PROFIT_FEE_BPS = 500; // 5%
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

        uint256 yesPendingWithdraw;
        uint256 noPendingWithdraw;

        uint256 yesWithdrawAvailableAt;
        uint256 noWithdrawAvailableAt;

        bool claimed;
    }

    /* ===================== EVENTS ===================== */

    event Deposit(
        bytes32 indexed conditionId,
        address indexed user,
        bool isYes,
        uint256 amount,
        uint256 totalUSD
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
        bool isYes,
        uint256 amount,
        uint256 fee
    );

    event MarketResolved(
        bytes32 indexed conditionId,
        MarketResult result
    );
    event MarketUnset(
        bytes32 indexed conditionId,
        MarketStatus status
    );
    event Claimed(
        bytes32 indexed conditionId,
        address indexed user,
        uint256 payout
    );

    event MarketTerminated(
        bytes32 indexed conditionId,
        uint256 totalUSD
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
        
        emit Deposit(conditionId, msg.sender, isYes, amount,totalUSD[conditionId]);
        
        if (totalUSD[conditionId] >= marketTransferThreshold) {
            marketStatus[conditionId] = MarketStatus.TERMINATED;
            emit MarketTerminated(conditionId,totalUSD[conditionId]);
        }

        
    }

    function withdraw(bytes32 conditionId, bool isYes, uint256 amount) external {
        require(marketStatus[conditionId] == MarketStatus.OPEN, "Market not open");
        require(amount > 0, "Zero amount");

        Position storage p = positions[conditionId][msg.sender];
        uint256 availableAt = block.timestamp + WITHDRAW_DELAY;

        if (isYes) {
            require(p.yesUSDAmount >= amount, "Insufficient YES");

            p.yesUSDAmount -= amount;
            totalYesUSD[conditionId] -= amount;

            p.yesPendingWithdraw += amount;

            if (availableAt > p.yesWithdrawAvailableAt) {
                p.yesWithdrawAvailableAt = availableAt;
            }

            emit WithdrawRequested(conditionId, msg.sender, true, amount, p.yesWithdrawAvailableAt);

        } else {
            require(p.noUSDAmount >= amount, "Insufficient NO");

            p.noUSDAmount -= amount;
            totalNoUSD[conditionId] -= amount;

            p.noPendingWithdraw += amount;

            if (availableAt > p.noWithdrawAvailableAt) {
                p.noWithdrawAvailableAt = availableAt;
            }

            emit WithdrawRequested(conditionId, msg.sender, false, amount, p.noWithdrawAvailableAt);
        }

        totalUSD[conditionId] -= amount;
    }


    function cancelWithdraw(bytes32 conditionId, bool isYes) external {
        Position storage p = positions[conditionId][msg.sender];

        if (isYes) {
            require(p.yesPendingWithdraw > 0, "No YES pending");
            require(block.timestamp < p.yesWithdrawAvailableAt, "Already claimable");

            uint256 amount = p.yesPendingWithdraw;

            p.yesUSDAmount += amount;
            totalYesUSD[conditionId] += amount;
            totalUSD[conditionId] += amount;

            p.yesPendingWithdraw = 0;
            p.yesWithdrawAvailableAt = 0;

            emit WithdrawCancelled(conditionId, msg.sender, true, amount);

        } else {
            require(p.noPendingWithdraw > 0, "No NO pending");
            require(block.timestamp < p.noWithdrawAvailableAt, "Already claimable");

            uint256 amount = p.noPendingWithdraw;

            p.noUSDAmount += amount;
            totalNoUSD[conditionId] += amount;
            totalUSD[conditionId] += amount;

            p.noPendingWithdraw = 0;
            p.noWithdrawAvailableAt = 0;

            emit WithdrawCancelled(conditionId, msg.sender, false, amount);
        }
    }

    function claimWithdraw(bytes32 conditionId, bool isYes) external {
        Position storage p = positions[conditionId][msg.sender];

        uint256 amount;
        uint256 availableAt;

        if (isYes) {
            amount = p.yesPendingWithdraw;
            availableAt = p.yesWithdrawAvailableAt;

            require(amount > 0, "No YES pending");
            require(block.timestamp >= availableAt, "Too early");

            p.yesPendingWithdraw = 0;
            p.yesWithdrawAvailableAt = 0;

        } else {
            amount = p.noPendingWithdraw;
            availableAt = p.noWithdrawAvailableAt;

            require(amount > 0, "No NO pending");
            require(block.timestamp >= availableAt, "Too early");

            p.noPendingWithdraw = 0;
            p.noWithdrawAvailableAt = 0;
        }

        uint256 fee = (amount * WITHDRAW_FEE_BPS) / BPS_DENOM;
        uint256 receiveAmount = amount - fee;

        marketFeeUSD += fee;

        require(usdc.transfer(msg.sender, receiveAmount), "Transfer failed");

        emit WithdrawClaimed(conditionId, msg.sender, isYes, receiveAmount, fee);
    }

    /* ===================================================== */
    /* ===================== ORACLE ======================== */
    /* ===================================================== */

    function resolveMarket(bytes32 conditionId, MarketResult result) external onlyOracle {
        //require(marketStatus[conditionId] == MarketStatus.OPEN, "Market not open");
        //require(result == MarketResult.YES || result == MarketResult.NO, "Invalid");

        marketStatus[conditionId] = MarketStatus.RESOLVED;
        marketResult[conditionId] = result;

        emit MarketResolved(conditionId, result);
    }
    function unsetMarket(bytes32 conditionId, MarketStatus status) external onlyOracle {

        marketStatus[conditionId] = status;

        emit MarketUnset(conditionId, status);
    }

    /* ===================================================== */
    /* ===================== CLAIM WINNINGS ================ */
    /* ===================================================== */

    function claim(bytes32 conditionId) external {
        require(marketStatus[conditionId] == MarketStatus.RESOLVED, "Market not resolved");

        Position storage p = positions[conditionId][msg.sender];
        require(!p.claimed, "Already claimed");

        uint256 grossPayout;
        uint256 principal;
        uint256 profit;
        uint256 fee;
        uint256 netPayout;

        if (marketResult[conditionId] == MarketResult.YES) {

            require(p.yesUSDAmount > 0, "No winning position");

            principal = p.yesUSDAmount;

            grossPayout = (principal * totalUSD[conditionId]) / totalYesUSD[conditionId];

            p.yesUSDAmount = 0;

        } else {

            require(p.noUSDAmount > 0, "No winning position");

            principal = p.noUSDAmount;

            grossPayout = (principal * totalUSD[conditionId]) / totalNoUSD[conditionId];

            p.noUSDAmount = 0;
        }

        
        if (grossPayout > principal) {
            profit = grossPayout - principal;
            fee = (profit * PROFIT_FEE_BPS) / BPS_DENOM; // 5%
            netPayout = grossPayout - fee;

            marketFeeUSD += fee;
        } else {
            
            netPayout = grossPayout;
        }

        p.claimed = true;

        require(usdc.transfer(msg.sender, netPayout), "Transfer failed");

        emit Claimed(conditionId, msg.sender, netPayout);
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
