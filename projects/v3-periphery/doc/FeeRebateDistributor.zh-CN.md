# FeeRebateDistributor 使用说明

本说明面向后端集成 `FeeRebateDistributor`。

## 概览
`FeeRebateDistributor` 用于向用户分发手续费返利。当合约余额不足时，会先从 `FeeAdapterTransparent` 领取本合约的待领金额，再进行发放。

## 前置条件
1. 在 `FeeAdapterTransparent` 中，将 `feerebate` 角色的收款地址设置为 `FeeRebateDistributor` 合约地址。
2. 将后端发起交易的钱包地址加入 `auth` 白名单，以便调用 `distribute`。

## 权限模型
- `owner`：管理员权限，可设置 `auth`、更新 `feeAdapter`。
- `auth`：允许调用 `distribute` 发放返利。

## 对外接口
### 状态查询
- `owner() -> address`
- `feeAdapter() -> address`
- `auth(address) -> bool`

### 管理接口
- `transferOwnership(address newOwner)`
- `setFeeAdapter(address newAdapter)`
- `setAuth(address account, bool allowed)`
- `revokeAuth(address account)`

### 发放接口
- `distribute(address token, address to, uint256 amount)`
  - 若调用者未授权，回滚 `Not auth`
  - 若领取后仍不足，回滚 `Insufficient rebate balance`

## 事件
- `OwnershipTransferred(address indexed previousOwner, address indexed newOwner)`
- `FeeAdapterUpdated(address indexed previousAdapter, address indexed newAdapter)`
- `AuthUpdated(address indexed account, bool allowed)`
- `FeeAdapterClaimed(address indexed token, uint256 amount)`
- `RebatePaid(address indexed token, address indexed to, uint256 amount)`

## ABI（精简版）
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

## 后端注意事项
- `distribute` 报 `Not auth`：说明调用地址未授权，请先调用 `setAuth`。
- `distribute` 报 `Insufficient rebate balance`：本合约余额不足且 `feeAdapter` 也无可领金额。
- 本合约不会从用户处拉取资金，只负责分发。
