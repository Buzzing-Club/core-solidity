# PreTrading 仓位计算后端接入文档（含 withdraw / cancelWithdraw）

## 1. 背景与目标
你们当前后端只按 `Deposit` 记仓位，会导致以下偏差：
- 用户发起 `withdraw` 后，链上有效仓位已经减少，但后端还显示原仓位。
- 用户 `cancelWithdraw` 后，链上仓位回补，但后端没有回补。
- 用户 `claimWithdraw` 后，pending 会清零并产生手续费，后端若不处理会长期错账。

本文基于你给的这版 `PreTrading` 合约，给出一套事件驱动的仓位计算规则。

## 2. 合约仓位语义（单用户、单 conditionId）
以 `positions[conditionId][user]` 为准，核心字段：
- `yesUSDAmount` / `noUSDAmount`：当前有效下注仓位（参与后续 `claim` 计算）。
- `yesPendingWithdraw` / `noPendingWithdraw`：用户已申请提取、待 `claimWithdraw` 的金额。
- `yesWithdrawAvailableAt` / `noWithdrawAvailableAt`：对应 side 的最早可提取时间。
- `claimed`：该用户是否已执行过 `claim(conditionId)`。

注意：
- `withdraw` 会把金额从 `yesUSDAmount/noUSDAmount` 移到 `pending`，并同步减少市场 `totalUSD`。
- `cancelWithdraw` 会把该 side 的全部 pending 退回 active 仓位。
- `claimWithdraw` 会清空该 side pending，并收取提现费（当前 5%）。

## 3. 必须监听的事件
按 `conditionId + user` 聚合时，至少处理这些事件：
- `Deposit(conditionId, user, isYes, amount, totalUSD)`
- `WithdrawRequested(conditionId, user, isYes, amount, availableAt)`
- `WithdrawCancelled(conditionId, user, isYes, amount)`
- `WithdrawClaimed(conditionId, user, isYes, amount, fee)`
- `Claimed(conditionId, user, payout)`
- `MarketResolved(conditionId, result)`（用于市场状态与展示）
- `MarketUnset(conditionId, status)`（用于市场状态与展示）

## 4. 事件驱动更新规则
定义后端状态（建议）：
- `active_yes`
- `active_no`
- `pending_yes`
- `pending_no`
- `yes_withdraw_available_at`
- `no_withdraw_available_at`
- `claimed`
- `claimed_payout_total`
- `claimed_withdraw_receive_total`
- `withdraw_fee_total`

### 4.1 Deposit
当 `Deposit(..., isYes, amount, ...)`：
- `isYes=true`：`active_yes += amount`
- `isYes=false`：`active_no += amount`

### 4.2 WithdrawRequested
当 `WithdrawRequested(..., isYes, amount, availableAt)`：
- `isYes=true`：
  - `active_yes -= amount`
  - `pending_yes += amount`
  - `yes_withdraw_available_at = max(yes_withdraw_available_at, availableAt)`
- `isYes=false`：
  - `active_no -= amount`
  - `pending_no += amount`
  - `no_withdraw_available_at = max(no_withdraw_available_at, availableAt)`

### 4.3 WithdrawCancelled
当 `WithdrawCancelled(..., isYes, amount)`：
- 合约语义是“取消该 side 的全部 pending”。
- `isYes=true`：
  - `active_yes += amount`
  - `pending_yes = 0`
  - `yes_withdraw_available_at = 0`
- `isYes=false`：
  - `active_no += amount`
  - `pending_no = 0`
  - `no_withdraw_available_at = 0`

### 4.4 WithdrawClaimed
当 `WithdrawClaimed(..., isYes, amount, fee)`：
- 事件里 `amount` 是实收金额（`receiveAmount`），不是原申请金额。
- 可推导原申请总额：`gross = amount + fee`。
- `isYes=true`：
  - `pending_yes = 0`
  - `yes_withdraw_available_at = 0`
- `isYes=false`：
  - `pending_no = 0`
  - `no_withdraw_available_at = 0`
- 累计统计：
  - `claimed_withdraw_receive_total += amount`
  - `withdraw_fee_total += fee`

### 4.5 Claimed
当 `Claimed(..., payout)`：
- `claimed = true`
- `claimed_payout_total += payout`
- 这版合约在执行 `claim` 时会将获胜 side 的 active 仓位清零。
- 建议后端在事件后做一次链上对账（见第 7 节），避免仅靠推导遗漏极端路径。

