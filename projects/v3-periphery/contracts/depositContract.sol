// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity =0.7.6;
interface IBLP{
    function traderDeposit(address account, uint256 amount) external;
}
interface IERC20{
    function balanceOf(address account) external returns (uint256);
}
interface IContractFactory{
    function parameters()
        external
        view
        returns (
            address factoryOwner,
            address BLPAddr,
            address usdcAddr,
            address eoa
        );
}

contract DepositContract {
    address public eoa;
    address public factoryOwner;
    address public BLPAddr;
    address public usdcAddr;
    modifier onlyFactoryOnwer() {
        require(msg.sender == factoryOwner, "only factory owner can do");
        _;
    }
    constructor() {
        (factoryOwner, BLPAddr, usdcAddr, eoa) = IContractFactory(msg.sender).parameters();
    }
    function deposit(address to) external onlyFactoryOnwer {
        uint256 amount = IERC20(usdcAddr).balanceOf(address(this));
        IBLP(BLPAddr).traderDeposit(to, amount);
    }
}
