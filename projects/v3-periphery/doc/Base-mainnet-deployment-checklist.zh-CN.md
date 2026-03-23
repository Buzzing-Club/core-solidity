# Base 主网部署检查清单（Checklist）

> 网络：Base Mainnet（chainId: 8453）  
> 目标：部署完成后，逐项核对资产地址与权限是否符合预期。

## 0. 角色钱包（目标口径）
- 俱乐部自动发布 / 阶段转换 / 费用返还分配 / PreTrading 流动性迁移：`0xd1729ee9687408544e5e91c0220c5b2e69EfF2Ac`
- 限价单钱包：`0x1755a2C33f32fD9d211bBaC64E85DA0E71B0C3a5`
- 代充值钱包：`0x4b9E4e5543Ce2F93D23566303aAb91ee63CeEF1d`

---

## 1. 资产地址检查（USDC / USDB）

### 1.1 基础地址（必须一致）
- [ ] Base 链 USDC 地址 = `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913`
- [ ] 本次部署 USDB 地址 = `0xF3B63DD097d1787E9c0Af4b243fa157dDfd5BBfB`

### 1.2 合约内资产引用检查
- [ ] `TradeManager.usdbTokenAddress()` == `0xF3B63DD097d1787E9c0Af4b243fa157dDfd5BBfB`
- [ ] `TradeManager.usdc()`（或等价 getter）== `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913`
- [ ] `PreTrading` 内稳定币地址（当前语义为 USDB）== `0xF3B63DD097d1787E9c0Af4b243fa157dDfd5BBfB`
- [ ] `tBLP.asset()` / `sBLP.asset()`（若有 getter）与 USDB 地址一致

> 建议：以上每项记录一次 `cast call` 或前端读链截图，避免口头确认。

---

## 2. Owner 权限检查

### 2.1 ContractFactory
- 合约地址：`0xBaaCB22D53BAf6aFeDacA77692639eC5bBB0ca18`
- [ ] `owner()` == `0x4b9E4e5543Ce2F93D23566303aAb91ee63CeEF1d`
- [ ] 若不一致，执行 `transferOwnership(0x4b9E4e5543Ce2F93D23566303aAb91ee63CeEF1d)`

### 2.2 BuzzingSwapFactory
- 合约地址：`0x19405b671f0e5797a8EC6AC5A2b51F15BD537032`
- [ ] `owner()` == `0xd1729ee9687408544e5e91c0220c5b2e69EfF2Ac`
- [ ] 若不一致，执行 `setOwner(0xd1729ee9687408544e5e91c0220c5b2e69EfF2Ac)`

### 2.3 FeeAdapterTransparent（建议纳入）
- 合约地址：`0x122ea913388bb4bb95933e6D8788d9C9eB723E4c`
- [ ] `owner()` == `0xd1729ee9687408544e5e91c0220c5b2e69EfF2Ac`

### 2.4 FeeRebateDistributor
- 合约地址：`0xEb81F8bc021aF56326d5704Eb4dc1b857dEc2C00`
- [ ] `owner()` 已按你们运营口径配置（记录实际地址）

### 2.5 PreTrading（只核对，不要求迁移）
- 合约地址：`0x849Dfcd894c8da34ae0F78EA894cD6D14804517d`
- [ ] `owner()` 保持现状（记录实际地址）

---

## 3. Auth / Oracle 权限检查

### 3.1 TradeManager auth（wards）
- 合约地址：`0x81831E2682aa85D76898a0B0D8Ce7f939D10EDF6`
- [ ] `wards(0xd1729ee9687408544e5e91c0220c5b2e69EfF2Ac) == 1`（俱乐部自动发布/阶段转换相关）
- [ ] `wards(0x1755a2C33f32fD9d211bBaC64E85DA0E71B0C3a5) == 1`（限价单）
- [ ] `wards(0x4b9E4e5543Ce2F93D23566303aAb91ee63CeEF1d)` 按需（默认可不配，除非代充值需要调用 TM 管理函数）

### 3.2 FeeRebateDistributor auth
- 合约地址：`0xEb81F8bc021aF56326d5704Eb4dc1b857dEc2C00`
- [ ] `auth(0xd1729ee9687408544e5e91c0220c5b2e69EfF2Ac) == true`
- [ ] `auth(0x1755a2C33f32fD9d211bBaC64E85DA0E71B0C3a5)` 按需（通常不必）
- [ ] `auth(0x4b9E4e5543Ce2F93D23566303aAb91ee63CeEF1d)` 按需（通常不必）

### 3.3 PreTrading oracle
- 合约地址：`0x849Dfcd894c8da34ae0F78EA894cD6D14804517d`
- [ ] `oracle() == 0xd1729ee9687408544e5e91c0220c5b2e69EfF2Ac`

---

## 4. Fee 配置联动检查（建议）

### 4.1 FeeAdapter 角色分成口径
- [ ] `poolTotalFeeRatio(pool)` == 10000（即 1%）
- [ ] `protocol` 份额 == 8000（80%）
- [ ] `refer` 份额 == 1000（10%）
- [ ] `feeRebate` 份额 == 1000（10%）
- [ ] `protocol` 的 recipient == 协议钱包（按运营口径，记录最终地址）
- [ ] `feeRebate` 的 recipient == `FeeRebateDistributor` 合约地址（`0xEb81F8bc021aF56326d5704Eb4dc1b857dEc2C00`）
- [ ] `refer` 的 recipient 逻辑已确认（有推荐人时给推荐人，无推荐人时按合约逻辑回落）

