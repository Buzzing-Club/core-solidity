// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IFeeManager {
    /**
     * @notice Update volatility state for a given pool
     * @param pool The pool address
     * @param currentTick The current tick of the pool
     * @param ticksCrossed Number of ticks crossed in this transaction
     */
    function updateVolatility(
        address pool,
        int24 currentTick,
        uint256 ticksCrossed
    ) external;

    /**
     * @notice Compute dynamic fee for a swap
     * @param pool The pool address
     * @param ticksCrossed Number of ticks crossed in this transaction
     * @param amountIn Input swap amount
     * @return fee The dynamic fee in units of token
     */
    function computeFee(
        address pool,
        uint256 ticksCrossed,
        uint256 amountIn
    ) external view returns (uint256 fee);

    /**
     * @notice Get current volatility accumulator for a pool
     * @param pool The pool address
     * @return va Current volatility accumulator
     */
    function getVolatility(address pool) external view returns (uint256 va);

    /**
     * @notice Get last updated tick for a pool
     * @param pool The pool address
     * @return tick Last recorded tick
     */
    function getLastTick(address pool) external view returns (int24 tick);

    /**
     * @notice Get last update timestamp for a pool
     * @param pool The pool address
     * @return ts Last update time in seconds
     */
    function getLastUpdate(address pool) external view returns (uint256 ts);
}
