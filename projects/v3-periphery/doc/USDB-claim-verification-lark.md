# Buzzing Base 主网 USDB 充值与 CTF Claim 查询方案

本文用于指导本地 AI/Agent 或运营同学确认两类问题：

- 用户是否在链上完成 USDB 兑换/充值，包括通过代充地址完成的充值；
- 用户是否完成某个 CTF 市场的 claim/redeem，以及对应 claim 数量。

完整的 Agent 上下文、合约地址、ABI 片段、事件 topic、CREATE2 代充地址计算方式和脚本骨架见附件 `agent.md`。

## 0. agent.md 使用方法

如果对方使用的是 CC、Codex 或类似的本地 AI 编程助手，推荐这样使用附件：

1. 新建一个空项目目录，例如 `buzzing-query-agent`。
2. 把附件 `agent.md` 放到这个项目目录的根目录下。
3. 在这个项目目录里启动 CC / Codex。
4. 开始对话时先告诉 AI：

```text
请先读取当前项目根目录下的 agent.md，并严格根据里面的 Base 主网地址、RPC、ABI、事件 topic 和查询规则来回答后续链上查询问题。
```

之后用户就可以直接用自然语言提问，例如：

```text
帮我查一下 0x用户地址 在 2026-04-20 晚上 8 点左右有没有充值记录。
```

或者：

```text
帮我确认 0x用户地址 昨天下午是否 redeem 了 0x... 这个 conditionId。
```

注意：`agent.md` 已经是自包含上下文，不要求 AI 访问本仓库目录，也不要求查找本地部署文件或编译产物。对方只需要有可用网络和 Node/ethers 或其他 RPC 查询工具即可。

## 1. USDB 充值/兑换查询方案

主网部署信息：

```text
Network: Base mainnet
ChainId: 8453
USDB: 0x89401d7C5F5Cf4936F10418B9C536f97b0bCf71B
USDC: 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913
ContractFactory: 0x179365245C424453C51F2f34b0AA2C51fC32EaCC
Preferred RPC: https://base.blockpi.network/v1/rpc/10f2757d303cf716e111d3f543ca49904d6e04f4
```

判断一个用户是否完成 USDB 兑换，推荐优先看事件，而不是只看当前余额。

默认查询策略：

1. 优先查这个地址的 USDB token transfer 记录。
2. 不要只查普通交易列表，因为代充场景里用户可能只是 USDB 接收人，并不是交易发起人。
3. 找到候选 USDB token transfer 后，再拉对应交易 receipt，验证同一笔交易里是否有 `USDB.Deposit(to=user, amount)`。
4. 如果一个地址维度数据源不完整，就换另一个 explorer/API 或扩大地址活动时间窗口；当前项目只使用地址维度查询路径。

可用的地址维度 token transfer 查询入口：

```text
https://base.blockscout.com/api/v2/addresses/{user}/token-transfers?type=ERC-20
```

有效证据链：

1. 在目标时间附近找到 `USDB.Transfer(from=0x0, to=user, amount=N)`。
2. 在同一笔交易回执中找到 `USDB.Deposit(to=user, amount=N)`。
3. 如果要判断是否来自代充地址，再看同一笔交易中是否有 `USDC.Transfer(from=helperDepositAddress(user), to=USDB, amount=N)`。

代充地址由 `ContractFactory` 使用 CREATE2 计算：

```text
salt = keccak256(abi.encode(USDC, USDB, eoa))
helperDepositAddress = getCreate2Address(ContractFactory, salt, DepositContractInitCodeHash)
DepositContractInitCodeHash = 0xe7e661ce55199815e7e9aeb58126e0d02604513ee236b8dd5eebdae388fcf318
```

注意：`DepositContract.deposit(to)` 的 `to` 是最终 USDB 接收人，虽然 helper 地址通常按用户 `eoa` 计算，但仍应以 USDB 日志里的 `to` 为准。

## 2. USDB 余额变化查询方案

如果问题是“用户余额是否变化”，而不是“是否完成充值兑换”，可以用余额快照或 Transfer 事件账本。

有 archive RPC 时：

1. 把目标时间转换成前后两个 block。
2. 分别调用 `USDB.balanceOf(user)`，带 `blockTag`。
3. 计算差值，再用该区间内 `USDB.Transfer` 日志解释变化来源。

无 archive RPC 时：

1. 查询用户地址维度的 USDB token transfer 记录。
2. `to=user` 记为增加，`from=user` 记为减少。
3. 输出区间内净变化。

## 3. CTF Claim/Redeem 查询方案

主网 CTF 合约：

```text
CTF / ConditionalTokens: 0x4bC1A3BEE6200790d32Cb28B01eAFf4634B328c3
```

当前合约的 redeem 函数是 `redeemPositions(...)`，成功或尝试后会 emit：

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

默认查询策略：

1. 优先查用户地址维度的交易/活动记录，先得到候选交易，再拉 receipt 解码。
2. 不要直接查询大范围 CTF 合约日志，因为当前用户交易量少，先查地址交易/活动再筛选会更快、更稳定。
3. 如果用户是智能账户、EIP-7702 或 4337 风格账户，普通交易列表可能很少或不完整，要结合 token transfer / activity / internal 记录找到候选交易 hash。
4. 找到候选交易后，拉 receipt，解码其中 CTF 合约的 `PayoutRedemption` 日志，并比较 decoded `conditionId`。
5. 如果一个地址维度数据源不完整，就换另一个 explorer/API 或扩大地址活动时间窗口；当前项目只使用地址维度查询路径。

