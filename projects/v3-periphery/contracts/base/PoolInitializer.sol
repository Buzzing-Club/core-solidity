// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity =0.7.6;

import '@pancakeswap/v3-core/contracts/interfaces/IBubblySwapFactory.sol';
import '@pancakeswap/v3-core/contracts/interfaces/IBubblySwapPool.sol';

import './PeripheryImmutableState.sol';
import '../interfaces/IPoolInitializer.sol';

/// @title Creates and initializes V3 Pools
abstract contract PoolInitializer is IPoolInitializer, PeripheryImmutableState {
    /// @inheritdoc IPoolInitializer
    function createAndInitializePoolIfNecessary(
        address token0,
        address token1,
        uint24 fee,
        uint160 sqrtPriceX96
    ) external payable override returns (address pool) {
        require(token0 < token1);
        pool = IBubblySwapFactory(factory).getPool(token0, token1, fee);

        if (pool == address(0)) {
            pool = IBubblySwapFactory(factory).createPool(token0, token1, fee);
            IBubblySwapPool(pool).initialize(sqrtPriceX96);
        } else {
            (uint160 sqrtPriceX96Existing, , , , , , ) = IBubblySwapPool(pool).slot0();
            if (sqrtPriceX96Existing == 0) {
                IBubblySwapPool(pool).initialize(sqrtPriceX96);
            }
        }
    }
}
