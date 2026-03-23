# Fee 配置后端接入文档（当前合约口径）

## 目标
将每个交易池（pool）的 fee 规则设置为：
- 总 fee：`1%`
- `protocol`：`70%`
- `refer`：`20%`
- `feeRebate`：`10%`

当前实现口径：
- `protocol` / `refer` / `feeRebate` 全部作为 `setPoolRole` 的角色统一分发。
- `recordFee(pool, refer, token, totalFeeAmount)` 中的 `refer` 参数当前未参与分发计算。
- 推荐人收款地址由 `setPoolRole(pool, roleRefer, referRecipient, referShare)` 固定配置。

---

## 合约与权限
- 合约：`FeeAdapterTransparent`（Base）
- 地址：`0x122ea913388bb4bb95933e6D8788d9C9eB723E4c`
- 调用权限：`owner` 才能调用配置函数

---

## 计量单位（重要）
`FeeAdapterTransparent` 使用 `RATIO_SCALE = 1_000_000`。

1. 总 fee `1%`
- `totalFeeRatio = 10_000`（`10_000 / 1_000_000 = 1%`）

2. 角色分成（share）
- `protocol = 7_000`
- `refer = 2_000`
- `feeRebate = 1_000`

必须满足：
- `protocol + refer + feeRebate == totalFeeRatio`
- 即 `7000 + 2000 + 1000 == 10000`

否则 `recordFee` 会触发 `Share sum mismatch` 回滚。

---

## 后端需要准备的输入
- `pool`：池地址
- `protocolRecipient`：协议收款地址
- `referRecipient`：推荐分成收款地址（当前版本为固定地址，不随交易入参变化）
- `feeRebateRecipient`：建议填 `FeeRebateDistributor` 地址
  - Base 当前：`0xEb81F8bc021aF56326d5704Eb4dc1b857dEc2C00`

---

## 推荐调用顺序（单个 pool）
1. `setPoolRole(pool, roleProtocol, protocolRecipient, 7000)`
2. `setPoolRole(pool, roleRefer, referRecipient, 2000)`
3. `setPoolRole(pool, roleFeeRebate, feeRebateRecipient, 1000)`
4. `setPoolTotalFeeRatio(pool, 10000)`

说明：
- 当前版本不依赖 `setPoolReferShare` 参与 `recordFee` 分发。
- 如继续调用 `setPoolReferShare`，不会改变当前统一 role 分发结果。

---

## Ethers.js 示例代码（可直接改造）
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
  "function poolTotalFeeRatio(address pool) view returns (uint256)",
  "function poolRoleShares(address pool, bytes32 role) view returns (uint256)",
  "function poolRoleRecipients(address pool, bytes32 role) view returns (address)",
  "function getPoolRoles(address pool) view returns (bytes32[])"
];

function b32(text) {
  return ethers.utils.formatBytes32String(text);
}

async function configPoolFee({
  pool,
  protocolRecipient,
  referRecipient,
  feeRebateRecipient = FEE_REBATE_DISTRIBUTOR
}) {
  const provider = new ethers.providers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(PK, provider);
  const c = new ethers.Contract(FEE_ADAPTER, abi, wallet);

  const roleProtocol = b32("protocol");
  // refer 角色使用老合约大写口径
  const roleRefer = b32("REFERRAL");
  const roleFeeRebate = b32("feeRebate");

  const totalFeeRatio = 10_000;
  const protocolShare = 7_000;
  const referShare = 2_000;
  const feeRebateShare = 1_000;

  if (protocolShare + referShare + feeRebateShare !== totalFeeRatio) {
    throw new Error("share sum mismatch");
  }

  await (await c.setPoolRole(pool, roleProtocol, protocolRecipient, protocolShare)).wait();
  await (await c.setPoolRole(pool, roleRefer, referRecipient, referShare)).wait();
  await (await c.setPoolRole(pool, roleFeeRebate, feeRebateRecipient, feeRebateShare)).wait();
  await (await c.setPoolTotalFeeRatio(pool, totalFeeRatio)).wait();

  const [
    total,
    protocolS,
    protocolTo,
    referS,
    referTo,
    rebateS,
    rebateTo,
    roles
  ] = await Promise.all([
    c.poolTotalFeeRatio(pool),
    c.poolRoleShares(pool, roleProtocol),
    c.poolRoleRecipients(pool, roleProtocol),
    c.poolRoleShares(pool, roleRefer),
    c.poolRoleRecipients(pool, roleRefer),
    c.poolRoleShares(pool, roleFeeRebate),
    c.poolRoleRecipients(pool, roleFeeRebate),
    c.getPoolRoles(pool)
  ]);

  console.log({
    pool,
    totalFeeRatio: total.toString(),
    protocol: { share: protocolS.toString(), recipient: protocolTo },
    refer: { share: referS.toString(), recipient: referTo },
    feeRebate: { share: rebateS.toString(), recipient: rebateTo },
    roles
  });
}

// 示例
// configPoolFee({
//   pool: "0xYourPoolAddress",
//   protocolRecipient: "0xYourProtocolWallet",
//   referRecipient: "0xYourReferWallet"
// }).catch(console.error);
```

---

## 多池批量配置建议
- 后端按 pool 列表循环调用配置函数
- 每个 pool 完成后做一次链上读回校验
- 建议留档：
  - `pool`
  - 4 笔 tx hash（3 次 `setPoolRole` + 1 次 `setPoolTotalFeeRatio`）
  - 最终读回值（total/protocol/refer/feeRebate）

---

## 运行后验收标准
对每个 pool，满足以下条件即配置成功：
- `poolTotalFeeRatio(pool) == 10000`
- `poolRoleShares(pool, protocol) == 7000`
- `poolRoleShares(pool, refer) == 2000`
- `poolRoleShares(pool, feeRebate) == 1000`
- `protocol + refer + feeRebate == total`
- `poolRoleRecipients` 与预期收款地址一致
