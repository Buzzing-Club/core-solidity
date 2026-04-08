# 代金券发放系统核心设计方案（后端发放逻辑，全量版本）

## 1. 背景与目标
本方案仅覆盖“后端发放逻辑 + 协议侧校验与记账”，不包含前端交互细节。

目标是支持：

- 后端发起 Voucher 发放
- 发放时从营销预算口径铸造等额 `USDB` 给用户
- 用户可见余额增加，但其中一部分属于“受限余额”
- 提现时禁止提取受限余额
- Trading / Pre-trading / Liquidity Vault / Orderbook 使用 `USDB` 时，按 Voucher 规则做前置校验
- 交易完成后按活动要求累计进度，满足条件后解除资金锁定

本方案优先考虑与 Orderbook 一起上线，尽量少动现有资产层。

---

## 2. 现状与问题
当前 [`USDB.sol`](/d:/buzzing/projects/v3-periphery/contracts/USDB.sol) 的语义是“统一余额 ERC20 + vault 可 mint/burn 的业务稳定币”。

当前设计存在以下限制：

- `balanceOf(user)` 无法区分“用户充值余额”和“Voucher 余额”
- 无法表达“只能用于某些功能 / 市场 / Vault”
- 无法表达“满足后置条件后再解锁”
- 若仅依赖前端拦截，协议层缺少一致性约束
- 当前 `USDB` 不是代理部署，若直接对 `USDB` 做大改，会引入迁移和重绑成本

因此，本方案不建议把 Voucher 规则直接塞进 `USDB` 的 ERC20 余额逻辑，而是增加独立账本与校验中心。

---

## 3. 设计结论
推荐采用：

- `USDB`：资产层，只负责统一余额
- `VoucherController`：Voucher 账本、前置校验、后置累计与解锁
- `TradeManager / PreTrading / Liquidity Vault / Orderbook`：业务入口，在消费前后接入 `VoucherController`

一句话总结：

> `USDB` 负责“钱”，`VoucherController` 负责“这笔钱怎么花、什么时候能解锁”。

---

## 4. 总体架构
### 4.1 组件
- `USDB`
  - 继续作为用户看到的统一稳定币余额
  - 发券时由授权模块 mint 给用户

- `VoucherController`
  - 记录每一笔 Voucher
  - 聚合用户受限额度
  - 提供提现校验
  - 提供功能使用校验
  - 提供交易完成后的累计与解锁

- `Issuer / Backend Signer`
  - 由后端服务或 MPC 控制的钱包
  - 负责发券请求上链

- `Authorized Consumer`
  - 包括 `TradeManager`、`PreTrading`、Liquidity Vault 入口、Orderbook 入口
  - 在消费前调用只读校验
  - 在交易完成后调用进度累计

### 4.2 核心原则
- 用户仍只持有一种 `USDB`
- Voucher 不新发第二种 token
- 所有限制沉到协议侧，不只依赖前端
- Stage 1 先做“功能级限制”
- Stage 2 再做“市场 / Vault 粒度限制”

---

## 5. Voucher 模型
### 5.1 Voucher 实例
建议按“券实例”记账，而不是只做用户汇总，便于后续扩展活动规则。

```solidity
struct Voucher {
    uint256 id;
    address user;
    uint256 totalAmount;
    uint256 spentAmount;
    uint256 lockedAmount;

    uint64 startTime;
    uint64 endTime;

    uint8 status;
    uint32 featureMask;

    bytes32 campaignId;

    uint8 ruleType;
    uint256 targetVolume;
    uint256 currentVolume;

    bool restrictWithdraw;
}
```

字段说明：

- `totalAmount`
  - 本次发券总额
- `spentAmount`
  - 已在业务场景中消耗的金额
- `lockedAmount`
  - 当前仍不可提现的金额
- `status`
  - `Active / Unlocked / Exhausted / Expired / Revoked`
- `featureMask`
  - 功能白名单位图
- `campaignId`
  - 活动标识，便于后端归档
