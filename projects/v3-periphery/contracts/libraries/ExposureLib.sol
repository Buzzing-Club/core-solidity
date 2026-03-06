// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

library ExposureLib {

    function calculateExposure(
        uint256 buyYesAmount,
        uint256 sellYesAmount,
        uint256 buyNoAmount,
        uint256 sellNoAmount,
        uint256 buyYesUSD,
        uint256 sellYesUSD,
        uint256 buyNoUSD,
        uint256 sellNoUSD,
        bool isYes
    ) external pure returns (int256) {

        int256 usdDiff =
            int256(buyYesUSD) +
            int256(buyNoUSD) -
            int256(sellYesUSD) -
            int256(sellNoUSD);

        return isYes
            ? int256(buyYesAmount) -
                int256(sellYesAmount) -
                usdDiff
            : int256(buyNoAmount) -
                int256(sellNoAmount) -
                usdDiff;
    }
}