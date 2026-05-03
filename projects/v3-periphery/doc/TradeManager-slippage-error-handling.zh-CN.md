# TradeManager 交易滑点错误提示与前端处理规范（buyYes / buyNo / sellYes / sellNo）

本文基于当前合约实现：`contracts/TradeManager.sol`。

## 1. 合约里与滑点直接相关的报错码

- `yne`：`buyYes` 中 `require(amountOut >= minAmount, "yne")`
- `tmu`：`buyNo` 中 `require(totalUserDebit < maxAmount, "tmu")`
- `une`：`sellYes` / `sellNo` 中 `require(... >= minAmount, "une")`

对应位置：

- `buyYes`: [TradeManager.sol:611](/d:/buzzing/projects/v3-periphery/contracts/TradeManager.sol:611)
- `sellYes`: [TradeManager.sol:633](/d:/buzzing/projects/v3-periphery/contracts/TradeManager.sol:633)
- `buyNo`: [TradeManager.sol:717](/d:/buzzing/projects/v3-periphery/contracts/TradeManager.sol:717)
- `sellNo`: [TradeManager.sol:780](/d:/buzzing/projects/v3-periphery/contracts/TradeManager.sol:780)

## 2. 四个交易方向的滑点口径

说明：`s = slippageBps / 10000`，例如 1% 则 `slippageBps = 100`。

### 2.1 buyYes（USDB -> YES）

合约保护条件：`amountOut >= minAmount`。

前端应使用：

- `quoteYesOut = quote(USDB_net -> YES)`
- `minAmount = floor(quoteYesOut * (1 - s))`

注意：`buyYes` 会先扣输入手续费再 swap，询价必须用净输入金额。

### 2.2 buyNo（预算上限保护）

合约保护条件：`totalUserDebit < maxAmount`（严格小于）。

前端应使用：

- `quoteDebit = 预估总扣款(含 fee)`
- `userMaxDebit = ceil(quoteDebit * (1 + s))`
- `maxAmount = userMaxDebit + 1`

注意：这里必须 `+1`，因为合约是 `<` 不是 `<=`。

### 2.3 sellYes（YES -> USDB）

合约保护条件：`amountOut >= minAmount`（这里的 `amountOut` 是 swap 的毛收入口径）。

前端应使用：

- `quoteGrossOut = quote(YES -> USDB)`
- `minAmount = floor(quoteGrossOut * (1 - s))`

备注：用户到账是扣费后的净额；但 `une` 判断用的是毛额。

### 2.4 sellNo（NO -> USDB）

合约保护条件：`(params.amountOut - amountIn) >= minAmount`（毛收入口径）。

前端应使用：

- `quoteAmountIn = quoteExactOutputSingle(...)`
- `quoteGrossOut = params.amountOut - quoteAmountIn`
- `minAmount = floor(quoteGrossOut * (1 - s))`

## 3. 前端错误提示映射

推荐文案（中文）：

- `buyYes + yne`
  - 标题：`价格变化较快，买入失败`
  - 内容：`实际可买到的 YES 低于最小可接受数量。请刷新报价后重试，或适当调大滑点。`

- `buyNo + tmu`
  - 标题：`价格变化较快，买入失败`
  - 内容：`实际需支付 USDB 超过你的最高可接受金额。请刷新报价后重试，或提高滑点/降低买入数量。`

- `sellYes + une`
  - 标题：`价格变化较快，卖出失败`
  - 内容：`实际可获得的 USDB 低于最小可接受数量。请刷新报价后重试，或适当调大滑点。`

- `sellNo + une`
  - 标题：`价格变化较快，卖出失败`
  - 内容：`实际可获得的 USDB 低于最小可接受数量。请刷新报价后重试，或适当调大滑点。`

动作按钮建议：

- `刷新报价`
- `提高滑点`
- `减少数量`（buyNo 优先展示）

## 4. 前端统一判定逻辑（可直接实现）

```ts
export type TradeAction = 'buyYes' | 'buyNo' | 'sellYes' | 'sellNo';

export function parseRevertReason(e: unknown): string | null {
  const msg = String((e as any)?.reason || (e as any)?.message || '');
  const m = msg.match(/reason:\s*([A-Za-z0-9<>_\-]+)/i);
  if (m?.[1]) return m[1];
  if (msg.includes('"yne"') || msg.includes(' yne')) return 'yne';
  if (msg.includes('"tmu"') || msg.includes(' tmu')) return 'tmu';
  if (msg.includes('"une"') || msg.includes(' une')) return 'une';
  return null;
}

export function mapTradeError(action: TradeAction, reason: string | null) {
  if (action === 'buyYes' && reason === 'yne') {
    return {
      category: 'slippage',
      code: 'BUY_YES_MIN_OUT',
      title: '价格变化较快，买入失败',
      message: '实际可买到的 YES 低于最小可接受数量。请刷新报价后重试，或适当调大滑点。',
      ctas: ['refresh_quote', 'increase_slippage'],
    };
  }

  if (action === 'buyNo' && reason === 'tmu') {
    return {
      category: 'slippage',
      code: 'BUY_NO_MAX_IN',
      title: '价格变化较快，买入失败',
      message: '实际需支付 USDB 超过你的最高可接受金额。请刷新报价后重试，或提高滑点/降低买入数量。',
      ctas: ['refresh_quote', 'reduce_size', 'increase_slippage'],
    };
  }

  if ((action === 'sellYes' || action === 'sellNo') && reason === 'une') {
    return {
      category: 'slippage',
      code: 'SELL_MIN_OUT',
      title: '价格变化较快，卖出失败',
      message: '实际可获得的 USDB 低于最小可接受数量。请刷新报价后重试，或适当调大滑点。',
      ctas: ['refresh_quote', 'increase_slippage'],
    };
  }

  return {
    category: 'generic',
    code: 'TX_FAILED',
    title: '交易失败',
    message: '链上执行未通过，请重试。若多次失败，请稍后再试。',
    ctas: ['retry'],
  };
}
```

## 5. 建议同时处理的非滑点报错（避免误判）

- `t<0` / `t>0`：价格越过 1 边界限制，不是普通滑点。
- `TTO` / `Transaction too old`：deadline 过期。
- `PM` / `usdbError` / `sameToken` / `ISP`：参数或市场配置问题。
- `execution reverted` 且无 reason：按 generic 处理，并上报完整错误原文。

## 6. 发送前防失败建议

- quote 后记录 `quoteBlock`，发送前若 `latestBlock - quoteBlock >= 1`，建议自动重报价。
- `buyNo` 的 `maxAmount` 一定走严格 `<` 口径（`+1`）。
- telemetry 建议埋点字段：
  - `action`
  - `reason`
  - `quoteBlock`
  - `sendBlock`
  - `quoteOut/debit`
  - `minAmount/maxAmount`
  - `slippageBps`

