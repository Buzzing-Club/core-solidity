# Claim 前端改造说明：先检测是否已 Unwrap，再决定是否调用 Unwrap

本文用于指导前端修改 Claim 流程，避免“用户已 unwrap 但前端仍重复走 unwrap，导致无法完成 claim”的问题。

## 1. 问题描述

当前前端 Claim 实现是固定流程：

1. 先 unwrap（ERC20 -> ERC1155）
2. 再到 CTF 合约 claim（redeem）

问题在于：

- 用户可能在之前一次操作里已经完成 unwrap，但没有继续 claim。
- 前端再次进入时不知道这一状态，仍然先 unwrap。
- 由于用户 ERC20 余额可能已经为 0，流程会被错误分支卡住，用户无法顺利完成 claim。

## 2. 改造目标

在用户点击 Claim 时，前端先确定本次要领取的方向（`claimSide`）后，再做定向检测：

- 如果 `claimSide` 对应的 wrapped ERC20 有余额：先 unwrap（只 unwrap 该侧）。
- 如果 `claimSide` 对应的 wrapped ERC20 为 0，且该侧 CTF positionId 余额与接口 claim 数一致且 >0：直接 claim（跳过 unwrap）。

这条规则应替代“固定先 unwrap”。

## 3. 链上判定依据（合约引用）

- Wrapped1155 查询地址：
  - [Wrapped1155Factory.sol:649](/d:/buzzing/projects/v3-periphery/contracts/Wrapped1155Factory.sol:649) `getWrapped1155(...)`
- Wrapped1155 解包：
  - [Wrapped1155Factory.sol:550](/d:/buzzing/projects/v3-periphery/contracts/Wrapped1155Factory.sol:550) `unwrap(...)`
- CTF 持仓余额：
  - [ctf.sol:1219](/d:/buzzing/projects/v3-periphery/contracts/ctf.sol:1219) `balanceOf(owner, positionId)`
- CTF 结算领取：
  - [ctf.sol:1690](/d:/buzzing/projects/v3-periphery/contracts/ctf.sol:1690) `redeemPositions(...)`

## 4. 前端检测字段

用户点击 Claim 时，读取以下数据（建议同一 `blockTag`）：

1. `claimSide`（YES / NO）
2. `sideWrappedBalance = IERC20(sideTokenAddr).balanceOf(user)`
3. `side1155Balance = CTF.balanceOf(user, sidePositionId)`
4. `apiClaimSideExpected`（后端接口返回该侧 claim 数额）

其中：

- `sideTokenAddr`、`sidePositionId` 由 `claimSide` 决定。
- `yesTokenAddr` / `noTokenAddr` 可由 `Wrapped1155Factory.getWrapped1155(...)` 得到，或使用你们已有 market 配置缓存。
- `claimSide` 优先使用后端返回的可领取方向；若后端未给方向，可用 `apiClaimYes/apiClaimNo` 中 `>0` 的一侧推导。

## 5. 判定状态机（按你的要求）

定义：

- `hasSideWrapped = sideWrappedBalance > 0`
- `ctfSideClaimable = side1155Balance`
- `apiSideClaimable = apiClaimSideExpected`

流程：

1. 如果 `hasSideWrapped == true`：
   - 先走 unwrap（仅 unwrap `claimSide`，数量 = `sideWrappedBalance`）
   - unwrap 完成后重新读取 `claimSide` 的 CTF 余额，再进入 claim

2. 如果 `hasSideWrapped == false`：
   - 若 `ctfSideClaimable > 0` 且 `ctfSideClaimable == apiSideClaimable`：
     - 直接走 claim（跳过 unwrap）
   - 否则：
     - 提示“仓位状态变化，请刷新后重试”，并触发重拉接口 + 链上余额

## 6. 推荐执行顺序（避免竞态）

1. 点击 Claim
2. 确定 `claimSide`
3. 读取该侧链上余额 + 接口该侧 claim 数（同一时间片）
4. 按状态机决定分支
5. 若执行 unwrap：
   - unwrap tx mined 后，强制 re-fetch 该侧链上余额
