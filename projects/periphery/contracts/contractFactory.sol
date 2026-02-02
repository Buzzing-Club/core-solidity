// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity =0.7.6;


import './depositContract.sol';

contract ContractFactory {
    address public owner;
    address public usdbAddr;
    address public usdcAddr;
    Parameters public parameters;
    struct Parameters {
        address factoryOwner;
        address usdbAddr;
        address usdcAddr;
        address eoa;
    }
    constructor(address _usdbAddr, address _usdcAddr) {
        owner = msg.sender;
        usdbAddr = _usdbAddr;
        usdcAddr = _usdcAddr;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    function deploy(
        address eoa
    ) external onlyOwner returns (address depositContractAddr) {
        parameters = Parameters({factoryOwner: owner, usdbAddr: usdbAddr, usdcAddr: usdcAddr, eoa: eoa}); 
        depositContractAddr = address(new DepositContract{salt: keccak256(abi.encode(usdcAddr, usdbAddr,eoa))}());
        delete parameters;
    }
}
