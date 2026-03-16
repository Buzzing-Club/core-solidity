// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20Batch {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

contract BatchDistributor {
    address public immutable owner;

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    receive() external payable {}

    function batchDistributeETHAmounts(
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external payable onlyOwner {
        uint256 len = recipients.length;
        require(len > 0, "Empty recipients");
        require(len == amounts.length, "Length mismatch");

        uint256 total;
        for (uint256 i = 0; i < len; ) {
            total += amounts[i];
            unchecked {
                ++i;
            }
        }
        require(msg.value == total, "Invalid msg.value");

        for (uint256 i = 0; i < len; ) {
            uint256 amount = amounts[i];
            if (amount > 0) {
                (bool ok, ) = payable(recipients[i]).call{value: amount}("");
                require(ok, "ETH transfer failed");
            }
            unchecked {
                ++i;
            }
        }
    }

    function batchDistributeERC20Amounts(
        address token,
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external onlyOwner {
        uint256 len = recipients.length;
        require(len > 0, "Empty recipients");
        require(len == amounts.length, "Length mismatch");

        IERC20Batch erc20 = IERC20Batch(token);
        uint256 total;
        for (uint256 i = 0; i < len; ) {
            total += amounts[i];
            unchecked {
                ++i;
            }
        }

        require(erc20.transferFrom(msg.sender, address(this), total), "Pull token failed");

        for (uint256 i = 0; i < len; ) {
            uint256 amount = amounts[i];
            if (amount > 0) {
                require(erc20.transfer(recipients[i], amount), "Token transfer failed");
            }
            unchecked {
                ++i;
            }
        }
    }
}
