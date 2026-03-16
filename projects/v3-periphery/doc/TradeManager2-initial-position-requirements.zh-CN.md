# TradeManager2 初始仓位记录需求文档

## 1. 背景
当前 `TradeManager2` 在 `addLiquidity(...)` 时仅记录 `tokenOwnership[tokenId] = mintParams.recipient`。  
业务上需要增加一层“初始仓位”记录能力：当流动性归属者不是 `auth` 地址时，记录该仓位的方向（YES/NO）与成本信息，便于后续风险分析与收益核算。

## 2. 目标
在不改变现有主流程行为的前提下，为 `TradeManager2` 增加“非 auth 归属者初始仓位记录”能力。

## 3. 范围
- 合约：`contracts/TradeManager2.sol`
- 触发入口：`addLiquidity(...)`
- 记录对象：`mint` 后产生的 `tokenId` 对应仓位

不在本次范围：
- 不改动 `TradeManager`（旧合约）
- 不改动撮合/交易逻辑（`buyYes/sellYes/buyNo/sellNo`）
- 不新增链下服务逻辑

## 4. 术语定义
- `auth 地址`：`wards[address] == 1` 的地址。
- `流动性归属者`：`mintParams.recipient`（也是当前 `tokenOwnership[tokenId]` 被写入的地址）。
- `初始仓位`：在首次 `addLiquidity` 建立仓位时记录的基础信息。
- `仓位方向`：YES 或 NO（见“待确认项”中方向判定细则）。
- `仓位成本`：初始建仓时计入该仓位的成本值（见“待确认项”中成本口径）。

## 5. 功能需求

### 5.1 触发条件
在 `addLiquidity(...)` 成功 mint 出 `tokenId` 后：
- 若 `wards[mintParams.recipient] != 1`，则记录初始仓位；
- 若 `wards[mintParams.recipient] == 1`，不记录（保持现有行为）。

### 5.2 记录内容
每个 `tokenId` 至少需记录：
- `owner`：仓位归属者地址
- `isYes`：方向（YES=true / NO=false），由新增入参显式传入
- `cost`：仓位成本（使用现有 `UserYesPosition` / `UserNoPosition` 结构记录，不新增独立成本结构）
- `createdAt`：记录时间（`block.timestamp`）
- `exists`：是否已存在记录（避免重复写入）

### 5.3 写入规则
- 仅在 `tokenId` 首次建立时写入一次；
- 同一个 `tokenId` 不允许重复覆盖初始记录（除非未来另行定义“重置”能力）；
- 失败不应影响原有 mint/ownership 主流程（见“技术实现建议”）。

### 5.4 查询能力
提供可读接口（`view`）：
- 按 `tokenId` 查询初始仓位完整信息；
- 可选：按 `owner` + `tokenId` 的便捷校验接口。

### 5.5 事件要求
新增事件用于链上可观测性：
- `InitialPositionRecorded(tokenId, owner, isYes, cost, timestamp)`

## 6. 约束与兼容性要求
- 允许对 `addLiquidity` 增加一个方向入参（`isYes`）；
- 其余 public/external 核心接口签名保持不变（除新增查询接口与事件）；
- 不影响现有 `addLiquidity`、`decreaseLiquidityForNoLp`、交易路径的业务语义；
- 不引入新的权限绕过路径；
- gas 增量可控（仅在非 auth 归属者场景触发记录）。

## 7. 已确认口径
已确认并锁定如下实现口径：

1. **方向判定**
- 采用“新增入参”方式，由调用方显式传入 `isYes`。

2. **成本记录**
- 直接复用现有仓位结构：
  - YES 方向写入 `UserYesPosition`
  - NO 方向写入 `UserNoPosition`
- 不新增独立的“成本结构体/映射”。

## 8. 异常与边界场景
- `recipient == address(0)`：沿用现有逻辑或显式拒绝（需确认）。
- `tokenId` 重复写入：应拒绝或忽略，避免污染初始记录。
- `cost == 0`：是否允许记录（建议允许，但事件中保留）。
- `addLiquidity` 回滚：不应残留初始记录。

## 9. 验收标准
满足以下条件即验收通过：
1. 非 auth `recipient` 调用后，能查询到对应 `tokenId` 的初始仓位。
2. auth `recipient` 调用后，不产生初始仓位记录。
3. 记录事件参数正确，且与存储一致。
4. 不影响现有 `trade` 测试主流程。
5. 新增测试覆盖：
   - 记录成功路径
   - auth 跳过路径
   - 重复写入保护路径

## 10. 建议测试清单（后续实现阶段）
- `addLiquidity` + 非 auth recipient：断言 `InitialPositionRecorded` 与 storage。
- `addLiquidity` + auth recipient：断言无记录。
- 重复记录尝试：断言 revert 或 no-op（按最终规则）。
- 与 `decreaseLiquidityForNoLp` 联动：确认现有行为不回归。

## 11. 实施顺序建议
1. 修改 `addLiquidity` 入参，增加 `isYes`；
2. 在非 auth `recipient` 场景按 `isYes` 写入现有 `UserYesPosition`/`UserNoPosition`；
3. 补测试；
4. 回归现有 `TradeManager2` 相关测试集。