### 4.2 收费地址可领校验
- [ ] `FeeAdapter` 上各角色 recipient 设置正确（记录地址）
- [ ] `FeeRebateDistributor` 可正常 `distribute`（auth 地址实测）
- [ ] `FeeAdapter.poolRoleRecipients(pool, protocolRole)` 读链结果留档
- [ ] `FeeAdapter.poolRoleRecipients(pool, feeRebateRole)` 读链结果留档

---

## 5. 动态 Fee 参数检查（含 r80 口径）

### 5.1 DynamicFeeManager 地址与绑定关系
- [ ] `TradeManager.dynamicFeeManager()`（或等价配置项）已指向预期 `DynamicFeeManager`
- [ ] `FeeAdapter` / `TradeManager` 动态费读取链路已启用（不是零地址或未初始化状态）

### 5.2 参数值检查（按 `f2-v3000-r80-d14` 固定口径）
- [ ] `filterPeriod == 2`
- [ ] `decayPeriod == 14`
- [ ] `reductionFactor == 800000000000000000`（`0.8e18`）
- [ ] `maxAccumulator == 1000000000`
- [ ] `variableFeeControl == 3000000000000000`（`3e15`）
- [ ] `baseFeeUnit == 2000000000000`（`2e12`）
- [ ] 以上参数均与记录文档一致：`test/trade/reports/dynamic-fee-r80-final-params.zh-CN.md`

### 5.3 功能侧快速校验（建议）
- [ ] 读取一次 `poolVolatility(pool)`，记录 `referenceTick/referenceVolatility/accumulator`
- [ ] 用同一 pool 做 2 笔不同频率交易（低频/高频），对比 `computeFee(...)` 输出，确认动态费有变化
- [ ] 将读链结果截图或 `cast call` 输出附在部署记录中

---

## 6. 为什么需要 owner 转移（说明）

### 6.1 ContractFactory -> 代充值钱包
- 原因：代充值钱包需要直接执行工厂级管理操作（创建/配置相关流程），因此必须具备 `owner` 权限。
- 风险控制：只转移到指定运营钱包，避免部署私钥长期持有生产管理权限。

### 6.2 BuzzingSwapFactory -> 俱乐部自动发布钱包
- 原因：俱乐部自动发布、阶段转换等运营动作依赖工厂 owner 能力（池级参数/管理动作）。
- 风险控制：将运营权限与部署权限分离，减少单点私钥风险并便于权限审计。

### 6.3 PreTrading owner 不转移，仅设置 oracle
- 原因：你们当前策略是保留 PreTrading 管理 owner，不做所有权迁移；仅把业务执行权（oracle）交给运营钱包。
- 好处：既满足日常迁移/阶段操作，又保留核心治理权限在原 owner 体系。

### 6.4 FeeRebateDistributor / TradeManager 用 auth 而非 owner
- 原因：这两个合约日常动作主要依赖白名单授权（`auth` / `wards`），不需要把 owner 一并转移。
- 好处：最小权限原则，运营钱包只拿到必需执行权限，不拿全局管理权。

---

## 7. 部署后功能冒烟检查（最小集）
- [ ] 基础交易：`buyYes / buyNo / sellYes / sellNo` 至少各 1 笔成功
- [ ] 费用路径：交易后 `FeeAdapter` 费用余额有变化
- [ ] 返利路径：`FeeRebateDistributor.distribute` 成功 1 笔
- [ ] PreTrading：oracle 可调用路径正常（按业务脚本跑 1 次）

---

## 8. 变更留档（必填）

### 8.1 交易哈希记录
- [ ] ContractFactory owner 迁移 tx: `__________`
- [ ] BuzzingSwapFactory owner 迁移 tx: `__________`
- [ ] TradeManager rely(d1729...) tx: `__________`
- [ ] TradeManager rely(1755...) tx: `__________`
- [ ] FeeRebateDistributor setAuth(d1729...) tx: `__________`
- [ ] PreTrading setOracle(d1729...) tx: `__________`
- [ ] FeeAdapter 设置 `protocol` recipient tx: `__________`
- [ ] FeeAdapter 设置 `feeRebate` recipient tx: `__________`
- [ ] DynamicFeeManager 参数配置 tx: `__________`

### 8.2 最终验收签字
- [ ] 资产地址一致性通过
- [ ] owner / auth / oracle 权限通过
- [ ] fee recipient（protocol / feeRebate）通过
- [ ] dynamic fee（r80 参数）通过
- [ ] 冒烟测试通过
- [ ] 文档与链上状态一致

---

## 9. 建议执行顺序
1. 先核对资产地址（USDC/USDB）
2. 再做 owner 迁移（ContractFactory / BuzzingSwapFactory / FeeAdapter 如需）
3. 再做 auth 与 oracle（TradeManager / FeeRebateDistributor / PreTrading）
4. 再核对 FeeAdapter role recipient（protocol / feeRebate）
5. 再核对 DynamicFeeManager 参数（r80）
6. 最后执行功能冒烟 + 留档