6. 执行 claim
7. claim tx mined 后，刷新资产与可领取状态

## 7. TypeScript 伪代码（前端可直接改）

```ts
import { BigNumber } from 'ethers';

type ClaimSide = 'YES' | 'NO';

type Snapshot = {
  claimSide: ClaimSide;
  sideWrapped: BigNumber;
  side1155: BigNumber;
  apiClaimSide: BigNumber;
};

function eq(a: BigNumber, b: BigNumber) {
  return a.eq(b);
}

function decideClaimPath(s: Snapshot) {
  const hasSideWrapped = s.sideWrapped.gt(0);
  const ctfSideClaimable = s.side1155;
  const apiSideClaimable = s.apiClaimSide;

  if (hasSideWrapped) return { action: 'UNWRAP_THEN_CLAIM' as const };

  if (ctfSideClaimable.gt(0) && eq(ctfSideClaimable, apiSideClaimable)) {
    return { action: 'DIRECT_CLAIM' as const };
  }

  return {
    action: 'REFRESH_AND_RETRY' as const,
    reason: 'SIDE_CTF_API_CLAIM_MISMATCH_OR_ZERO',
  };
}

async function handleClaimClick() {
  // 幂等锁：同一 user+market+claimSide 执行中不重复发起
  if (claimInFlight()) return;
  setClaimInFlight(true);

  try {
    const snap = await readSnapshot();
    const decision = decideClaimPath(snap);

    if (decision.action === 'UNWRAP_THEN_CLAIM') {
      await unwrapBySide(snap.claimSide, snap.sideWrapped);

      const after = await readSnapshot();
      if (after.side1155.lte(0)) {
        throw new Error('UNWRAP_DONE_BUT_SIDE_NOTHING_CLAIMABLE');
      }

      await claimOnCtf(snap.claimSide);
      return;
    }

    if (decision.action === 'DIRECT_CLAIM') {
      await claimOnCtf(snap.claimSide);
      return;
    }

    showToast('仓位状态变化，请刷新后重试');
    await refreshAll();
  } finally {
    setClaimInFlight(false);
  }
}
```

## 8. 前端提示文案建议

- 进入 unwrap 分支：
  - `检测到你在当前领取方向仍有可解包仓位，正在先解包后领取...`
- 进入 direct claim 分支：
  - `检测到你在当前领取方向已完成解包，正在直接领取...`
- 不一致分支：
  - `检测到链上仓位与可领取数据不同步，请刷新后重试。`

## 9. 验收标准（QA）

### Case A：claimSide 的 ERC20 有余额（未 unwrap）

- 预期：点击 Claim 后先 unwrap，再 claim 成功。

### Case B：claimSide 的 ERC20 为 0，CTF positionId 有余额（已 unwrap，未 claim）

- 预期：点击 Claim 直接 claim，不再调用 unwrap。

### Case C：非 claimSide 有 ERC20 余额，但 claimSide 的 ERC20 为 0 且 CTF 可领

- 预期：不应被非 claimSide 干扰，直接按 claimSide 执行 claim。

### Case D：claimSide 的 CTF 余额与接口该侧 claim 数额不一致

- 预期：不直接 claim，提示刷新并重新拉取数据。

## 10. 给前端 AI 的任务指令模板（可直接复制）

```text
请修改 Claim 按钮逻辑：
1) 点击后先确定本次 claimSide（YES 或 NO），并只读取该侧 wrapped ERC20 余额、该侧 CTF positionId 余额、接口该侧 claim 数额；
2) 若该侧 wrapped ERC20 > 0，先 unwrap（只 unwrap claimSide），unwrap 完成后再 claim；
3) 若该侧 wrapped ERC20 = 0，且该侧 CTF 余额 == 接口该侧 claim 数额 且 >0，则直接 claim；
4) 否则提示“仓位状态变化，请刷新后重试”，并刷新数据；
5) 保证流程幂等：增加 in-flight 锁，用户重复点击不会卡在 unwrap 分支。
```

