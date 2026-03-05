// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.5.0;

import './pool/IBuzzingSwapPoolImmutables.sol';
import './pool/IBuzzingSwapPoolState.sol';
import './pool/IBuzzingSwapPoolDerivedState.sol';
import './pool/IBuzzingSwapPoolActions.sol';
import './pool/IBuzzingSwapPoolOwnerActions.sol';
import './pool/IBuzzingSwapPoolEvents.sol';

/// @title The interface for a BuzzingSwap V3 Pool
/// @notice A BuzzingSwap pool facilitates swapping and automated market making between any two assets that strictly conform
/// to the ERC20 specification
/// @dev The pool interface is broken up into many smaller pieces
interface IBuzzingSwapPool is
    IBuzzingSwapPoolImmutables,
    IBuzzingSwapPoolState,
    IBuzzingSwapPoolDerivedState,
    IBuzzingSwapPoolActions,
    IBuzzingSwapPoolOwnerActions,
    IBuzzingSwapPoolEvents
{

}