## 5. 推荐展示口径
为了前端稳定，建议暴露三个口径：
- `betPosition`
  - `yes = active_yes`
  - `no = active_no`
- `pendingWithdraw`
  - `yes = pending_yes`
  - `no = pending_no`
- `claimableWithdrawNow`
  - `yes = (pending_yes > 0 && now >= yes_withdraw_available_at) ? pending_yes : 0`
  - `no = (pending_no > 0 && now >= no_withdraw_available_at) ? pending_no : 0`

## 6. 处理顺序与幂等要求
必须按链上顺序消费日志：
- 主排序键：`block_number ASC, transaction_index ASC, log_index ASC`
- 幂等键：`chain_id + tx_hash + log_index`

这样可避免同区块多笔操作造成错序错账。

## 7. 强烈建议：事件增量 + 链上对账双轨
仅靠事件增量会受漏数/重放影响，建议增加对账任务：
- 实时：按事件更新本地状态。
- 定时（例如每 5 分钟）：抽样或全量调用链上 `positions(conditionId, user)` 对账。
- 发现不一致时：以链上状态回写。

最小对账 ABI：
```solidity
function positions(bytes32, address) external view returns (
    uint256 yesUSDAmount,
    uint256 noUSDAmount,
    uint256 yesPendingWithdraw,
    uint256 noPendingWithdraw,
    uint256 yesWithdrawAvailableAt,
    uint256 noWithdrawAvailableAt,
    bool claimed
);
```

## 8. 伪代码（后端可直接改造）
```ts
type Pos = {
  activeYes: bigint
  activeNo: bigint
  pendingYes: bigint
  pendingNo: bigint
  yesAvailableAt: number
  noAvailableAt: number
  claimed: boolean
  claimedPayoutTotal: bigint
  claimedWithdrawReceiveTotal: bigint
  withdrawFeeTotal: bigint
}

function applyLog(pos: Pos, log: DecodedLog): Pos {
  switch (log.name) {
    case "Deposit": {
      if (log.args.isYes) pos.activeYes += log.args.amount
      else pos.activeNo += log.args.amount
      return pos
    }
    case "WithdrawRequested": {
      if (log.args.isYes) {
        pos.activeYes -= log.args.amount
        pos.pendingYes += log.args.amount
        pos.yesAvailableAt = Math.max(pos.yesAvailableAt, Number(log.args.availableAt))
      } else {
        pos.activeNo -= log.args.amount
        pos.pendingNo += log.args.amount
        pos.noAvailableAt = Math.max(pos.noAvailableAt, Number(log.args.availableAt))
      }
      return pos
    }
    case "WithdrawCancelled": {
      if (log.args.isYes) {
        pos.activeYes += log.args.amount
        pos.pendingYes = 0n
        pos.yesAvailableAt = 0
      } else {
        pos.activeNo += log.args.amount
        pos.pendingNo = 0n
        pos.noAvailableAt = 0
      }
      return pos
    }
    case "WithdrawClaimed": {
      if (log.args.isYes) {
        pos.pendingYes = 0n
        pos.yesAvailableAt = 0
      } else {
        pos.pendingNo = 0n
        pos.noAvailableAt = 0
      }
      pos.claimedWithdrawReceiveTotal += log.args.amount
      pos.withdrawFeeTotal += log.args.fee
      return pos
    }
    case "Claimed": {
      pos.claimed = true
      pos.claimedPayoutTotal += log.args.payout
      return pos
    }
    default:
      return pos
  }
}
```

## 9. 常见坑位（这次必须规避）
- 不要把 `WithdrawClaimed.amount` 当成“原 withdraw 申请额”，它是扣费后的实收额。
- 不要把 `cancelWithdraw` 当“部分取消”，该函数是按 side 一次性取消全部 pending。
- 多次 `withdraw` 会累计 pending，且 `availableAt` 取最大值。
- 市场状态变更（`RESOLVED/UNSET`）不直接改用户仓位字段，但会影响后续可执行路径与前端动作。

## 10. 上线检查清单
- 后端已接入 `WithdrawRequested / WithdrawCancelled / WithdrawClaimed` 三类事件。
- 仓位接口同时返回 active 与 pending 两套数据。
- 事件消费已按 `block/tx/log` 严格排序。
- 事件落库有幂等键，重复回放不重复记账。
- 已有定时链上对账与修复任务。


