# Buzzing Base Mainnet Claim/USDB Deposit Verification Agent Context

This file is the compact context an AI agent needs to verify:

1. whether a user completed USDB conversion/deposit on Base mainnet, including conversion funded through a deterministic helper deposit address;
2. whether a user redeemed/claimed a specific CTF market, and the redeemed amount.

## How To Use This File With CC/Codex-Style AI Agents

If the operator uses CC, Codex, or a similar local AI coding assistant:

1. Create a new empty project directory, for example `buzzing-query-agent`.
2. Put this `agent.md` file in that project root.
3. Start CC / Codex from that project directory.
4. Begin the conversation with:

```text
Please read agent.md in the current project root first, and use it as the source of truth for Base mainnet addresses, RPC, ABI fragments, event topics, and query rules.
```

After that, users can ask natural-language questions such as:

```text
帮我查一下 0x... 在 2026-04-20 晚上 8 点左右有没有充值记录。
帮我确认 0x... 昨天下午是否 redeem 了 0x... 这个 conditionId。
```

This file is self-contained. The agent should not look for a local repo, deployment state file, or build artifact.

## Network And Deployed Addresses

- Network: Base mainnet
- Chain ID: `8453`
- Default explorer: `https://basescan.org`
- Preferred RPC for queries: `https://base.blockpi.network/v1/rpc/10f2757d303cf716e111d3f543ca49904d6e04f4`

Mainnet addresses from the current deployment state:

```text
USDB                  0x89401d7C5F5Cf4936F10418B9C536f97b0bCf71B
USDC                  0x833589fcd6edb6e08f4c7c32d4f71b54bda02913
CTF / ConditionalTokens 0x4bC1A3BEE6200790d32Cb28B01eAFf4634B328c3
ContractFactory       0x179365245C424453C51F2f34b0AA2C51fC32EaCC
TradeManagerProxy     0x4a8793AE855AE40A00504D61d2ac4074B5214669
PreTrading            0xd53c2Eeb5966108bbb74e4e427321271a2f8fFaf
tBLPProxy             0x1DBC025A07c904F876946C98dfa3B36dAc365Ca3
sBLPProxy             0x360A3417a4192B6D49a31c1AcabB59E10Da29dfB
```

USDB uses 6 decimals. Raw amount `1000000` means `1.000000 USDB`.

## Minimal ABI And Topics

Use these ABI fragments for log decoding:

```js
const USDB_ABI = [
  "event Deposit(address to,uint256 amount)",
  "event Withdraw(address to,uint256 amount)",
  "event Transfer(address indexed from,address indexed to,uint256 amount)",
  "function balanceOf(address account) view returns (uint256)",
  "function deposit(address to,uint256 amount)",
  "function withdraw(address to,uint256 amount)",
  "function decimals() view returns (uint8)"
];

const USDC_ABI = [
  "event Transfer(address indexed from,address indexed to,uint256 amount)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)"
];

const CTF_ABI = [
  "event PayoutRedemption(address indexed redeemer,address indexed collateralToken,bytes32 indexed parentCollectionId,bytes32 conditionId,uint256[] indexSets,uint256 payout)",
  "event ConditionResolution(bytes32 indexed conditionId,address indexed oracle,bytes32 indexed questionId,uint256 outcomeSlotCount,uint256[] payoutNumerators)",
  "function redeemPositions(address collateralToken,bytes32 parentCollectionId,bytes32 conditionId,uint256[] indexSets)",
  "function getOutcomeSlotCount(bytes32 conditionId) view returns (uint256)",
  "function payoutDenominator(bytes32 conditionId) view returns (uint256)",
  "function payoutNumerators(bytes32 conditionId,uint256 index) view returns (uint256)",
  "function getCollectionId(bytes32 parentCollectionId,bytes32 conditionId,uint256 indexSet) view returns (bytes32)",
  "function getPositionId(address collateralToken,bytes32 collectionId) pure returns (uint256)",
  "function balanceOf(address account,uint256 id) view returns (uint256)"
];

const DEPOSIT_CONTRACT_ABI = [
  "function eoa() view returns (address)",
  "function factoryOwner() view returns (address)",
  "function usdbAddr() view returns (address)",
  "function usdcAddr() view returns (address)",
  "function deposit(address to)"
];

```

