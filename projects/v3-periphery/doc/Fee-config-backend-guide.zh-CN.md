# Fee 配置后端接入文档（3 角色版）

## 目标
将每个交易池（pool）的 fee 规则设置为：
- 总 fee：`1%`
- `protocol`：`80%`
- `refer`：`10%`
- `feeRebate`：`10%`

对应关系：
- `protocol` 和 `feeRebate` 是固定角色（`setPoolRole`）
- `refer` 是推荐人分成（`setPoolReferShare`）

---

## 合约与权限
- 合约：`FeeAdapterTransparent`（Base）
- 地址：`0x122ea913388bb4bb95933e6D8788d9C9eB723E4c`
- 需要权限：`owner` 才能调用配置函数

---

## 计量单位（非常重要）
`FeeAdapterTransparent` 使用 `RATIO_SCALE = 1_000_000`。

1. 总 fee `1%`：
- `totalFeeRatio = 10_000`（因为 `10_000 / 1_000_000 = 1%`）

2. 在总 fee 里的角色分成（内部 share）：
- `protocol = 8_000`
- `feeRebate = 1_000`
- `referShare = 1_000`

必须满足：
- `protocol + feeRebate + referShare == totalFeeRatio`
- 即 `8000 + 1000 + 1000 == 10000`

否则交易记录 fee 时会触发 `Share sum mismatch` 回滚。

---

## 后端需要准备的输入
- `pool`：要配置的池地址
- `protocolRecipient`：协议收款地址
- `feeRebateRecipient`：建议填 `FeeRebateDistributor` 地址  
  Base 当前地址：`0xEb81F8bc021aF56326d5704Eb4dc1b857dEc2C00`

> `refer` 不需要 recipient 地址，它来自交易时传入的推荐人地址。  
> 若无推荐人，`refer` 份额会记到 `FeeAdapterTransparent.owner`。

---

## 推荐调用顺序（单个 pool）
1. `setPoolRole(pool, roleProtocol, protocolRecipient, 8000)`
2. `setPoolRole(pool, roleFeeRebate, feeRebateRecipient, 1000)`
3. `setPoolReferShare(pool, 1000)`
4. `setPoolTotalFeeRatio(pool, 10000)`

---

## Ethers.js 示例代码（后端可直接改造）
```js
const { ethers } = require("ethers");

const RPC = "https://base-rpc.publicnode.com";
const PK = process.env.PRIVATE_KEY; // FeeAdapter owner 私钥

const FEE_ADAPTER = "0x122ea913388bb4bb95933e6D8788d9C9eB723E4c";
const FEE_REBATE_DISTRIBUTOR = "0xEb81F8bc021aF56326d5704Eb4dc1b857dEc2C00";

const abi = [
  "function owner() view returns (address)",
  "function setPoolTotalFeeRatio(address pool, uint256 ratio) external",
  "function setPoolRole(address pool, bytes32 role, address recipient, uint256 share) external",
  "function setPoolReferShare(address pool, uint256 share) external",
  "function poolTotalFeeRatio(address pool) view returns (uint256)",
  "function poolRoleShares(address pool, bytes32 role) view returns (uint256)",
  "function poolRoleRecipients(address pool, bytes32 role) view returns (address)",
  "function poolReferShare(address pool) view returns (uint256)"
];

function b32(text) {
  return ethers.utils.formatBytes32String(text);
}

async function configPoolFee({
  pool,
  protocolRecipient,
  feeRebateRecipient = FEE_REBATE_DISTRIBUTOR
}) {
  const provider = new ethers.providers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(PK, provider);
  const c = new ethers.Contract(FEE_ADAPTER, abi, wallet);

  const roleProtocol = b32("protocol");
  const roleFeeRebate = b32("feeRebate");

  // 1% total fee
  const totalFeeRatio = 10_000;
  // split inside the 1%
  const protocolShare = 8_000;
  const feeRebateShare = 1_000;
  const referShare = 1_000;

  if (protocolShare + feeRebateShare + referShare !== totalFeeRatio) {
    throw new Error("share sum mismatch");
  }

  // write
  await (await c.setPoolRole(pool, roleProtocol, protocolRecipient, protocolShare)).wait();
  await (await c.setPoolRole(pool, roleFeeRebate, feeRebateRecipient, feeRebateShare)).wait();
  await (await c.setPoolReferShare(pool, referShare)).wait();
  await (await c.setPoolTotalFeeRatio(pool, totalFeeRatio)).wait();

  // verify
  const [t, pShare, pTo, rShare, rTo, refer] = await Promise.all([
    c.poolTotalFeeRatio(pool),
    c.poolRoleShares(pool, roleProtocol),
    c.poolRoleRecipients(pool, roleProtocol),
    c.poolRoleShares(pool, roleFeeRebate),
    c.poolRoleRecipients(pool, roleFeeRebate),
    c.poolReferShare(pool)
  ]);

  console.log({
    pool,
    totalFeeRatio: t.toString(),
    protocol: { share: pShare.toString(), recipient: pTo },
    feeRebate: { share: rShare.toString(), recipient: rTo },
    referShare: refer.toString()
  });
}

// 示例调用
// configPoolFee({
//   pool: "0xYourPoolAddress",
//   protocolRecipient: "0xYourProtocolWallet"
// }).catch(console.error);
```

---

## 多池批量配置建议
- 后端按 pool 列表循环调用 `configPoolFee`
- 每个 pool 完成后做一次链上读回校验
- 建议记录：
  - `pool`
  - 4 笔 tx hash
  - 最终读回值（total/protocol/feeRebate/refer）

---

## 运行后验收标准
对每个 pool，满足以下条件即配置成功：
- `poolTotalFeeRatio(pool) == 10000`
- `poolRoleShares(pool, "protocol") == 8000`
- `poolRoleShares(pool, "feeRebate") == 1000`
- `poolReferShare(pool) == 1000`
- `protocol + feeRebate + refer == total`

