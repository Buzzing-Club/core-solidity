// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.5.0;

import './pool/IBubblySwapPoolImmutables.sol';
import './pool/IBubblySwapPoolState.sol';
import './pool/IBubblySwapPoolDerivedState.sol';
import './pool/IBubblySwapPoolActions.sol';
import './pool/IBubblySwapPoolOwnerActions.sol';
import './pool/IBubblySwapPoolEvents.sol';

/// @title The interface for a PancakeSwap V3 Pool
/// @notice A PancakeSwap pool facilitates swapping and automated market making between any two assets that strictly conform
/// to the ERC20 specification
/// @dev The pool interface is broken up into many smaller pieces
interface IBubblySwapPool is
    IBubblySwapPoolImmutables,
    IBubblySwapPoolState,
    IBubblySwapPoolDerivedState,
    IBubblySwapPoolActions,
    IBubblySwapPoolOwnerActions,
    IBubblySwapPoolEvents
{

}