Common event topics:

```text
ERC20 Transfer(address,address,uint256)
0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef

USDB Deposit(address,uint256)
0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c

CTF PayoutRedemption(address,address,bytes32,bytes32,uint256[],uint256)
0x2682012a4a4f1973119f1c9b90745d1bd91fa2bab387344f044cb3586864d18d

CTF redeemPositions selector
0x01b7037c
```

Important: in `PayoutRedemption`, only `redeemer`, `collateralToken`, and `parentCollectionId` are indexed. `conditionId`, `indexSets`, and `payout` are in log data. Do not try to filter `conditionId` as a topic.

## Contract Behavior Summary

### USDB

`USDB.deposit(to, amount)` does the following:

1. transfers `amount` USDC from `msg.sender` to the USDB contract;
2. mints `amount` USDB to `to`;
3. transfers the received USDC from the USDB contract to `vault`;
4. emits `Deposit(to, amount)`;
5. the ERC20 mint also emits `Transfer(0x0000000000000000000000000000000000000000, to, amount)`.

Best primary evidence for a USDB conversion to a user:

- same transaction contains `USDB.Deposit(to=user, amount=N)`;
- same transaction contains `USDB.Transfer(from=zero, to=user, amount=N)`;
- optional same transaction contains `USDC.Transfer(from=funderOrDepositContract, to=USDB, amount=N)`.

Do not use current `USDB.balanceOf(user)` alone to prove a deposit happened. The user may have transferred, spent, withdrawn, or received USDB later.

### Deterministic Helper Deposit Address

`ContractFactory.deploy(eoa)` deploys a `DepositContract` using CREATE2.

Factory source behavior:

```solidity
depositContractAddr = address(new DepositContract{
  salt: keccak256(abi.encode(usdcAddr, usdbAddr, eoa))
}());
```

The deployed `DepositContract.deposit(to)`:

1. reads its full USDC balance;
2. approves USDB;
3. calls `USDB.deposit(to, amount)`.

Only the factory owner can call `DepositContract.deposit(to)`. The `to` parameter is the real USDB recipient and should still be verified from the USDB logs.

The DepositContract creation-code hash for this deployment is:

```text
0xe7e661ce55199815e7e9aeb58126e0d02604513ee236b8dd5eebdae388fcf318
```

CREATE2 formula:

```text
salt = keccak256(abi.encode(USDC, USDB, eoa))
depositAddress = last20bytes(keccak256(0xff ++ ContractFactory ++ salt ++ depositContractInitCodeHash))
```

JavaScript helper using ethers v5:

```js
const { ethers } = require("ethers");

const CONTRACT_FACTORY = "0x179365245C424453C51F2f34b0AA2C51fC32EaCC";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const USDB = "0x89401d7C5F5Cf4936F10418B9C536f97b0bCf71B";
const DEPOSIT_INIT_CODE_HASH =
  "0xe7e661ce55199815e7e9aeb58126e0d02604513ee236b8dd5eebdae388fcf318";

function helperDepositAddress(eoa) {
  const salt = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ["address", "address", "address"],
      [USDC, USDB, eoa]
    )
  );
  return ethers.utils.getCreate2Address(
    CONTRACT_FACTORY,
    salt,
    DEPOSIT_INIT_CODE_HASH
  );
}
```

## Scheme 1: Verify USDB Deposit Around A Time Window

Input:

- `user`: the recipient address to check;
- approximate timestamp or date;
- search radius, for example plus/minus 30 minutes or plus/minus 2 hours.

Recommended path:

