// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract DynamicFeeManagerTest {
    struct PoolVolatility {
        int24 referenceTick;
        uint256 referenceVolatility;
        uint256 lastUpdate;
        uint256 accumulator;
    }

    mapping(address => PoolVolatility) public poolVolatility;

    // ===== Parameters =====
    uint256 public filterPeriod;
    uint256 public decayPeriod;
    uint256 public reductionFactor;
    uint256 public maxAccumulator;
    uint256 public variableFeeControl;
    uint256 public baseFeeUnit;

    address public owner;

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    // =============================================================
    // 1️⃣ PARAMETER SETTERS (for sweep testing)
    // =============================================================

    function setParams(
        uint256 _filterPeriod,
        uint256 _decayPeriod,
        uint256 _reductionFactor,
        uint256 _maxAccumulator,
        uint256 _variableFeeControl,
        uint256 _baseFeeUnit
    ) external onlyOwner {
        filterPeriod = _filterPeriod;
        decayPeriod = _decayPeriod;
        reductionFactor = _reductionFactor;
        maxAccumulator = _maxAccumulator;
        variableFeeControl = _variableFeeControl;
        baseFeeUnit = _baseFeeUnit;
    }

    // =============================================================
    // 2️⃣ DIRECT STATE CONTROL (核心测试能力)
    // =============================================================

    function setPoolState(
        address pool,
        int24 referenceTick,
        uint256 referenceVolatility,
        uint256 accumulator,
        uint256 lastUpdate
    ) external onlyOwner {
        poolVolatility[pool] = PoolVolatility({
            referenceTick: referenceTick,
            referenceVolatility: referenceVolatility,
            accumulator: accumulator,
            lastUpdate: lastUpdate
        });
    }

    function setAccumulator(
        address pool,
        uint256 accumulator
    ) external onlyOwner {
        poolVolatility[pool].accumulator = accumulator;
    }

    function setLastUpdate(
        address pool,
        uint256 lastUpdate
    ) external onlyOwner {
        poolVolatility[pool].lastUpdate = lastUpdate;
    }

    // =============================================================
    // 3️⃣ PURE MATH VERSION (不依赖 storage)
    // =============================================================

    function computeFeePure(
        uint256 ticksCrossed,
        uint256 tradeSize,
        uint256 accumulator
    ) external view returns (uint256 fee) {
        uint256 baseFee =
            (ticksCrossed * baseFeeUnit * tradeSize) / 1e18;

        uint256 variableFee =
            (variableFeeControl * accumulator * accumulator) / 1e18;

        fee = baseFee + variableFee;
    }

    // =============================================================
    // 4️⃣ STORAGE VERSION (与你原始逻辑一致)
    // =============================================================

    function computeFee(
        address pool,
        uint256 ticksCrossed,
        uint256 tradeSize
    ) external view returns (uint256 fee) {
        PoolVolatility storage pv = poolVolatility[pool];

        uint256 baseFee =
            (ticksCrossed * baseFeeUnit * tradeSize) / 1e18;

        uint256 variableFee =
            (variableFeeControl * pv.accumulator * pv.accumulator) / 1e18;

        fee = baseFee + variableFee;
    }
    function updateVolatility(
        address pool,
        int24 currentTick,
        uint256 ticksCrossed
    ) external {
        //require(msg.sender == tradeManager, "Unauthorized");
        PoolVolatility storage pv = poolVolatility[pool];
        uint256 t = block.timestamp - pv.lastUpdate;

        // Case 1: If time > filterPeriod and no trades, reset reference tick
        if (t > filterPeriod) {
            pv.referenceTick = currentTick;
        }

        // Case 2: If time > decayPeriod, reset reference volatility to 0
        if (t > decayPeriod) {
            pv.referenceVolatility = 0;
        }
        // Case 3: If filterPeriod < time <= decayPeriod, apply reduction factor
        else if (t > filterPeriod) {
            pv.referenceVolatility = (pv.accumulator * reductionFactor) / 1e18;
        }

        // Compute new accumulator:
        // va = vr + |ir - (ik=0 ± Δtick)|
        uint256 distance = _abs(int256(pv.referenceTick) - int256(currentTick));
        uint256 va = pv.referenceVolatility + distance + ticksCrossed;

        // Cap the accumulator to avoid extreme values
        if (va > maxAccumulator) {
            va = maxAccumulator;
        }

        pv.accumulator = va;
        pv.lastUpdate = block.timestamp;
    }
    function _abs(int256 x) internal pure returns (uint256) {
        return x >= 0 ? uint256(x) : uint256(-x);
    }
}
