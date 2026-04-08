# PreTrading 按市场阈值配置后端接入文档

## 1. 改动背景
PreTrading 现已支持按 `conditionId` 配置独立的 `marketTransferThreshold`。

核心变化：
- 新增：`marketTransferThresholdByCondition(conditionId)`
- 新增：`setMarketTransferThreshold(bytes32 conditionId, uint256 threshold)`（`onlyOracle`）
- `deposit` 新约束：对应市场阈值必须 `> 0`，否则回滚：`Market threshold not set`

这意味着：每次创建新市场后，后端必须先为该市场设置阈值，用户才能下注。

---

## 2. 必做流程（创建市场后）
1. 创建市场，拿到 `conditionId`
2. 调用 `setMarketTransferThreshold(conditionId, thresholdRaw)`
3. 读链校验 `marketTransferThresholdByCondition(conditionId)` 是否等于设置值
4. 再开放前端下注

---

## 3. 函数定义
```solidity
function setMarketTransferThreshold(bytes32 conditionId, uint256 threshold) external;
function marketTransferThresholdByCondition(bytes32 conditionId) external view returns (uint256);
```

权限要求：
- 调用者必须是 `oracle` 地址（`onlyOracle`）

---

## 4. 参数口径
- `conditionId`: 对应市场的条件 ID
- `threshold`: 该市场触发 `TERMINATED` 的阈值，单位与 USDB 一致（6 位小数）

示例：
- 目标阈值 100 USDB -> `threshold = 100000000`
- 目标阈值 1000 USDB -> `threshold = 1000000000`

---

## 5. Ethers.js 调用示例（v5）
```js
const { ethers } = require("ethers");

const RPC = process.env.RPC_URL;
const PK = process.env.PRIVATE_KEY; // 必须是 oracle 钱包
const PRETRADING = "0x546Fb8f3F688CeE0bB31D7a33aC7Da889310550e"; // 按实际替换

const abi = [
  "function setMarketTransferThreshold(bytes32 conditionId, uint256 threshold) external",
  "function marketTransferThresholdByCondition(bytes32 conditionId) view returns (uint256)"
];

async function setThreshold({ conditionId, thresholdUSDB }) {
  const provider = new ethers.providers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(PK, provider);
  const c = new ethers.Contract(PRETRADING, abi, wallet);

  // USDB 6 decimals
  const thresholdRaw = ethers.utils.parseUnits(String(thresholdUSDB), 6);

  const tx = await c.setMarketTransferThreshold(conditionId, thresholdRaw);
  const rc = await tx.wait();

  const onchain = await c.marketTransferThresholdByCondition(conditionId);
  if (!onchain.eq(thresholdRaw)) {
    throw new Error("threshold verify mismatch");
  }

  return {
    txHash: rc.transactionHash,
    conditionId,
    thresholdRaw: thresholdRaw.toString()
  };
}

// 示例
// setThreshold({
//   conditionId: "0x...",
//   thresholdUSDB: "1000"
// }).then(console.log).catch(console.error);
```

---

## 6. 常见失败原因
- `Not oracle`：调用地址不是当前 oracle
- `Market threshold not set`：未先配置该市场阈值就发起 `deposit`
- 参数单位错误：把 USDB 人类单位当成 raw 传入，导致阈值异常

---

## 7. 上线建议
- 市场创建流程中，把“设置阈值 + 读链校验”做成阻塞步骤
- 后端保存三项留档：`conditionId`、`thresholdRaw`、`txHash`
- 前端下注前可读 `marketTransferThresholdByCondition(conditionId)`，若为 0 则提示“市场未初始化完成”
