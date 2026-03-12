# FeeRebateDistributor Usage

This document is for backend integration of `FeeRebateDistributor`.

## Overview
`FeeRebateDistributor` distributes fee rebates to users. If the contract balance is insufficient, it first claims pending rebates from `FeeAdapterTransparent` and then pays out.

## Prerequisites
1. In `FeeAdapterTransparent`, set the `feerebate` role recipient to the `FeeRebateDistributor` contract address.
2. Add backend wallets to the `auth` list so they can call `distribute`.

## Access Control
- `owner`: Admin role. Can set `auth` and update `feeAdapter`.
- `auth`: Authorized callers who can trigger `distribute`.

## Public Interface
### State
- `owner() -> address`
- `feeAdapter() -> address`
- `auth(address) -> bool`

### Admin
- `transferOwnership(address newOwner)`
- `setFeeAdapter(address newAdapter)`
- `setAuth(address account, bool allowed)`
- `revokeAuth(address account)`

### Distribution
- `distribute(address token, address to, uint256 amount)`
  - Reverts with `Not auth` if caller is not authorized.
  - Reverts with `Insufficient rebate balance` if not enough funds after claim.

## Events
- `OwnershipTransferred(address indexed previousOwner, address indexed newOwner)`
- `FeeAdapterUpdated(address indexed previousAdapter, address indexed newAdapter)`
- `AuthUpdated(address indexed account, bool allowed)`
- `FeeAdapterClaimed(address indexed token, uint256 amount)`
- `RebatePaid(address indexed token, address indexed to, uint256 amount)`

## ABI (minimal)
```json
[
  {
    "inputs": [{"internalType": "address", "name": "_feeAdapter", "type": "address"}],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "inputs": [],
    "name": "owner",
    "outputs": [{"internalType": "address", "name": "", "type": "address"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "feeAdapter",
    "outputs": [{"internalType": "address", "name": "", "type": "address"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{"internalType": "address", "name": "", "type": "address"}],
    "name": "auth",
    "outputs": [{"internalType": "bool", "name": "", "type": "bool"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{"internalType": "address", "name": "newOwner", "type": "address"}],
    "name": "transferOwnership",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{"internalType": "address", "name": "newAdapter", "type": "address"}],
    "name": "setFeeAdapter",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {"internalType": "address", "name": "account", "type": "address"},
      {"internalType": "bool", "name": "allowed", "type": "bool"}
    ],
    "name": "setAuth",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{"internalType": "address", "name": "account", "type": "address"}],
    "name": "revokeAuth",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {"internalType": "address", "name": "token", "type": "address"},
      {"internalType": "address", "name": "to", "type": "address"},
      {"internalType": "uint256", "name": "amount", "type": "uint256"}
    ],
    "name": "distribute",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "anonymous": false,
    "inputs": [
      {"indexed": true, "internalType": "address", "name": "previousOwner", "type": "address"},
      {"indexed": true, "internalType": "address", "name": "newOwner", "type": "address"}
    ],
    "name": "OwnershipTransferred",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {"indexed": true, "internalType": "address", "name": "previousAdapter", "type": "address"},
      {"indexed": true, "internalType": "address", "name": "newAdapter", "type": "address"}
    ],
    "name": "FeeAdapterUpdated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {"indexed": true, "internalType": "address", "name": "account", "type": "address"},
      {"indexed": false, "internalType": "bool", "name": "allowed", "type": "bool"}
    ],
    "name": "AuthUpdated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {"indexed": true, "internalType": "address", "name": "token", "type": "address"},
      {"indexed": false, "internalType": "uint256", "name": "amount", "type": "uint256"}
    ],
    "name": "FeeAdapterClaimed",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {"indexed": true, "internalType": "address", "name": "token", "type": "address"},
      {"indexed": true, "internalType": "address", "name": "to", "type": "address"},
      {"indexed": false, "internalType": "uint256", "name": "amount", "type": "uint256"}
    ],
    "name": "RebatePaid",
    "type": "event"
  }
]
```

## Notes for Backend
- If `distribute` reverts with `Not auth`, add the caller to `auth`.
- If it reverts with `Insufficient rebate balance`, check fee adapter pending balance and token funding.
- This contract does not pull funds from users; it only distributes.