可用的地址维度查询入口：

```text
https://base.blockscout.com/api/v2/addresses/{user}/transactions
https://base.blockscout.com/api/v2/addresses/{user}/token-transfers?type=ERC-20
https://base.blockscout.com/api/v2/addresses/{user}/token-transfers?type=ERC-1155
```

查询方法：

1. 先从地址维度交易/活动记录筛出候选交易。
2. 对候选交易拉 receipt，并解码 CTF 合约的 `PayoutRedemption`。
3. `redeemer` 是 indexed，但在候选交易 receipt 中也要再次确认。
4. `conditionId` 不是 indexed，不能直接用 topic 过滤，必须解码日志 data 后比较。
5. 匹配到目标 `conditionId` 后，`payout` 就是 claim 数量。USDB 抵押时按 6 位小数格式化。
6. 如果普通交易列表没有结果，继续查该地址的 token transfer / activity / internal 记录，再从这些记录里筛候选 tx hash。

判断口径：

- 找到匹配事件且 `payout > 0`：完成了有正向收益的 claim。
- 找到匹配事件但 `payout = 0`：调用过 redeem，但没有实际 payout。
- 未找到匹配事件：该时间窗口内没有证据，必要时扩大地址活动时间窗口。

## 4. 自然语言用法示例：查充值记录

真实用户通常不会给结构化参数，而是会这样问：

```text
帮我查一下 0x用户地址 在 2026-04-20 晚上 8 点左右有没有充值记录。
```

或者：

```text
看一下这个地址 0x用户地址 昨天下午 3 点半附近有没有 USDB deposit。
```

Agent 应该从自然语言里抽取：

- 用户地址：`0x用户地址`
- 任务类型：查 USDB 充值/兑换
- 时间：用户说的时间
- 查询窗口：用户说“左右/附近”时，默认前后 30 分钟
- 网络：Base mainnet
- RPC：使用本文给出的 Preferred RPC

执行步骤：

1. 先查该地址的 USDB token transfer 记录，按时间和金额筛出候选交易。
2. 对每个候选交易拉 receipt，确认同 tx 存在 `USDB.Deposit(user, amount)` 和 `USDB.Transfer(0x0, user, amount)`。
3. 计算用户 helper deposit address，并检查同 tx 是否有 USDC 从该 helper 地址转入 USDB。
4. 如果一个地址维度数据源不完整，就换另一个 explorer/API 或扩大地址活动时间窗口，不再切到合约日志查询。

查到时的回答示例：

```text
查到了。这个地址在 2026-04-20 20:13:42 UTC 有一笔 USDB 充值。

金额：123.456789 USDB
交易：0x...
区块：...
来源：helper deposit
代充地址：0x...

判断依据：同一笔交易里同时出现了 USDB.Transfer(0x0 -> 用户) 和 USDB.Deposit(to=用户)，并且 USDC 从代充地址转入 USDB 合约。
```

没查到时的回答示例：

```text
这个时间窗口内没有查到该地址的 USDB 充值记录。我查的是 2026-04-20 19:30:00 到 20:30:00 UTC 之间的 Base 区块。

如果用户给的时间只是大概印象，可以把窗口扩大到前后 2 小时再查一次。
```

## 5. 自然语言用法示例：查 conditionId 的 redeem

真实用户可能会这样问：

```text
帮我查一下 0x用户地址 在 2026-04-20 中午附近有没有 claim 这个 conditionId：0x...
```

或者：

```text
确认一下 0x用户地址 昨天下午是否 redeem 了 0x... 这个市场。
```

Agent 应该从自然语言里抽取：

- 用户地址 / redeemer：`0x用户地址`
- conditionId：`0x...`
- 任务类型：查 CTF redeem / claim
- 时间：用户说的时间
- 查询窗口：用户说“左右/附近”时，默认前后 2 小时
- collateralToken：默认 USDB
- parentCollectionId：默认 `0x0000000000000000000000000000000000000000000000000000000000000000`

执行步骤：

1. 先查用户地址维度的交易/活动记录，按时间筛出候选交易。
2. 对候选交易拉 receipt，解码其中 CTF 合约的 `PayoutRedemption`。
3. 比较 decoded `redeemer`、`conditionId`、`collateralToken` 和 `parentCollectionId`。
4. 输出匹配事件的 `payout` 和 `indexSets`。
5. 如果普通交易列表没有结果，继续查该地址的 token transfer / activity / internal 记录，再从这些记录里筛候选 tx hash。

查到时的回答示例：

```text
查到了。这个地址完成过该 conditionId 的 redeem。

交易：0x...
区块：...
时间：...
conditionId：0x...
rawPayout：123456789
payout：123.456789 USDB
indexSets：[...]
```

没查到时的回答示例：

```text
这个时间窗口内没有查到该地址对这个 conditionId 的 redeem 记录。我查的是 2026-04-20 10:00:00 到 14:00:00 UTC 之间的 Base 区块。

注意：PayoutRedemption 的 conditionId 不在 topic 里，我已经按 redeemer 过滤后解码 data 做了二次比较。
```

## 6. 推荐落地方式

短期可直接用附件 `agent.md` 中的 ethers 脚本骨架查询。

长期建议做一个小型 CLI：

```text
check-usdb-deposit --user 0x... --near "2026-04-20T12:00:00Z" --window-minutes 30
check-ctf-redeem --user 0x... --condition-id 0x... --near "2026-04-20T12:00:00Z" --window-minutes 120
```

CLI 输出固定 JSON，便于运营系统、飞书机器人或后台管理页直接消费。
