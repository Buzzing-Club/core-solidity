// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity =0.7.6;
pragma abicoder v2;

import '@pancakeswap/v3-core/contracts/libraries/SafeCast.sol';
import '@pancakeswap/v3-core/contracts/libraries/TickMath.sol';
import '@pancakeswap/v3-core/contracts/libraries/TickBitmap.sol';
import '@pancakeswap/v3-core/contracts/interfaces/IBuzzingSwapPool.sol';
import '@pancakeswap/v3-core/contracts/interfaces/callback/IBuzzingSwapSwapCallback.sol';

import '../interfaces/IQuoterV2.sol';
import '../base/PeripheryImmutableState.sol';
import '../libraries/Path.sol';
import '../libraries/PoolAddress.sol';
import '../libraries/CallbackValidation.sol';
import '../libraries/PoolTicksCounter.sol';

contract QuoterV2 is IBuzzingSwapSwapCallback, PeripheryImmutableState {
    struct QuoteExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint24 fee;
        uint160 sqrtPriceLimitX96;
    }

    struct QuoteExactOutputSingleParams {
        address tokenIn;
        address tokenOut;
        uint256 amount;
        uint24 fee;
        uint160 sqrtPriceLimitX96;
    }

    using Path for bytes;
    using SafeCast for uint256;
    using PoolTicksCounter for IBuzzingSwapPool;

    uint256 private amountOutCached;

    constructor(address _deployer, address _factory, address _WETH9)
        PeripheryImmutableState(_deployer, _factory, _WETH9)
    {}

    function getPool(address tokenA, address tokenB, uint24 fee) private view returns (IBuzzingSwapPool) {
        return IBuzzingSwapPool(PoolAddress.computeAddress(deployer, PoolAddress.getPoolKey(tokenA, tokenB, fee)));
    }

    function BuzzingSwapSwapCallback(
        int256 amount0Delta,
        int256 amount1Delta,
        bytes memory path
    ) external view override {
        require(amount0Delta > 0 || amount1Delta > 0, "Zero swap delta");

        (address tokenIn, address tokenOut, uint24 fee) = path.decodeFirstPool();
        CallbackValidation.verifyCallback(deployer, tokenIn, tokenOut, fee);

        (bool isExactInput, uint256 amountToPay, uint256 amountReceived) =
            amount0Delta > 0
                ? (tokenIn < tokenOut, uint256(amount0Delta), uint256(-amount1Delta))
                : (tokenOut < tokenIn, uint256(amount1Delta), uint256(-amount0Delta));

        IBuzzingSwapPool pool = getPool(tokenIn, tokenOut, fee);
        (uint160 sqrtPriceX96After, int24 tickAfter, , , , , ) = pool.slot0();

        if (isExactInput) {
            assembly {
                let ptr := mload(0x40)
                mstore(ptr, amountReceived)
                mstore(add(ptr, 0x20), sqrtPriceX96After)
                mstore(add(ptr, 0x40), tickAfter)
                mstore(add(ptr, 0x60), amountToPay)
                revert(ptr, 128)
            }
        } else {
            if (amountOutCached != 0) require(amountReceived == amountOutCached, "Invalid amountOutCached");
            assembly {
                let ptr := mload(0x40)
                mstore(ptr, amountToPay)
                mstore(add(ptr, 0x20), sqrtPriceX96After)
                mstore(add(ptr, 0x40), tickAfter)
                mstore(add(ptr, 0x60), amountReceived)
                revert(ptr, 128)
            }
        }
    }

    function parseRevertReason(bytes memory reason)
        private
        pure
        returns (
            uint256 amount,
            uint160 sqrtPriceX96After,
            int24 tickAfter,
            uint256 extra
        )
    {
        if (reason.length != 128) {
            if (reason.length < 68) revert("Unexpected error");
            assembly {
                reason := add(reason, 0x04)
            }
            revert(abi.decode(reason, (string)));
        }
        return abi.decode(reason, (uint256, uint160, int24, uint256));
    }

    function handleRevert(
        bytes memory reason,
        IBuzzingSwapPool pool
    ) private view returns (
        uint256 amount,
        uint160 sqrtPriceX96After,
        uint32 initializedTicksCrossed,
        uint256 extra
    ) {
        int24 tickBefore;
        int24 tickAfter;
        (, tickBefore, , , , , ) = pool.slot0();
        (amount, sqrtPriceX96After, tickAfter, extra) = parseRevertReason(reason);
        initializedTicksCrossed = pool.countInitializedTicksCrossed(tickBefore, tickAfter);
        return (amount, sqrtPriceX96After, initializedTicksCrossed, extra);
    }

    function quoteExactInputSingle(QuoteExactInputSingleParams memory params)
        public
        returns (
            uint256 amountOut,
            uint160 sqrtPriceX96After,
            uint32 initializedTicksCrossed,
            uint256 amountToPay
        )
    {
        bool zeroForOne = params.tokenIn < params.tokenOut;
        IBuzzingSwapPool pool = getPool(params.tokenIn, params.tokenOut, params.fee);

        try
            pool.swap(
                address(this),
                zeroForOne,
                params.amountIn.toInt256(),
                params.sqrtPriceLimitX96 == 0
                    ? (zeroForOne ? TickMath.MIN_SQRT_RATIO + 1 : TickMath.MAX_SQRT_RATIO - 1)
                    : params.sqrtPriceLimitX96,
                abi.encodePacked(params.tokenIn, params.fee, params.tokenOut)
            )
        {} catch (bytes memory reason) {
            return handleRevert(reason, pool);
        }

        revert("Swap did not revert as expected");
    }

    function quoteExactOutputSingle(QuoteExactOutputSingleParams memory params)
        public
        returns (
            uint256 amountIn,
            uint160 sqrtPriceX96After,
            uint32 initializedTicksCrossed,
            uint256 amountReceived
        )
    {
        bool zeroForOne = params.tokenIn < params.tokenOut;
        IBuzzingSwapPool pool = getPool(params.tokenIn, params.tokenOut, params.fee);

        if (params.sqrtPriceLimitX96 == 0) amountOutCached = params.amount;

        try
            pool.swap(
                address(this),
                zeroForOne,
                -params.amount.toInt256(),
                params.sqrtPriceLimitX96 == 0
                    ? (zeroForOne ? TickMath.MIN_SQRT_RATIO + 1 : TickMath.MAX_SQRT_RATIO - 1)
                    : params.sqrtPriceLimitX96,
                abi.encodePacked(params.tokenOut, params.fee, params.tokenIn)
            )
        {} catch (bytes memory reason) {
            if (params.sqrtPriceLimitX96 == 0) delete amountOutCached;
            return handleRevert(reason, pool);
        }

        revert("Swap did not revert as expected");
    }
}