- `ruleType`
  - 解锁规则类型
- `targetVolume / currentVolume`
  - 后置条件的目标值与已完成值
- `restrictWithdraw`
  - 是否限制提现

### 5.2 功能位图
建议初版定义：

- bit 0: Trading
- bit 1: Pre-trading
- bit 2: Liquidity Vault
- bit 3: Orderbook

示例：

- 仅 Trading：`0001`
- Trading + Pre-trading：`0011`
- Liquidity Vault + Orderbook：`1100`

### 5.3 规则类型
建议定义：

- `0`: 无后置要求，发放即解锁或仅功能限制
- `1`: 指定功能累计交易量解锁
- `2`: 指定功能 + 指定市场累计交易量解锁
- `3`: 指定 Vault 累计使用量解锁

---

## 6. 用户汇总视图
为便于前端和业务合约快速校验，建议维护用户侧汇总值。

```solidity
mapping(address => uint256) public userLockedVoucherAmount;
mapping(address => uint256[]) public userVoucherIds;
```

含义：

- `userLockedVoucherAmount[user]`
  - 用户当前所有不可提现 Voucher 余额汇总
- `userVoucherIds[user]`
  - 用户名下所有 Voucher 实例列表

可进一步补充：

```solidity
function withdrawableBalance(address user, uint256 usdbBalance) external view returns (uint256);
function lockedVoucherBalance(address user) external view returns (uint256);
```

提现可用余额口径：

```text
withdrawable = usdb.balanceOf(user) - userLockedVoucherAmount[user]
```

---

## 7. Stage 1 与 Stage 2 范围
### 7.1 Stage 1
先支持：

- Voucher 限制提现
- Voucher 限制功能使用范围
- Voucher 按功能累计交易量解锁

此阶段不要求支持市场 / Vault 白名单存储。

### 7.2 Stage 2
在 Stage 1 基础上增加：

- Voucher 只允许特定市场使用
- Voucher 只允许特定 Vault 使用
- 按市场 / Vault 维度累计进度并解锁

为此需要补充：

```solidity
mapping(uint256 => mapping(bytes32 => bool)) public voucherAllowedTargets;
```

其中 `targetId` 在不同场景的约定如下：

- Trading / Pre-trading / Orderbook：使用市场或 pool 对应的 `bytes32` 标识
- Liquidity Vault：使用 Vault 地址映射成固定 `bytes32`

---

## 8. 发券流程
### 8.1 链上目标
发券时需要同时完成两件事：

1. 给用户增加 `USDB` 余额
2. 给用户增加一笔受限 Voucher 记录

### 8.2 推荐流程
1. 后端确认发券参数
2. 从营销预算口径补充等额 `USDC` 到 vault 资金侧
3. 由授权模块将等额 `USDB` mint 给用户
4. 调用 `VoucherController.issueVoucher(...)` 创建 Voucher 账本记录
5. 记录链上事件，供后端审计与对账

### 8.3 推荐接口
```solidity
function issueVoucher(
    address user,
    uint256 amount,
    uint32 featureMask,
    bool restrictWithdraw,
    uint8 ruleType,
    uint256 targetVolume,
    uint64 startTime,
    uint64 endTime,
    bytes32 campaignId
) external onlyIssuer returns (uint256 voucherId);
```

可选扩展：

```solidity
function issueVoucherWithTargets(
    address user,
    uint256 amount,
    uint32 featureMask,
    bool restrictWithdraw,
    uint8 ruleType,
    uint256 targetVolume,
    uint64 startTime,
    uint64 endTime,
    bytes32 campaignId,
    bytes32[] calldata targetIds
) external onlyIssuer returns (uint256 voucherId);
```

### 8.4 发券事件
```solidity
event VoucherIssued(
    uint256 indexed voucherId,
    address indexed user,
    uint256 amount,
    uint32 featureMask,
    uint8 ruleType,
    bytes32 campaignId
);
```

---

