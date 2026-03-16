# r80 最终试验参数记录

## 结论标签
- 方案标识：`f2-v3000-r80-d14`
- 用途：当前最终选定参数，用于后续继续验证和联调

## 动态 Fee 参数（链上口径）
- `filterPeriod = 2`
- `decayPeriod = 14`
- `reductionFactor = 800000000000000000`（`0.8e18`）
- `maxAccumulator = 1000000000`
- `variableFeeControl = 3000000000000000`（`3e15`）
- `baseFeeUnit = 2000000000000`（`2e12`）

## 口径说明
- 本参数组对应你最终确认的 `r80` 版本。
- 本记录仅用于参数归档与复现实验，不包含新的参数搜索过程。

## 对应报告文件
- `dynamic-fee-r80-d14-detailed-report.zh-CN.pdf`
- `dynamic-fee-r80-vs-r85-f2v3000d14.html`
- `dynamic-fee-r80-vs-r85-f2v3000d14.zh-CN.md`
- `sweep-tsfocus-f2-v3000-r80-d14-*`
