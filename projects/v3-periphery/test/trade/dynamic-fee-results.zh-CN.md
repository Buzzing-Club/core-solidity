# Dynamic Fee 明细结果说明（链上实测）

## 说明

本次三组测试都改为：

- 每笔交易体量统一为 `1000U`（`USDB` 6 位精度）。
- 每一笔都基于实际合约调用数据记录：
  - `updateVolatility(...)` 真实交易回执（`txHash/block/timestamp`）
  - `poolVolatility(pool)` 真实链上状态（`referenceTick/referenceVolatility/accumulator`）
  - `computeFee(...)` 真实链上动态费（`dynamicFee`）
- 并落盘为详细报告文件（`CSV + Markdown + JSON`）。

## 场景定义

- 低频：`dtSeconds = 700`（`> decayPeriod`）
- 中频：`dtSeconds = 30`（`filterPeriod < dt < decayPeriod`）
- 高频：`dtSeconds = 1`（连续高频）

## 运行命令

```bash
yarn workspace @pancakeswap/v3-periphery hardhat test ./test/trade/dynamic-fee.low-frequency.100.spec.js --network hardhat
yarn workspace @pancakeswap/v3-periphery hardhat test ./test/trade/dynamic-fee.mid-frequency.100.spec.js --network hardhat
yarn workspace @pancakeswap/v3-periphery hardhat test ./test/trade/dynamic-fee.high-frequency.100.spec.js --network hardhat
```

## 详细结果文件

执行后会在目录 `test/trade/reports/` 生成：

- `dynamic-fee-low-frequency-100trades-1000U.csv`
- `dynamic-fee-low-frequency-100trades-1000U.md`
- `dynamic-fee-low-frequency-100trades-1000U.json`
- `dynamic-fee-mid-frequency-100trades-1000U.csv`
- `dynamic-fee-mid-frequency-100trades-1000U.md`
- `dynamic-fee-mid-frequency-100trades-1000U.json`
- `dynamic-fee-high-frequency-100trades-1000U.csv`
- `dynamic-fee-high-frequency-100trades-1000U.md`
- `dynamic-fee-high-frequency-100trades-1000U.json`

## 字段说明（每笔）

- `idx`: 第几笔交易（1~100）
- `txHash`: 该笔链上交易哈希
- `blockNumber`: 区块号
- `timestamp`: 区块时间戳
- `dtSeconds`: 本场景设定的交易间隔
- `tradeSizeU`: 交易体量（本次统一 `1000`）
- `currentTick`: 该笔输入 tick
- `ticksCrossed`: 该笔输入 ticksCrossed
- `referenceTick/referenceVolatility/accumulator`: 来自 `poolVolatility(pool)` 的链上状态
- `baseFeeUSDB`: 按链上 `baseFeeUnit` 计算的基础费
- `variableFeeUSDB`: `dynamicFee - baseFee`
- `dynamicFeeUSDB`: `computeFee(...)` 返回的动态费
- `dynamicFeeBps`: 动态费 bps（`dynamicFee / tradeSize * 10000`）
- `totalFeeUSDB`: `staticFee + dynamicFee`（本测试 `staticFeeBps = 100`）
- `totalFeeBps`: 总费 bps


## 随机 1000 笔（2s，5~100U）交易补充统计

数据来源：`test/trade/reports/random-yes-trades-1000-2s-5to100U.json`

- 总交易数：`1000`
- `SELL` 数：`553`
- `BUY` 数：`446`
- `BUY_FALLBACK` 数：`1`
- 全部交易平均 `tradeSizeU`：`51.835 U`
- `SELL` 平均 `tradeSizeU`：`51.352622 U`
- `BUY` 平均 `tradeSizeU`：`52.385650 U`
- `SELL` 平均 `grossOutUSDB`：`42.258589 U`

说明：
- `BUY_FALLBACK` 代表该笔原计划卖出但因持仓不足，回退为买入。
- 上述平均值均按报告中的每笔真实记录计算，不是估算值。

## 动态 Fee 基础参数设置

为避免“同名报告但参数不一致”造成理解偏差，下面列出本目录当前两类测试实际采用的动态费参数。

### A. 分组频率测试（low / mid / high）

对应脚本：
- `test/trade/dynamic-fee.low-frequency.100.spec.js`
- `test/trade/dynamic-fee.mid-frequency.100.spec.js`
- `test/trade/dynamic-fee.high-frequency.100.spec.js`

参数：
- `filterPeriod = 2`
- `decayPeriod = 600`
- `reductionFactor = 850000000000000000`（0.85e18）
- `maxAccumulator = 1000000000`
- `variableFeeControl = 1000000000000000000000`（1e21）
- `baseFeeUnit = 12000000000000`

### B. 随机 1000 笔 YES 买卖测试（2s, 5~100U）

对应脚本：
- `test/trade/random-yes-trades-1000.spec.js`

参数：
- `filterPeriod = 2`
- `decayPeriod = 600`
- `reductionFactor = 850000000000000000`（0.85e18）
- `maxAccumulator = 1000000000`
- `variableFeeControl = 10000000000000000`（1e16）
- `baseFeeUnit = 2000000000000`

补充说明：
- 两类测试的差异主要在 `variableFeeControl` 与 `baseFeeUnit`，随机 1000 笔场景为保证可持续成交，使用了更温和的费率强度。

## 参数说明（建议统一口径）

- `filterPeriod`：
  - 含义：小于等于该时间间隔的连续交易，会被视为同一“高频簇”处理（不做正常衰减）。
  - 影响：越小越不容易把连续交易判定为高频；越大越容易触发高频累积。

- `decayPeriod`：
  - 含义：当两笔交易间隔大于 `filterPeriod` 后，波动累积在该周期内逐步衰减。
  - 影响：越大衰减越慢（高费持续更久）；越小衰减越快（费率更快回落）。

- `reductionFactor`（1e18 定点）：
  - 含义：每次衰减时对历史波动/累积的保留比例。
  - 影响：越接近 1e18，历史冲击保留越多；越小，历史冲击消散越快。

- `maxAccumulator`：
  - 含义：波动累积器上限，防止极端市场下动态费无限放大。
  - 影响：越大可达到的动态费峰值越高；越小可控性更强但上限更早触顶。

- `variableFeeControl`：
  - 含义：动态费灵敏度/强度控制项（与波动累积共同决定 variable fee）。
  - 影响：越大，单位波动对应的动态费越高；越小，动态费更温和。

- `baseFeeUnit`：
  - 含义：按 `ticksCrossed` 与交易规模计算的基础动态费单元（不是静态手续费）。
  - 影响：越大，所有交易的动态费“地板”越高；越小，低波动时更接近 0。

- `staticFeeBps`（若该测试场景启用）：
  - 含义：与动态费并行叠加的固定手续费（bps）。
  - 影响：直接抬高 `totalFee`，与动态费独立叠加。