1. Query the user's address-level activity first, especially USDB token transfers involving the user.
2. A practical public endpoint is:

```text
https://base.blockscout.com/api/v2/addresses/{user}/token-transfers?type=ERC-20
```

3. Filter returned token transfers where:
   - token address is USDB;
   - `to=user`;
   - amount matches the requested amount, if the user specified one;
   - timestamp is inside the requested time window, if the user specified one.
4. For each candidate transaction, fetch the receipt from RPC and confirm the same transaction contains `USDB.Deposit(to=user, amount)` and `USDB.Transfer(from=zero, to=user, amount)`.
5. If this endpoint is temporarily unavailable, use another address-level explorer/API page for the same user and filter transactions or token transfers there. For this project, do not switch to broad contract-log queries for routine checks.

Important: do not rely only on the user's normal transaction list. Helper deposits can mint USDB to the user even though the user did not send the transaction. Address-level token transfers are the useful first pass.

Interpretation:

- `USDB Transfer zero -> user` plus `USDB Deposit(to=user)` means the user received newly converted USDB.
- `USDC Transfer helperDepositAddress(user) -> USDB` in the same transaction means the deterministic helper address funded it.
- `USDC Transfer user -> USDB` in the same transaction means the user directly funded it.
- If the USDB mint exists without `USDB.Deposit`, it may be vault mint/distribution rather than user USDC conversion.

## Scheme 2: Verify USDB Balance Change Around A Time Window

Use this when the question is "did the user's USDB balance change" rather than "did the user convert USDC into USDB".

Preferred method if using an archive RPC:

1. Find `beforeBlock` and `afterBlock` around the target time.
2. Call `USDB.balanceOf(user)` with `blockTag=beforeBlock`.
3. Call `USDB.balanceOf(user)` with `blockTag=afterBlock`.
4. Delta = after - before.
5. Explain the delta by decoding ERC20 `Transfer` logs involving the user in the same range:
   - `Transfer(from=zero, to=user)` means mint;
   - `Transfer(from=user, to=zero)` means burn/withdraw;
   - `Transfer(from=user, to=someone)` means outgoing transfer/spend;
   - `Transfer(from=someone, to=user)` means incoming transfer.

Without archive RPC:

1. Query the user's address-level USDB token transfers over the requested time window.
2. Compute net delta from decoded logs:
   - add amounts where `to=user`;
   - subtract amounts where `from=user`.

This proves the delta visible in the chosen address activity window, not the absolute historical balance.

## Scheme 3: Verify A CTF Claim/Redeem For A Condition

Input:

- `user`: the redeemer address;
- `conditionId`: the market condition ID;
- optional `collateralToken`, normally USDB for USDB-backed positions;
- optional `parentCollectionId`, normally `0x0000000000000000000000000000000000000000000000000000000000000000`;
- approximate timestamp or date.

Recommended path:

1. Query the user's address-level transactions first.
2. Practical public endpoints:

```text
https://base.blockscout.com/api/v2/addresses/{user}/transactions
https://base.blockscout.com/api/v2/addresses/{user}/token-transfers?type=ERC-20
https://base.blockscout.com/api/v2/addresses/{user}/token-transfers?type=ERC-1155
```

3. Use address transactions as the first candidate set. Keep transactions near the requested time and transactions whose method/input indicates `redeemPositions`, `claim`, or another known claim wrapper.
4. If the user is a smart account or EIP-7702/4337-style account, the normal transaction list may be sparse. In that case, also inspect token transfers and internal/activity pages from the explorer, then fetch candidate receipts by transaction hash.
5. For every candidate transaction, fetch the receipt from RPC and decode CTF logs from the receipt.
6. Keep only decoded `PayoutRedemption` logs where:
   - `redeemer == user`;
   - decoded `conditionId` equals the requested condition ID;
   - optional decoded `collateralToken` and `parentCollectionId` match the requested/default values.