## 9. 前置校验设计
### 9.1 提现校验
提现校验独立设计，避免与业务消费混用。

```solidity
function validateWithdraw(
    address user,
    uint256 amount,
    uint256 usdbBalance
) external view returns (bool ok, string memory reason);
```

规则：

- 若 `amount <= usdbBalance - lockedVoucherAmount`，允许提现
- 否则拒绝

错误原因示例：

- `INSUFFICIENT_WITHDRAWABLE_BALANCE`

### 9.2 功能消费校验
```solidity
function validateSpend(
    address user,
    uint8 feature,
    bytes32 targetId,
    uint256 amount
) external view returns (bool ok, string memory reason);
```

校验内容：

- 用户是否存在可覆盖本次消费的合法 Voucher 或普通余额
- 若存在 Voucher 余额：
  - 是否允许当前功能
  - 若启用 target 限制，是否允许当前目标
- 是否会因为本次消费破坏“受限余额不可提现”的约束

### 9.3 校验口径
建议消费校验遵循：

- 普通余额始终可用于所有场景
- Voucher 余额只能用于授权场景
- 业务入口消费时，默认优先消耗“可用于该场景的 Voucher 余额”
- 若 Voucher 不足，再消耗普通余额

这样做的好处是：

- 用户体验更贴近“先把券用掉”
- 后端和前端展示逻辑一致
- 受限额度的生命周期更清晰

---

## 10. 消费记账与扣减顺序
### 10.1 核心问题
前置校验之外，还要定义“本次消费实际消耗了哪几张券、消耗多少”。

### 10.2 推荐策略
采用 FIFO 规则：

1. 先按 `startTime / voucherId` 顺序遍历有效 Voucher
2. 仅消耗允许当前功能和目标的 Voucher
3. 从最早的一张开始扣减
4. 不足部分落到普通余额

### 10.3 推荐接口
```solidity
function consumeVoucherBalance(
    address user,
    uint8 feature,
    bytes32 targetId,
    uint256 amount
) external onlyAuthorizedConsumer returns (uint256 voucherPortion, uint256 cashPortion);
```

返回值：

- `voucherPortion`
  - 本次实际使用的 Voucher 金额
- `cashPortion`
  - 本次实际使用的普通余额金额

此函数应在业务交易成功后调用，避免失败交易污染账本。

---

## 11. 后置校验与解锁
### 11.1 业务目标
若用户完成活动要求，则解除 Voucher 锁定。

### 11.2 推荐接口
```solidity
function recordQualifiedVolume(
    address user,
    uint8 feature,
    bytes32 targetId,
    uint256 volume
) external onlyAuthorizedConsumer;
```

逻辑：

1. 查找该用户名下仍为 `Active` 的 Voucher
2. 过滤掉功能不匹配、target 不匹配、已过期或已解锁的 Voucher
3. 增加 `currentVolume`
4. 若 `currentVolume >= targetVolume`
   - 释放对应 `lockedAmount`
   - 更新 `userLockedVoucherAmount[user]`
   - 将状态改为 `Unlocked`
   - 触发解锁事件

### 11.3 解锁事件
```solidity
event VoucherUnlocked(
    uint256 indexed voucherId,
    address indexed user,
    uint256 unlockedAmount
);
```

---

## 12. 与现有合约的接入点
### 12.1 `TradeManager`
参考 [`TradeManager.sol`](/d:/buzzing/projects/v3-periphery/contracts/TradeManager.sol)。

建议接入点：

- `userWithdraw(...)`
  - 提现前调用 `validateWithdraw`

- Buy / Sell 相关 `USDB` 消费入口
  - 交易前调用 `validateSpend`
  - 交易成功后调用 `consumeVoucherBalance`
  - 若本次交易属于活动目标，再调用 `recordQualifiedVolume`

### 12.2 `PreTrading`
参考 [`PreTrading.sol`](/d:/buzzing/projects/v3-periphery/contracts/PreTrading.sol)。

