# Base 主网权限清单（精简版）

- 网络: Base Mainnet
- 部署账号（基准地址）: `0x54fa4358330136332430e779BeaAD0CbA1404eAf`

## 表 1：权限待转移列表

### 1.1 owner 待转移（当前 owner = 部署地址）

| 合约 | 合约地址 | 当前 owner | 说明 |
|---|---|---|---|
| FeeRebateDistributor | 0x4F0077104Ca290cC4D26E0877033b8330334081F | 0x54fa4358330136332430e779BeaAD0CbA1404eAf | owner 仍为部署地址，需按运营分工转移 |
| PreTrading | 0x33dCFc0c163B7309422beD6d6BBf73DA946c0284 | 0x54fa4358330136332430e779BeaAD0CbA1404eAf | owner 仍为部署地址，需按运营分工转移 |
| DynamicFeeManager | 0x236e856418ffF886efBA88ba6c79fd6543aaFD24 | 0x54fa4358330136332430e779BeaAD0CbA1404eAf | owner 仍为部署地址，需按运营分工转移 |
| USDB | 0x89401d7C5F5Cf4936F10418B9C536f97b0bCf71B | 0x54fa4358330136332430e779BeaAD0CbA1404eAf | owner 仍为部署地址，需按运营分工转移 |

### 1.2 升级权限待转移（ProxyAdmin.owner = 部署地址）

| ProxyAdmin | 当前 owner | 影响的 Proxy 合约 | 说明 |
|---|---|---|---|
| 0x31275dFd50d1fd1802da26c4D7BE594046E6e41a | 0x54fa4358330136332430e779BeaAD0CbA1404eAf | tBLPProxy / sBLPProxy / tradeManagerProxy / feeAdapterProxy | 升级权限仍由部署地址持有，建议迁移到治理地址（建议多签） |

## 表 2：合约 owner 管理表

| 合约 | 合约地址 | 当前 owner | 是否为部署账号 | owner 转移原因（仅非部署账号） |
|---|---|---|---|---|
| ContractFactory | 0x179365245C424453C51F2f34b0AA2C51fC32EaCC | 0x4b9E4e5543Ce2F93D23566303aAb91ee63CeEF1d | 否 | 代充值业务需要直接管理工厂侧操作，因此转移到代充值钱包 |
| BuzzingSwapFactory | 0x1d470E77e9980Aa342646434c800f439ED3489c1 | 0xd1729ee9687408544e5e91c0220c5b2e69EfF2Ac | 否 | 俱乐部自动发布/阶段转换/市场创建等运营动作需要工厂 owner 权限 |
| FeeAdapterTransparent (Proxy) | 0xE454a76dA1Ec485061488d8c272D2154bf1ddf4F | 0xd1729ee9687408544e5e91c0220c5b2e69EfF2Ac | 否 | 费用分账与收款地址配置由运营钱包管理，便于日常费率治理 |
| FeeRebateDistributor | 0x4F0077104Ca290cC4D26E0877033b8330334081F | 0x54fa4358330136332430e779BeaAD0CbA1404eAf | 是 | - |
| PreTrading | 0x33dCFc0c163B7309422beD6d6BBf73DA946c0284 | 0x54fa4358330136332430e779BeaAD0CbA1404eAf | 是 | - |
| DynamicFeeManager | 0x236e856418ffF886efBA88ba6c79fd6543aaFD24 | 0x54fa4358330136332430e779BeaAD0CbA1404eAf | 是 | - |
| USDB | 0x89401d7C5F5Cf4936F10418B9C536f97b0bCf71B | 0x54fa4358330136332430e779BeaAD0CbA1404eAf | 是 | - |

## 表 3：可升级合约升级权限管理表

| 可升级合约（Proxy） | Proxy 地址 | 当前实现地址 | 升级管理合约（ProxyAdmin） | 升级权限控制地址（ProxyAdmin.owner） |
|---|---|---|---|---|
| tBLPProxy | 0xaaF4C01F8f35e2563C2334802CcE13D09C9256f4 | 0x8AfCeA3a5CB72A27Af5759210525fe7CAE96c99A | 0x31275dFd50d1fd1802da26c4D7BE594046E6e41a | 0x54fa4358330136332430e779BeaAD0CbA1404eAf |
| sBLPProxy | 0x2A149d1b7Cb2cFBd8AF7ea0c816ebaB85bd7Cc45 | 0xEd0aBDdF425c742C97fb8CaF83d2056d8C19A1FA | 0x31275dFd50d1fd1802da26c4D7BE594046E6e41a | 0x54fa4358330136332430e779BeaAD0CbA1404eAf |
| tradeManagerProxy | 0x4a8793AE855AE40A00504D61d2ac4074B5214669 | 0xaE7195bFe99Acd1838C9a26E55e5f68DCAb23d39 | 0x31275dFd50d1fd1802da26c4D7BE594046E6e41a | 0x54fa4358330136332430e779BeaAD0CbA1404eAf |
| feeAdapterProxy | 0xE454a76dA1Ec485061488d8c272D2154bf1ddf4F | 0x7a252f809C12c8566ea67aa03308C4C3c94Bd537 | 0x31275dFd50d1fd1802da26c4D7BE594046E6e41a | 0x54fa4358330136332430e779BeaAD0CbA1404eAf |