7. The claim quantity is decoded `payout`, in collateral token decimals. For USDB collateral, divide raw payout by `1e6`.
8. `indexSets` tells which outcome positions were redeemed. `payout=0` means the function was called but no collateral was paid out.
9. If one address-level source is incomplete, use another explorer/API or broaden the address activity query. For this project, do not switch to broad CTF contract-log queries for routine checks.

Event shape:

```solidity
event PayoutRedemption(
  address indexed redeemer,
  IERC20 indexed collateralToken,
  bytes32 indexed parentCollectionId,
  bytes32 conditionId,
  uint[] indexSets,
  uint payout
);
```

Useful conclusions:

- completed claim with positive value: matching event exists and `payout > 0`;
- attempted claim/no payout: matching event exists and `payout == 0`;
- no evidence in window: no matching decoded event. Expand the address activity time window if the time is approximate.

## Natural-Language Request Handling

Most users will not provide structured parameters. They usually ask in natural language. The agent should extract the target address, approximate time, task type, and optional market condition ID.

Common user requests:

```text
帮我查一下 0xabc... 这个地址在 2026-04-20 晚上 8 点左右有没有充值记录
查一下这个用户 0xabc... 昨天 15:30 附近是否完成 USDB 充值
帮我看 0xabc... 在 2026-04-20 12:00 UTC 前后有没有 USDB deposit
查一下 0xabc... 有没有在某个 conditionId 里 claim，conditionId 是 0x...
帮我确认 0xabc... 在昨天下午是否 redeem 了 0x... 这个市场
```

Extraction rules:

- `address`: the first EVM address in the user request is normally the user/redeemer address.
- `time`: preserve the user's timezone if stated. If not stated, ask for clarification only when the date is ambiguous; otherwise use the operator's local timezone and report the timezone used.
- `window`: if the user says "附近/左右", default to plus/minus 30 minutes for USDB deposit checks and plus/minus 2 hours for redeem checks.
- `task type`: words like "充值", "deposit", "USDB", "兑换" mean USDB deposit verification. Words like "claim", "redeem", "领取", "赎回", plus a `conditionId`, mean CTF redeem verification.
- `conditionId`: for redeem checks, require a 32-byte hex condition ID. If it is missing, ask the user for it.

For USDB deposit natural-language requests, the agent should:

1. parse the user address and approximate time;
2. query address-level USDB token transfers first;
3. fetch candidate receipts from the preferred RPC and verify `USDB.Deposit`;
4. if one address-level source is incomplete, use another explorer/API or expand the address activity time window;
5. answer in Chinese with conclusion, amount, tx hash, block/time, and source classification.

Example output:

```text
查到了。这个地址在 2026-04-20 20:13:42 UTC 有一笔 USDB 充值。

金额：123.456789 USDB
交易：0x...
区块：...
来源：helper deposit
代充地址：0x...

判断依据：同一笔交易里同时出现了 USDB.Transfer(0x0 -> 用户) 和 USDB.Deposit(to=用户)，并且 USDC 从代充地址转入 USDB 合约。
```

If no result is found:

```text
这个时间窗口内没有查到该地址的 USDB 充值记录。我查的是 2026-04-20 19:30:00 到 20:30:00 UTC 之间的 Base 区块。

需要的话可以把窗口扩大到前后 2 小时再查一次。
```

For CTF redeem natural-language requests, the agent should:

1. parse the user/redeemer address, condition ID, and approximate time;
2. query address-level transactions/activity first and keep candidates near the requested time;
3. fetch candidate receipts from the preferred RPC and decode CTF `PayoutRedemption` logs;
4. compare decoded `conditionId`;
5. if one address-level source is incomplete, use another explorer/API or expand the address activity time window;
6. answer in Chinese with conclusion, payout, tx hash, block/time, and index sets.

## Example Query Script Skeleton

This skeleton uses ethers v5 and an RPC URL. It is intentionally small so it can be pasted into any agent environment.