建议接入点：

- 用户下注 / deposit 前
  - 调用 `validateSpend`

- 成功后
  - 调用 `consumeVoucherBalance`
  - 若属于活动目标，再调用 `recordQualifiedVolume`

### 12.3 Liquidity Vault
若 Liquidity Vault 场景允许使用 Voucher：

- 存入前
  - 调用 `validateSpend`

- 存入成功后
  - 调用 `consumeVoucherBalance`
  - 如活动规则要求累计 Vault 使用量，调用 `recordQualifiedVolume`

### 12.4 Orderbook
Orderbook 上线时必须接同一套校验，否则会出现入口绕过。

建议接入点：

- 下单冻结 / 扣款前
  - `validateSpend`

- 订单成交并最终结算后
  - `consumeVoucherBalance`
  - 对符合条件的成交额调用 `recordQualifiedVolume`

---

## 13. `USDB` 是否需要改动
### 13.1 结论
本方案优先走“少改 `USDB`，主改业务入口和新增 VoucherController”的路线。

### 13.2 原因
- 当前 `USDB` 不是代理部署，直接升级成本高
- Voucher 规则本质是“额度与权限账本”，不是 ERC20 原生语义
- Trading / Pre-trading / Liquidity Vault / Orderbook 更适合统一接入外部规则中心

### 13.3 风险点
当前 [`USDB.sol`](/d:/buzzing/projects/v3-periphery/contracts/USDB.sol) 仍存在公开 `withdraw(...)`。

如果生产环境允许用户绕过 `TradeManager.userWithdraw(...)` 直接调用 `USDB.withdraw(...)`，则会绕过 Voucher 提现限制。

因此需要二选一：

- 方案 A：确认线上提现统一经过受控入口，`USDB.withdraw(...)` 不对用户暴露
- 方案 B：后续单独处理 `USDB.withdraw(...)` 的旁路问题

本设计文档默认采用方案 A 作为首发前提。

---

## 14. 推荐事件清单
```solidity
event VoucherIssued(
    uint256 indexed voucherId,
    address indexed user,
    uint256 amount,
    uint32 featureMask,
    uint8 ruleType,
    bytes32 campaignId
);

event VoucherConsumed(
    uint256 indexed voucherId,
    address indexed user,
    uint8 feature,
    bytes32 targetId,
    uint256 amount
);

event VoucherUnlocked(
    uint256 indexed voucherId,
    address indexed user,
    uint256 unlockedAmount
);

event VoucherExpired(
    uint256 indexed voucherId,
    address indexed user,
    uint256 remainingLockedAmount
);

event VoucherRevoked(
    uint256 indexed voucherId,
    address indexed user,
    uint256 remainingAmount
);
```

---

## 15. 权限设计
建议角色划分：

- `owner`
  - 配置 issuer、authorized consumer、紧急参数

- `issuer`
  - 后端发券角色
  - 调用 `issueVoucher`

- `authorizedConsumer`
  - `TradeManager`
  - `PreTrading`
  - Liquidity Vault 入口
  - Orderbook 入口
  - 允许调用 `consumeVoucherBalance` 和 `recordQualifiedVolume`

- `pauser`（可选）
  - 紧急暂停发券或消费记账

推荐接口：

```solidity
function setIssuer(address account, bool allowed) external onlyOwner;
function setAuthorizedConsumer(address account, bool allowed) external onlyOwner;
function pause() external;
function unpause() external;
```

---

## 16. 过期、撤销与异常处理
### 16.1 过期
若到达 `endTime`：

- `Active` 状态的 Voucher 变为 `Expired`
- 不再允许消费
- 若仍有 `lockedAmount`，按业务规则决定是否保留为不可提现余额、或由后续回收流程处理

考虑到当前需求中“资金回退与回收 MVP 暂无”，建议首版：

- 过期仅冻结为不可再消费
- 不在本期处理资金回退

### 16.2 撤销
若运营需要人工撤销：

