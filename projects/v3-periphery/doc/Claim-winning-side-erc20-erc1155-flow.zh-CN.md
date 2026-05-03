# 结算页 Claim 流程（仅获胜侧，含 ERC20 + ERC1155）

## 1. 目标
在结算界面仅针对**获胜一侧**做展示与执行：
- 查询用户在获胜侧的 `ERC20` 余额与 `ERC1155` 余额。
- 若存在余额，Claim 窗口保持 `claim` 状态，显示数额与可处理余额一致。
- 执行时区分：
  - 获胜侧 `ERC20` 有余额：先 `unwrap` 再 `redeem`
  - 仅获胜侧 `ERC1155` 有余额：直接 `redeem`

失败侧不参与本次修复逻辑。

## 2. 后端给前端的数据
- `outcome`: `yes | no`（已结算结果）
- `ctf`: Conditional Tokens（ERC1155）合约地址
- `yesPositionId`: YES positionId（uint256 字符串）
- `noPositionId`: NO positionId（uint256 字符串）
- `erc20addr`: YES 对应 ERC20 地址
- `notoken_address`: NO 对应 ERC20 地址
- `positionDecimals`: 仓位显示精度（建议后端直接给）
- `collateralToken`
- `parentCollectionId`
- `conditionId`
- `wrapped1155Factory`（或对应 unwrap 入口合约地址）

## 3. 获胜侧映射
- `outcome === "yes"`：
  - `winningErc20 = erc20addr`
  - `winningPositionId = yesPositionId`
  - `winningIndexSet = 1`
- `outcome === "no"`：
  - `winningErc20 = notoken_address`
  - `winningPositionId = noPositionId`
  - `winningIndexSet = 2`

## 4. 余额查询规则（仅获胜侧）
并行查询：
- `winningErc20.balanceOf(user)`
- `ctf.balanceOf(user, winningPositionId)`

展示口径：
- `displayClaimableRaw = erc20BalRaw + erc1155BalRaw`
- `displayClaimable = formatUnits(displayClaimableRaw, positionDecimals)`

窗口状态：
- `displayClaimableRaw > 0`：保持 `claim` 状态
- `displayClaimableRaw == 0`：显示无可领取/已领取

## 5. 执行路径
### 5.1 `erc20BalRaw > 0`
1. 先执行 `unwrap`，把获胜侧 ERC20 转回对应 ERC1155。  
2. `unwrap` 成功后重新读取 `ctf.balanceOf(user, winningPositionId)`。  
3. 若余额 `> 0`，执行 `redeemPositions(...)`。

### 5.2 `erc20BalRaw == 0 && erc1155BalRaw > 0`
直接执行 `redeemPositions(...)`。

### 5.3 两者都为 0
不发送交易。

## 6. 推荐伪代码（ethers）
```ts
import { BigNumber, Contract, providers, utils } from "ethers";

const ERC20_ABI = ["function balanceOf(address) view returns (uint256)"];
const CTF_ABI = [
  "function balanceOf(address account, uint256 id) view returns (uint256)",
  "function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] indexSets) external"
];
// 按你们实际封装替换 unwrap ABI
const WRAPPED1155_ABI = [
  "function unwrap(address token, uint256 amount, address to) external"
];

type ClaimInput = {
  provider: providers.Web3Provider;
  signerAddress: string;
  outcome: "yes" | "no";
  ctf: string;
  wrapped1155: string;
  yesPositionId: string;
  noPositionId: string;
  erc20addr: string;
  notoken_address: string;
  positionDecimals: number;
  collateralToken: string;
  parentCollectionId: string;
  conditionId: string;
};

export async function queryWinningClaimable(input: ClaimInput) {
  const user = input.signerAddress;
  const winningErc20 = input.outcome === "yes" ? input.erc20addr : input.notoken_address;
  const winningPositionId = input.outcome === "yes" ? input.yesPositionId : input.noPositionId;

  const erc20 = new Contract(winningErc20, ERC20_ABI, input.provider);
  const ctf = new Contract(input.ctf, CTF_ABI, input.provider);

  const [erc20BalRaw, erc1155BalRaw] = await Promise.all([
    erc20.balanceOf(user) as Promise<BigNumber>,
    ctf.balanceOf(user, winningPositionId) as Promise<BigNumber>,
  ]);

  const displayClaimableRaw = erc20BalRaw.add(erc1155BalRaw);
  const displayClaimable = utils.formatUnits(displayClaimableRaw, input.positionDecimals);

  return {
    winningErc20,
    winningPositionId,
    erc20BalRaw,
    erc1155BalRaw,
    displayClaimableRaw,
    displayClaimable,
    canClaim: displayClaimableRaw.gt(0),
  };
}

export async function claimWinningSide(input: ClaimInput) {
  const signer = input.provider.getSigner();
  const user = input.signerAddress;
  const winningErc20 = input.outcome === "yes" ? input.erc20addr : input.notoken_address;
  const winningPositionId = input.outcome === "yes" ? input.yesPositionId : input.noPositionId;
  const winningIndexSet = input.outcome === "yes" ? 1 : 2;

  const erc20 = new Contract(winningErc20, ERC20_ABI, signer);
  const ctf = new Contract(input.ctf, CTF_ABI, signer);
  const wrapped = new Contract(input.wrapped1155, WRAPPED1155_ABI, signer);

  const [erc20BalRaw, erc1155BalRaw] = await Promise.all([
    erc20.balanceOf(user) as Promise<BigNumber>,
    ctf.balanceOf(user, winningPositionId) as Promise<BigNumber>,
  ]);

  // 路径 A: 有 ERC20 -> 先 unwrap 再 redeem
  if (erc20BalRaw.gt(0)) {
    const tx1 = await wrapped.unwrap(winningErc20, erc20BalRaw, user);
    await tx1.wait();

    const erc1155After = await ctf.balanceOf(user, winningPositionId) as BigNumber;
    if (erc1155After.gt(0)) {
      const tx2 = await ctf.redeemPositions(
        input.collateralToken,
        input.parentCollectionId,
        input.conditionId,
        [winningIndexSet]
      );
      await tx2.wait();
    }
    return;
  }

  // 路径 B: 仅 ERC1155 -> 直接 redeem
  if (erc1155BalRaw.gt(0)) {
    const tx = await ctf.redeemPositions(
      input.collateralToken,
      input.parentCollectionId,
      input.conditionId,
      [winningIndexSet]
    );
    await tx.wait();
  }
}
```

## 7. 实现注意事项
- 只按获胜侧执行，不处理失败侧。
- 建议点击 Claim 后按钮置灰，避免重复点击导致并发交易。
- `unwrap` 后务必重新读取一次 ERC1155 余额，再决定 redeem。
- `displayClaimable` 仅用于展示；交易使用原始 `raw` 值。
- 若 `redeemPositions` 参数采用你们自定义封装，按实际 ABI 替换示例。