```js
const { ethers } = require("ethers");

const RPC_URL =
  process.env.BASE_RPC_URL ||
  "https://base.blockpi.network/v1/rpc/10f2757d303cf716e111d3f543ca49904d6e04f4";
const provider = new ethers.providers.JsonRpcProvider(RPC_URL);

const USDB = "0x89401d7C5F5Cf4936F10418B9C536f97b0bCf71B";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const CTF = "0x4bC1A3BEE6200790d32Cb28B01eAFf4634B328c3";

const usdbIface = new ethers.utils.Interface([
  "event Deposit(address to,uint256 amount)",
  "event Transfer(address indexed from,address indexed to,uint256 amount)"
]);

const usdcIface = new ethers.utils.Interface([
  "event Transfer(address indexed from,address indexed to,uint256 amount)"
]);

const ctfIface = new ethers.utils.Interface([
  "event PayoutRedemption(address indexed redeemer,address indexed collateralToken,bytes32 indexed parentCollectionId,bytes32 conditionId,uint256[] indexSets,uint256 payout)"
]);

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function sameAddress(a, b) {
  return a && b && a.toLowerCase() === b.toLowerCase();
}

async function blockscoutJson(path) {
  const res = await fetch(`https://base.blockscout.com/api/v2${path}`);
  if (!res.ok) throw new Error(`Blockscout ${res.status}: ${await res.text()}`);
  return res.json();
}

async function getAddressTransactions(user) {
  return blockscoutJson(`/addresses/${user}/transactions`);
}

async function getAddressTokenTransfers(user, type = "ERC-20") {
  return blockscoutJson(`/addresses/${user}/token-transfers?type=${type}`);
}

async function verifyUsdbDepositTx(txHash, user) {
  const receipt = await provider.getTransactionReceipt(txHash);
  const usdbDecoded = receipt.logs
    .filter((x) => sameAddress(x.address, USDB))
    .map((x) => {
      try { return usdbIface.parseLog(x); } catch { return null; }
    })
    .filter(Boolean);

  const mints = usdbDecoded.filter((x) =>
    x.name === "Transfer" &&
    sameAddress(x.args.from, ZERO_ADDRESS) &&
    sameAddress(x.args.to, user)
  );

  return mints
    .map((mint) => {
      const deposit = usdbDecoded.find((x) =>
        x.name === "Deposit" &&
        sameAddress(x.args.to, user) &&
        x.args.amount.eq(mint.args.amount)
      );
      if (!deposit) return null;
      return {
        txHash,
        blockNumber: receipt.blockNumber,
        rawAmount: mint.args.amount.toString(),
        usdb: ethers.utils.formatUnits(mint.args.amount, 6)
      };
    })
    .filter(Boolean);
}

async function verifyCtfRedemptionTx(txHash, user, conditionId, collateralToken = USDB, parentCollectionId = null) {
  const receipt = await provider.getTransactionReceipt(txHash);
  return receipt.logs
    .filter((x) => sameAddress(x.address, CTF))
    .map((x) => {
      try { return ctfIface.parseLog(x); } catch { return null; }
    })
    .filter(Boolean)
    .filter((parsed) => parsed.name === "PayoutRedemption")
    .filter((parsed) =>
      sameAddress(parsed.args.redeemer, user) &&
      parsed.args.conditionId.toLowerCase() === conditionId.toLowerCase() &&
      (!collateralToken || sameAddress(parsed.args.collateralToken, collateralToken)) &&
      (!parentCollectionId || parsed.args.parentCollectionId.toLowerCase() === parentCollectionId.toLowerCase())
    )
    .map((parsed) => ({
      txHash,
      blockNumber: receipt.blockNumber,
      conditionId: parsed.args.conditionId,
      collateralToken: parsed.args.collateralToken,
      parentCollectionId: parsed.args.parentCollectionId,
      indexSets: parsed.args.indexSets.map((x) => x.toString()),
      rawPayout: parsed.args.payout.toString(),
      payoutUSDB: ethers.utils.formatUnits(parsed.args.payout, 6)
    }));
}

