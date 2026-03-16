# Base 主网权限迁移与操作清单（待确认）

## 1. 钱包角色
- 俱乐部自动发布 / 阶段转换 / 费用返还分配 / PreTrading 流动性迁移：`0xd1729ee9687408544e5e91c0220c5b2e69EfF2Ac`
- 代充值：`0x4b9E4e5543Ce2F93D23566303aAb91ee63CeEF1d`

## 2. 本次需要执行的核心变更

### A. `ContractFactory` owner 转移到代充值钱包
- 合约：`ContractFactory`
- 地址（Base）：`0xBaaCB22D53BAf6aFeDacA77692639eC5bBB0ca18`
- 调用函数：`transferOwnership(address newOwner)`
- 参数：`newOwner = 0x4b9E4e5543Ce2F93D23566303aAb91ee63CeEF1d`
- 发起钱包：当前 `ContractFactory.owner()`

### B. `BuzzingSwapFactory` owner 转移到俱乐部自动发布钱包
- 合约：`BuzzingSwapFactory`
- 地址（Base）：`0x19405b671f0e5797a8EC6AC5A2b51F15BD537032`
- 调用函数：`setOwner(address _owner)`
- 参数：`_owner = 0xd1729ee9687408544e5e91c0220c5b2e69EfF2Ac`
- 发起钱包：当前 `BuzzingSwapFactory.owner()`

### C. 在 `TradeManager` 添加 auth 权限
- 合约：`tradeManager`（Proxy）
- 地址（Base）：`0x81831E2682aa85D76898a0B0D8Ce7f939D10EDF6`
- 调用函数：`rely(address usr)`
- 参数（建议）：`usr = 0xd1729ee9687408544e5e91c0220c5b2e69EfF2Ac`
- 发起钱包：任一当前 `wards == 1` 的地址

### D. 在 `FeeRebateDistributor` 添加 auth 权限
- 合约：`FeeRebateDistributor`
- 地址（Base）：`0xEb81F8bc021aF56326d5704Eb4dc1b857dEc2C00`
- 调用函数：`setAuth(address account, bool allowed)`
- 参数（建议）：`account = 0xd1729ee9687408544e5e91c0220c5b2e69EfF2Ac`, `allowed = true`
- 发起钱包：当前 `FeeRebateDistributor.owner()`

### E. `PreTrading` 只设置 oracle（owner 不转移）
- 合约：`PreTrading`
- 地址（Base）：`0x036Ec260669DF432C098fC2B8603854D189ec89B`
- 调用函数：`setOracle(address newOracle)`
- 参数：`newOracle = 0xd1729ee9687408544e5e91c0220c5b2e69EfF2Ac`
- 发起钱包：当前 `PreTrading.owner()`

## 3. 和你描述相关的业务功能对应关系
- 俱乐部自动发布、阶段转换：通常依赖 `BuzzingSwapFactory` owner 权限（如白名单、费率配置、池相关管理）
- 费用返还分配：依赖 `FeeRebateDistributor` 的 `auth`（可调用 `distribute`）
- PreTrading 流动性迁移：
  - 用户资金操作本身多为用户可调用函数
  - 若涉及管理操作，主要是 `PreTrading` 的 `owner` / `oracle` 权限

## 4. `PreTrading` 权限策略（已确认）
- 本次仅执行：`setOracle(0xd1729ee9687408544e5e91c0220c5b2e69EfF2Ac)`
- `PreTrading.owner` 不转移，保留现状

## 5. 建议执行顺序
1. 先做 owner 迁移：`ContractFactory`、`BuzzingSwapFactory`
2. 再做权限授权：`TradeManager.rely`、`FeeRebateDistributor.setAuth`
3. 设置 `PreTrading` oracle
4. 最后做验收检查（链上读状态）

## 6. 验收检查项（每步后都建议检查）
- `ContractFactory.owner() == 0x4b9E4e5543Ce2F93D23566303aAb91ee63CeEF1d`
- `BuzzingSwapFactory.owner() == 0xd1729ee9687408544e5e91c0220c5b2e69EfF2Ac`
- `TradeManager.wards(0xd1729ee9687408544e5e91c0220c5b2e69EfF2Ac) == 1`
- `FeeRebateDistributor.auth(0xd1729ee9687408544e5e91c0220c5b2e69EfF2Ac) == true`
- `PreTrading.oracle() == 0xd1729ee9687408544e5e91c0220c5b2e69EfF2Ac`

## 7. 待你确认的一个点
1. `TradeManager` 与 `FeeRebateDistributor` 的 auth 是否只加给 `0xd1729...F2Ac`？是否也要给 `0x4b9E...EF1d`？