- 状态改为 `Revoked`
- 停止后续使用与累计
- 是否回收余额由后续版本定义

### 16.3 失败回滚
业务消费应遵循：

- 先执行业务主流程
- 成功后再记 Voucher 消耗与累计
- 若记账失败则整笔交易回滚

这样可以保证业务资金与 Voucher 账本一致。

---

## 17. 索引与遍历问题
用户名下若存在大量 Voucher，链上遍历可能带来 gas 风险。

建议首版控制：

- 后端限制单用户活跃 Voucher 数量
- 发新券前优先避免碎片化
- 消费时仅遍历 `Active` 券

后续如需优化，可采用：

- 用户活跃券队列
- 按功能拆分的活跃索引
- 场景侧缓存用户可用额度

若当前业务量有限，首版可接受简单遍历实现。

---

## 18. 前后端职责划分
### 18.1 后端职责
- 创建发券任务
- 决定活动参数和 `campaignId`
- 执行发券交易
- 监听 `VoucherIssued / VoucherConsumed / VoucherUnlocked`
- 维护 off-chain 状态镜像
- 为前端提供可展示的用户 Voucher 明细

### 18.2 合约职责
- 提供最终准入校验
- 提供最终记账结果
- 保证各业务入口规则一致

### 18.3 前端职责
前端不做最终裁决，只做展示与预检查。

前端可展示：

- 用户总 USDB 余额
- 可提现余额
- 受限余额
- 各功能可用 Voucher 额度
- 各活动完成进度

---

## 19. 推荐上线顺序
### 19.1 Phase 1
- 新增 `VoucherController`
- 接入 `TradeManager.userWithdraw`
- 接入 Trading / Pre-trading 的消费与累计
- 前端展示总余额 / 可提现余额 / 活动进度

### 19.2 Phase 2
- 接入 Liquidity Vault
- 接入 Orderbook
- 增加 target 维度限制

### 19.3 Phase 3
- 处理 `USDB.withdraw(...)` 旁路
- 增加过期回收 / 撤销回收
- 增加更复杂的活动模板

---

## 20. 测试建议
### 20.1 发券
- 发券成功后，用户 `USDB` 余额增加
- 用户 `lockedVoucherAmount` 同步增加
- 事件参数正确

### 20.2 提现
- 普通余额可正常提现
- 超出可提现余额时应拒绝
- 受限余额不能提现

### 20.3 功能限制
- Trading 券不能用于 Liquidity Vault
- Liquidity Vault 券不能用于 Pre-trading
- 多功能券可用于多个授权场景

### 20.4 解锁
- 累计量未达标时仍为锁定
- 达标后自动解锁
- 解锁后可提现余额增加

### 20.5 多券混用
- 多张券按 FIFO 正确扣减
- 券余额不足时自动落到普通余额
- 不授权的券不得被误消耗

### 20.6 边界
- 过期券不可继续消费
- 零金额、零地址、空白名单等输入需拒绝
- 同一交易失败时不得污染账本

---

## 21. 尚待确认的问题
以下事项建议在开发前最终确认：

- 线上提现是否保证统一走受控入口，而不会直接调用 `USDB.withdraw(...)`
- Voucher 使用时是否默认“优先消耗券，再消耗普通余额”
- 解锁后资金是否仍保留在用户钱包内，仅改变状态，不做额外转账
- Stage 2 中 market / vault 的 `targetId` 标准格式
- Orderbook 的“成交量”口径是否按下单额、成交额、净成交额或扣费前金额计算

---

## 22. 最终建议
若目标是“尽快与 Orderbook 一起上线，同时保证协议侧约束成立”，推荐落地路径为：

1. 不大改 `USDB`
2. 新增 `VoucherController`
3. 将 `TradeManager / PreTrading / Orderbook / Liquidity Vault` 全部接入统一校验和记账
4. 先完成 Stage 1，再扩展到 Stage 2

这是当前改动成本、业务表达能力和上线节奏之间最平衡的方案。
