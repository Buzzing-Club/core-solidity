# 以指定 Tick 为界拆分流动性测试文档

## 1. 结论

可以按 `tick=6950` 作为分界，分别添加两段流动性：

- 区间 A：`[0, 6950]`
- 区间 B：`[6950, 9950]`

但必须满足：`tickLower` / `tickUpper` 都是当前池子 `tickSpacing` 的整数倍。

## 2. 前置条件

1. 读取池子的 `tickSpacing` 与当前 `tick`。  
2. 校验边界合法：
   - `tickLower < tickUpper`
   - `0`、`6950`、`9950` 均可被 `tickSpacing` 整除
3. 边界需在协议允许的 tick 范围内（通常在 `TickMath.MIN_TICK ~ MAX_TICK`）。

示例：

- 若 `fee=2500`（常见 `tickSpacing=50`），`0/6950/9950` 都合法。
- 若 `tickSpacing=200`，`6950` 不合法（不能作为边界）。

## 3. 关键行为说明（非常重要）

V3 头寸活跃条件是：

- `tickLower <= currentTick < tickUpper`

所以当 `currentTick = 6950` 时：

- 区间 A `[0,6950]`：不活跃（因为上边界是开区间）
- 区间 B `[6950,9950]`：活跃

这不是异常，是预期行为。

## 4. 测试场景

### 场景 1：在 `tick=6950` 时添加两段流动性

步骤：

1. 创建/初始化池子，确保当前 tick 约为 `6950`。  
2. 添加区间 A：`tickLower=0, tickUpper=6950`。  
3. 添加区间 B：`tickLower=6950, tickUpper=9950`。  
4. 查询两段 position 的 `liquidity` 与池子状态。  

预期：

- 两段都可成功 mint（只要边界合法）。
- 在 `tick=6950` 的瞬间，仅区间 B 对交易生效。

### 场景 2：价格下穿到 `<6950`

步骤：

1. 通过 swap 让 tick 从 `6950` 下移到 `6949`（或更低）。
2. 再次查询两段头寸对交易的影响。

预期：

- 区间 A 变为活跃。
- 区间 B 在 `tick < 6950` 时不活跃。

### 场景 3：价格上穿到 `>6950`

步骤：

1. 通过 swap 让 tick 从 `6950` 上移到 `6951`（或更高）。
2. 查询头寸状态与成交路径。

预期：

- 区间 B 持续活跃。
- 区间 A 保持不活跃。

## 5. 建议增加的断言

1. `tickLower/tickUpper` 与 `tickSpacing` 对齐断言。  
2. mint 后 NFT position 的 `tickLower/tickUpper/liquidity` 正确。  
3. 在 `tick=6950` 时：
   - A 区间不活跃
   - B 区间活跃
4. tick 跨边界前后，活跃区间切换符合 `lower <= tick < upper` 规则。

## 6. 常见误区

1. 误以为 `tick==upper` 时区间仍活跃（错误）。  
2. 未检查 `tickSpacing`，直接用任意 tick 作为边界。  
3. 只看 mint 成功，不验证边界 tick 上的实际生效区间。

