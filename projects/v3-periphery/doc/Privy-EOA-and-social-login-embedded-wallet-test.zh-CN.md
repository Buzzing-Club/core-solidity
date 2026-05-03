# Privy EOA 登录与社交登录 Embedded Wallet 分配测试文档

## 1. 测试目的

验证前端接入 Privy 后，用户通过以下两类登录方式进入应用时，是否都会获得一个 Privy embedded wallet：

- EOA 登录：例如 MetaMask、Rabby、Coinbase Wallet 等外部钱包登录。
- 社交登录：例如 Google、Twitter/X、Discord、GitHub、Apple 等 OAuth 登录。

本测试重点确认：同一个 Privy user 登录成功后，用户账号下是否存在 `walletClientType === 'privy'` 的 embedded wallet。

> 说明：EOA 登录用户原本会带有一个外部钱包地址；这里要验证的是 Privy 是否额外为该用户创建了一个 embedded wallet，而不是把原 EOA 地址变成 embedded wallet。

## 2. 官方依据

Privy React SDK 支持通过 `config.embeddedWallets.ethereum.createOnLogin` 在登录时自动创建 embedded wallet。

官方文档说明 `createOnLogin` 可选值为：

- `all-users`：为所有登录用户创建 embedded wallet。
- `users-without-wallets`：仅为没有钱包的用户创建 embedded wallet。
- `off`：登录时不自动创建。

如果要确保 EOA 登录用户也获得 embedded wallet，应使用：

```tsx
embeddedWallets: {
  ethereum: {
    createOnLogin: 'all-users',
  },
}
```

参考文档：

- Automatic wallet creation: https://docs.privy.io/basics/react/advanced/automatic-wallet-creation
- User and server signers recipe: https://docs.privy.io/recipes/wallets/user-and-server-signers
- Create a wallet: https://docs.privy.io/wallets/wallets/create/create-a-wallet
- Get user connected wallets: https://docs.privy.io/wallets/wallets/get-a-wallet/get-connected-wallet

## 3. 前端测试配置

请先确认 `PrivyProvider` 中 embedded wallet 自动创建配置为 `all-users`。

示例：

```tsx
import {PrivyProvider} from '@privy-io/react-auth';

export function Providers({children}: {children: React.ReactNode}) {
  return (
    <PrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID!}
      clientId={process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID}
      config={{
        loginMethods: ['wallet', 'google', 'twitter', 'discord'],
        embeddedWallets: {
          ethereum: {
            createOnLogin: 'all-users',
          },
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
```

如果当前使用的是：

```tsx
createOnLogin: 'users-without-wallets'
```

则 EOA 登录用户可能不会额外创建 embedded wallet，因为外部 EOA 也可能被视为用户已有 wallet。为了本次测试，请先切换为 `all-users`。

## 4. 建议增加的临时调试面板

前端可以临时加一个 debug 组件，用于在页面上直接查看 Privy user、linked accounts、connected wallets 和 embedded wallet。

```tsx
import {usePrivy, useWallets} from '@privy-io/react-auth';

export function PrivyWalletDebugPanel() {
  const {ready, authenticated, user, login, logout} = usePrivy();
  const {ready: walletsReady, wallets} = useWallets();

  if (!ready) return <div>Privy loading...</div>;

  const embeddedWallets = wallets.filter(
    (wallet) => wallet.walletClientType === 'privy',
  );

  const externalWallets = wallets.filter(
    (wallet) => wallet.walletClientType !== 'privy',
  );

  return (
    <div style={{padding: 16, border: '1px solid #ddd', fontSize: 12}}>
      <button onClick={login}>Login</button>
      <button onClick={logout} disabled={!authenticated}>
        Logout
      </button>

      <pre>
        {JSON.stringify(
          {
            authenticated,
            walletsReady,
            userId: user?.id,
            userWallet: user?.wallet,
            linkedAccounts: user?.linkedAccounts,
            connectedWallets: wallets.map((wallet) => ({
              address: wallet.address,
              walletClientType: wallet.walletClientType,
              chainType: wallet.chainType,
              connectorType: wallet.connectorType,
            })),
            embeddedWallets: embeddedWallets.map((wallet) => ({
              address: wallet.address,
              walletClientType: wallet.walletClientType,
              chainType: wallet.chainType,
            })),
            externalWallets: externalWallets.map((wallet) => ({
              address: wallet.address,
              walletClientType: wallet.walletClientType,
              chainType: wallet.chainType,
              connectorType: wallet.connectorType,
            })),
          },
          null,
          2,
        )}
      </pre>
    </div>
  );
}
```