async function findUsdbDepositsFromAddressActivity(user, nearTimestampMs, windowMs) {
  const data = await getAddressTokenTransfers(user, "ERC-20");
  const candidates = (data.items || []).filter((item) => {
    const tokenAddress = item.token?.address_hash || item.token?.address;
    const to = item.to?.hash || item.to;
    const ts = item.timestamp ? Date.parse(item.timestamp) : 0;
    return sameAddress(tokenAddress, USDB) &&
      sameAddress(to, user) &&
      Math.abs(ts - nearTimestampMs) <= windowMs;
  });

  const rows = [];
  for (const item of candidates) {
    const txHash = item.transaction_hash || item.tx_hash || item.transaction?.hash;
    if (!txHash) continue;
    rows.push(...await verifyUsdbDepositTx(txHash, user));
  }
  return rows;
}

async function findCtfRedemptionsFromAddressActivity(user, conditionId, nearTimestampMs, windowMs) {
  const data = await getAddressTransactions(user);
  const candidates = (data.items || []).filter((item) => {
    const ts = item.timestamp ? Date.parse(item.timestamp) : 0;
    return Math.abs(ts - nearTimestampMs) <= windowMs;
  });

  const rows = [];
  for (const item of candidates) {
    const txHash = item.hash || item.transaction_hash || item.tx_hash;
    if (!txHash) continue;
    rows.push(...await verifyCtfRedemptionTx(txHash, user, conditionId));
  }
  return rows;
}
```

## Practical Checklist For The Local Agent

For USDB deposit verification:

1. normalize the user address with checksum/lowercase comparison;
2. establish a timestamp window from the requested time;
3. query address-level USDB token transfers first and use them as candidates;
4. cross-check each candidate receipt with `USDB.Deposit(to=user, amount)` and `USDB.Transfer(zero,user,amount)`;
5. inspect same transaction USDC logs to classify direct funding vs helper deposit funding;
6. if one address-level source is incomplete, use another explorer/API or expand the address activity time window;
7. report tx hash, block number, timestamp, raw amount, formatted amount, and funding classification.

For CTF redeem verification:

1. normalize the user address and condition ID;
2. query address-level transactions/activity first and use them as candidates;
3. fetch candidate receipts and decode CTF `PayoutRedemption` logs;
4. compare decoded `conditionId`, plus optional collateral/parent;
5. if one address-level source is incomplete, use another explorer/API or expand the address activity time window;
6. report tx hash, block number, timestamp, raw payout, formatted payout, collateral token, parent collection, and index sets;
7. treat `payout=0` as a redeem attempt, not a successful positive-value claim.

## Common Pitfalls

- `USDB.Deposit(to, amount)` fields are not indexed, so filtering by `to` cannot be done with topics. Use `Transfer(zero,user,amount)` as the indexed first pass, then decode receipt logs.
- For this project, address-level token transfers are the recommended path. Use token transfers first, then receipts for proof.
- Normal account transactions alone can miss helper deposits because the user may be only the USDB recipient. Use address token transfers, not only normal transactions.
- For redeem checks, use address-level transactions/activity and decode candidate receipts. Do not use broad CTF contract-log queries for routine checks.
- `PayoutRedemption.conditionId` is not indexed. Filter by `redeemer` first, then decode and compare `conditionId`.
- Current USDB balance is not proof of deposit completion because later transfers/spends/withdraws may change it.
- The helper deposit address is tied to the `eoa` used in the CREATE2 salt, but `DepositContract.deposit(to)` can mint to any `to` chosen by factory owner. Always verify the actual recipient from USDB logs.
- USDB and USDC both use 6 decimals on this deployment, but always prefer `decimals()` when building reusable tooling.
