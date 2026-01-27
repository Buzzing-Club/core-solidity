// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract DynamicFeeManager {
    struct PoolVolatility {
        int24 referenceTick;        // Last reference tick (ir)
        uint256 referenceVolatility; // Reference volatility (vr)
        uint256 lastUpdate;         // Timestamp of last update
        uint256 accumulator;        // Volatility accumulator (va)
    }

    // Mapping from pool address to its volatility state
    mapping(address => PoolVolatility) public poolVolatility;

    // ===== Parameters =====
    uint256 public filterPeriod;       // filter period (seconds)
    uint256 public decayPeriod;        // decay period (seconds)
    uint256 public reductionFactor;    // reduction factor for volatility decay (1e18 precision)
    uint256 public maxAccumulator;     // max value for volatility accumulator
    uint256 public variableFeeControl; // scaling factor for variable fee
    uint256 public baseFeeUnit;        // base fee per tick crossed (1e18 precision)
    address public tradeManager;

    constructor(
        uint256 _filterPeriod,
        uint256 _decayPeriod,
        uint256 _reductionFactor,
        uint256 _maxAccumulator,
        uint256 _variableFeeControl,
        uint256 _baseFeeUnit,
        address _tradeManager
    ) {
        filterPeriod = _filterPeriod;
        decayPeriod = _decayPeriod;
        reductionFactor = _reductionFactor;
        maxAccumulator = _maxAccumulator;
        variableFeeControl = _variableFeeControl;
        baseFeeUnit = _baseFeeUnit;
        tradeManager = _tradeManager;
    }

    /**
     * @notice Update the volatility state for a given pool.
     * @param pool Address of the pool
     * @param currentTick Current tick at the start of the transaction
     * @param ticksCrossed Number of ticks crossed in this transaction
     */
    function updateVolatility(
        address pool,
        int24 currentTick,
        uint256 ticksCrossed
    ) external {
        require(msg.sender == tradeManager, "Unauthorized");
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

    /**
     * @notice Compute the dynamic fee for a trade.
     * @param pool Address of the pool
     * @param ticksCrossed Number of ticks crossed by the trade
     * @param tradeSize Size of the trade in base units
     * @return fee Total fee amount for this trade
     */
    function computeFee(
        address pool,
        uint256 ticksCrossed,
        uint256 tradeSize
    ) external view returns (uint256 fee) {
        PoolVolatility storage pv = poolVolatility[pool];

        // Base fee: proportional to ticks crossed and trade size
        uint256 baseFee = (ticksCrossed * baseFeeUnit * tradeSize) / 1e18;

        // Variable fee: depends on accumulated volatility
        uint256 variableFee = (variableFeeControl * (pv.accumulator ** 2)) / 1e18;

        fee = baseFee + variableFee;
    }

    function _abs(int256 x) internal pure returns (uint256) {
        return x >= 0 ? uint256(x) : uint256(-x);
    }
}