## 5. 测试前准备

请准备两类测试账号：

- EOA 测试账号：一个干净的钱包地址，建议使用没有登录过当前 Privy app 的地址。
- 社交测试账号：一个干净的 Google/Twitter/Discord/GitHub 账号，建议使用没有登录过当前 Privy app 的账号。

为了避免旧账号状态干扰，建议在 Privy Dashboard 中清理对应测试用户，或使用全新的钱包/社交账号。

## 6. 测试用例 A：EOA 登录是否获得 embedded wallet

### 操作步骤

1. 打开测试环境页面。
2. 确认当前未登录，必要时点击 logout。
3. 点击 Privy 登录按钮。
4. 选择 Wallet 登录。
5. 使用 MetaMask/Rabby 等 EOA 钱包签名登录。
6. 登录成功后查看 debug 面板。

### 预期结果

登录成功后应看到：

- `authenticated === true`
- `userId` 存在
- `connectedWallets` 中至少有一个外部钱包：
  - `address` 等于登录用的 EOA 地址
  - `walletClientType` 不是 `privy`
- `embeddedWallets` 中至少有一个 embedded wallet：
  - `walletClientType === 'privy'`
  - `address` 存在
  - 该地址通常不同于登录用的外部 EOA 地址

### 判定标准

通过条件：

```ts
embeddedWallets.length >= 1
```

并且 embedded wallet 地址不为空。

## 7. 测试用例 B：社交登录是否获得 embedded wallet

### 操作步骤

1. 登出当前账号。
2. 清理浏览器缓存或使用无痕窗口，避免自动登录干扰。
3. 点击 Privy 登录按钮。
4. 选择 Google/Twitter/Discord/GitHub 等社交登录。
5. 完成 OAuth 授权。
6. 登录成功后查看 debug 面板。

### 预期结果

登录成功后应看到：

- `authenticated === true`
- `userId` 存在
- `linkedAccounts` 中存在对应社交账号信息。
- `embeddedWallets` 中至少有一个 embedded wallet：
  - `walletClientType === 'privy'`
  - `address` 存在

### 判定标准

通过条件：

```ts
embeddedWallets.length >= 1
```

并且 embedded wallet 地址不为空。

## 8. 建议记录的测试结果

| 测试项 | 登录方式 | 测试账号 | 是否登录成功 | 是否有外部 EOA | 是否有 embedded wallet | embedded wallet 地址 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A | Wallet/EOA | 0x... | 是/否 | 是/否 | 是/否 | 0x... | 通过/失败 |
| B | Google/Twitter/Discord | xxx | 是/否 | 是/否 | 是/否 | 0x... | 通过/失败 |

## 9. 常见问题排查

### 9.1 EOA 登录后没有 embedded wallet

优先检查：

- `createOnLogin` 是否配置为 `all-users`。
- 是否使用了 Privy modal 登录流程。
- 是否使用了 whitelabel 或 direct login 方法。

Privy 文档说明，自动创建 embedded wallet 只适用于 Privy modal 登录流程。如果使用 `loginWithCode`、`useLoginWithOAuth` 等 direct login 方法，自动创建可能不会触发，需要登录后手动调用创建 wallet 的方法。

### 9.2 使用 `users-without-wallets` 时 EOA 登录没有 embedded wallet

这是符合预期的可能行为。EOA 登录用户已经有一个外部 wallet，因此不一定会被视为 “without wallets”。如果业务目标是所有用户都有 embedded wallet，请使用 `all-users`。

### 9.3 `useWallets()` 里没有立即出现 embedded wallet

可能是钱包创建和 wallet state 刷新存在异步延迟。建议：

- 等待 `useWallets().ready === true`。
- 登录成功后等待 1-3 秒再观察。
- 刷新页面后再次检查。
- 同时查看 Privy Dashboard 中该 user 的 linked accounts / wallets。

## 10. 最终验收结论

如果在 `createOnLogin: 'all-users'` 配置下：

- EOA 登录用户有一个外部 EOA wallet，并且额外存在一个 `walletClientType === 'privy'` 的 embedded wallet；
- 社交登录用户也存在一个 `walletClientType === 'privy'` 的 embedded wallet；

则可以确认：当前前端配置能够让 EOA 登录和社交登录用户都分配到 Privy embedded wallet。
