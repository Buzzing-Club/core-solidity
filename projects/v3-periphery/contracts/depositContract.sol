// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity =0.7.6;
interface IUSDB{
    function deposit(address account, uint256 amount) external;
    
}
interface IERC20{
    function balanceOf(address account) external returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
}
interface IContractFactory{
    function parameters()
        external
        view
        returns (
            address factoryOwner,
            address usdbAddr,
            address usdcAddr,
            address eoa
        );
}

contract DepositContract {
    address public eoa;
    address public factoryOwner;
    address public usdbAddr;
    address public usdcAddr;
    modifier onlyFactoryOnwer() {
        require(msg.sender == factoryOwner, "only factory owner can do");
        _;
    }
    constructor() {
        (factoryOwner, usdbAddr, usdcAddr, eoa) = IContractFactory(msg.sender).parameters();
    }
    function deposit(address to) external onlyFactoryOnwer {
        uint256 amount = IERC20(usdcAddr).balanceOf(address(this));
        IERC20(usdcAddr).approve(usdbAddr, amount);
        IUSDB(usdbAddr).deposit(to, amount);
    }
}
