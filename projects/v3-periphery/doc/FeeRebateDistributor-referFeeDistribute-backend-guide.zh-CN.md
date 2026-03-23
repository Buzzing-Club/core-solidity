# FeeRebateDistributor `referFeeDistribute` 后端接入文档

## 1. 功能说明
`referFeeDistribute(address token, address to, uint256 amount)` 用于发放 `refer` 费用。

与 `distribute` 的执行路径一致，唯一差异是事件：
- `distribute` 发 `RebatePaid`
- `referFeeDistribute` 发 `ReferFeePaid`

适用场景：后端需要把“推荐分成”与“普通返佣”在链上事件层明确区分。

---

## 2. 合约与权限
- 合约：`FeeRebateDistributor`
- 调用权限：`onlyAuth`
- 前置条件：调用地址必须满足 `auth(caller) == true`

owner 需要提前授权：
- `setAuth(backendWallet, true)`

---

## 3. 函数定义
```solidity
function referFeeDistribute(address token, address to, uint256 amount) external onlyAuth;
function referFeeDistributeBatch(
    address token,
    address[] calldata recipients,
    uint256[] calldata amounts
) external onlyAuth;
```

参数说明：
- `token`: 要发放的 ERC20 地址（如 USDB）
- `to`: 收款地址（推荐人地址）
- `amount`: 发放数量（最小单位，需后端按 decimals 换算）
- `recipients`: 批量收款地址数组
- `amounts`: 批量金额数组（与 `recipients` 一一对应）

---

## 4. 执行流程（链上）
1. 校验 `to != address(0)`、`amount > 0`
2. 检查合约内 `token` 余额是否足够
3. 若不足：
   - 调用 `feeAdapter.getFee(address(this), token)` 查询可领取余额
   - 若 `pending > 0`，调用 `feeAdapter.claimFee(token)` 先领回
4. 再次检查余额，足够则转账给 `to`
5. 触发事件：`ReferFeePaid(token, to, amount)`

---

## 4.1 批量函数执行流程（链上）
`referFeeDistributeBatch` 的核心差异是“先汇总、一次补仓、再批量转账”：

1. 校验批次：
   - `recipients.length > 0`
   - `recipients.length == amounts.length`
   - 每条 `recipient != 0`、`amount > 0`
2. 汇总总金额 `total = sum(amounts)`
3. 调用 `_claimIfNeeded(token, total)`（只执行一次）
4. 循环逐条转账
5. 每条转账都触发 `ReferFeePaid(token, recipient, amount)`

适用场景：
- 一次结算多个推荐人分成
- 降低多笔单发的 gas 与链上调用次数

---

## 5. 事件监听
推荐后端只监听这两个事件：

```solidity
event FeeAdapterClaimed(address indexed token, uint256 amount);
event ReferFeePaid(address indexed token, address indexed to, uint256 amount);
```

业务建议：
- 以 `ReferFeePaid` 作为“推荐费已发放成功”的最终确认事件。
- `FeeAdapterClaimed` 可用于审计“本次发放是否触发了补仓领取”。

---

## 6. 常见回滚原因
- `Not auth`：调用地址未授权
- `Invalid recipient`：`to == address(0)`
- `Invalid amount`：`amount == 0`
- `Insufficient fee balance`：从 FeeAdapter 领取后余额仍不足
- `ST`：ERC20 `transfer` 失败

---

## 7. Ethers.js 调用示例（v5）
```js
const { ethers } = require("ethers");

const RPC = "https://base-rpc.publicnode.com";
const PK = process.env.PRIVATE_KEY; // 必须是已 auth 的后端钱包

const DISTRIBUTOR = "0x4F0077104Ca290cC4D26E0877033b8330334081F"; // 按实际替换
const TOKEN = "0x89401d7C5F5Cf4936F10418B9C536f97b0bCf71B"; // 例: USDB

const abi = [
  "function auth(address) view returns (bool)",
  "function referFeeDistribute(address token, address to, uint256 amount) external",
  "function referFeeDistributeBatch(address token, address[] recipients, uint256[] amounts) external",
  "event ReferFeePaid(address indexed token, address indexed to, uint256 amount)"
];

async function sendReferFee({ to, amountRaw }) {
  const provider = new ethers.providers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(PK, provider);
  const c = new ethers.Contract(DISTRIBUTOR, abi, wallet);

  const allowed = await c.auth(wallet.address);
  if (!allowed) throw new Error("backend wallet is not auth");

  const tx = await c.referFeeDistribute(TOKEN, to, amountRaw);
  const rc = await tx.wait();

  const evt = rc.events?.find((e) => e.event === "ReferFeePaid");
  console.log({
    txHash: tx.hash,
    token: evt?.args?.token,
    to: evt?.args?.to,
    amount: evt?.args?.amount?.toString()
  });
}

// 示例：发 10 USDB（6 decimals）
// sendReferFee({
//   to: "0xYourReferrerAddress",
//   amountRaw: ethers.BigNumber.from("10000000")
// }).catch(console.error);

async function sendReferFeeBatch({ recipients, amountsRaw }) {
  if (recipients.length !== amountsRaw.length) {
    throw new Error("length mismatch");
  }

  const provider = new ethers.providers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(PK, provider);
  const c = new ethers.Contract(DISTRIBUTOR, abi, wallet);

  const allowed = await c.auth(wallet.address);
  if (!allowed) throw new Error("backend wallet is not auth");

  const tx = await c.referFeeDistributeBatch(TOKEN, recipients, amountsRaw);
  const rc = await tx.wait();

  const events = (rc.events || []).filter((e) => e.event === "ReferFeePaid");
  console.log({
    txHash: tx.hash,
    count: events.length,
    details: events.map((e) => ({
      token: e.args?.token,
      to: e.args?.to,
      amount: e.args?.amount?.toString(),
    })),
  });
}

// 示例：批量发放
// sendReferFeeBatch({
//   recipients: [
//     "0xReferrerA",
//     "0xReferrerB"
//   ],
//   amountsRaw: [
//     ethers.BigNumber.from("5000000"), // 5 USDB
//     ethers.BigNumber.from("12000000") // 12 USDB
//   ]
// }).catch(console.error);
```

---

## 8. 后端落地建议
- 在发放前先做参数校验（地址合法、金额 > 0、金额上限控制）。
- 对每笔请求生成业务单号，并与 `txHash` 绑定。
- 以 `ReferFeePaid` 事件作为最终成功依据，不只看交易发送成功。
- 建议做重放保护（同一业务单号只允许发一次）。
