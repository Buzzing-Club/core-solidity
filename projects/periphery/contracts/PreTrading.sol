// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

contract PreTrading {
    IERC20 public immutable usdc;
    address public oracle;

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

    event MarketDeposit(
        bytes32 indexed conditionId,
        address indexed user,
        bool isYes,
        uint256 amount,
        uint256 totalUSD
    );

    event MarketWithdrawRequested(
        bytes32 indexed conditionId,
        address indexed user,
        bool isYes,
        uint256 amount,
        uint256 fee,
        uint256 availableAt
    );

    event MarketWithdrawClaimed(
        bytes32 indexed conditionId,
        address indexed user,
        uint256 amount
    );

    event MarketResolved(
        bytes32 indexed conditionId,
        MarketResult result
    );

    event MarketClaimed(
        bytes32 indexed conditionId,
        address indexed user,
        uint256 payout
    );

    event MarketTerminated(
        bytes32 indexed conditionId,
        uint256 totalUSD
    );

    /* ===================== STORAGE ===================== */

    mapping(bytes32 => MarketStatus) public marketStatus;
    mapping(bytes32 => MarketResult) public marketResult;

    mapping(bytes32 => uint256) public totalYesUSD;
    mapping(bytes32 => uint256) public totalNoUSD;
    mapping(bytes32 => uint256) public totalUSD;

    mapping(bytes32 => uint256) public marketFeeUSD;
    mapping(bytes32 => mapping(address => Position)) public positions;

    modifier onlyOracle() {
        require(msg.sender == oracle, "Not oracle");
        _;
    }

    constructor(address _usdc, address _oracle, uint256 _threshold) {
        usdc = IERC20(_usdc);
        oracle = _oracle;
        marketTransferThreshold = _threshold;
    }

    /* ===================== USER ===================== */

    function deposit(bytes32 conditionId, bool isYes, uint256 amount) external {
        require(amount > 0, "Zero amount");
        require(marketStatus[conditionId] == MarketStatus.OPEN, "Market not open");

        usdc.transferFrom(msg.sender, address(this), amount);

        Position storage p = positions[conditionId][msg.sender];

        if (isYes) {
            p.yesUSDAmount += amount;
            totalYesUSD[conditionId] += amount;
        } else {
            p.noUSDAmount += amount;
            totalNoUSD[conditionId] += amount;
        }

        totalUSD[conditionId] += amount;

        emit MarketDeposit(
            conditionId,
            msg.sender,
            isYes,
            amount,
            totalUSD[conditionId]
        );

        if (totalUSD[conditionId] >= marketTransferThreshold) {
            marketStatus[conditionId] = MarketStatus.TERMINATED;

            emit MarketTerminated(
                conditionId,
                totalUSD[conditionId]
            );
        }
    }

    function withdraw(bytes32 conditionId, bool isYes, uint256 amount) external {
        require(marketStatus[conditionId] == MarketStatus.OPEN, "Market not open");

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

        uint256 fee = (amount * WITHDRAW_FEE_BPS) / BPS_DENOM;
        marketFeeUSD[conditionId] += fee;

        uint256 receiveAmount = amount - fee;
        uint256 availableAt = block.timestamp + WITHDRAW_DELAY;

        p.pendingWithdraw += receiveAmount;
        p.withdrawAvailableAt = availableAt;

        emit MarketWithdrawRequested(
            conditionId,
            msg.sender,
            isYes,
            amount,
            fee,
            availableAt
        );
    }

    function claimWithdraw(bytes32 conditionId) external {
        Position storage p = positions[conditionId][msg.sender];
        require(p.pendingWithdraw > 0, "Nothing to claim");
        require(block.timestamp >= p.withdrawAvailableAt, "Too early");

        uint256 amt = p.pendingWithdraw;
        p.pendingWithdraw = 0;

        usdc.transfer(msg.sender, amt);

        emit MarketWithdrawClaimed(
            conditionId,
            msg.sender,
            amt
        );
    }

    /* ===================== ORACLE ===================== */

    function resolveMarket(bytes32 conditionId, MarketResult result) external onlyOracle {
        require(marketStatus[conditionId] == MarketStatus.OPEN, "Market not open");
        require(result == MarketResult.YES || result == MarketResult.NO, "Invalid");

        marketStatus[conditionId] = MarketStatus.RESOLVED;
        marketResult[conditionId] = result;

        emit MarketResolved(
            conditionId,
            result
        );
    }

    /* ===================== CLAIM ===================== */

    function claim(bytes32 conditionId) external {
        require(marketStatus[conditionId] == MarketStatus.RESOLVED, "Market not resolved");

        Position storage p = positions[conditionId][msg.sender];
        require(!p.claimed, "Already claimed");

        uint256 payout;

        if (marketResult[conditionId] == MarketResult.YES) {
            require(p.yesUSDAmount > 0, "No winning position");

            payout =
                (p.yesUSDAmount * totalUSD[conditionId]) /
                totalYesUSD[conditionId];

            p.yesUSDAmount = 0;
        } else {
            require(p.noUSDAmount > 0, "No winning position");

            payout =
                (p.noUSDAmount * totalUSD[conditionId]) /
                totalNoUSD[conditionId];

            p.noUSDAmount = 0;
        }
        p.claimed = true;

        usdc.transfer(msg.sender, payout);

        emit MarketClaimed(
            conditionId,
            msg.sender,
            payout
        );
    }

}
