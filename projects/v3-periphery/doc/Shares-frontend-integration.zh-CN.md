# Shares 字段前端接入说明

## 背景

调用 `link` 接口时，接口会返回以下字段：

- `shares`
- `yesFeeRebate`
- `noFeeRebate`

目前前端已接入 `yesFeeRebate` / `noFeeRebate`。本文档用于说明 `shares` 字段的作用及接入方式。

## shares 字段作用

`shares` 用于在**断点状态（Breakpoint State）**下提供用户可卖出的 token 数量。

正常情况下，前端可以直接从合约读取用户 token 数量（即可卖数量）。  
但在某些情况下（例如流动性已成功撤出），合约中的相关数据会被清除，前端无法继续从链上读取用户 token 数量。

此时后端会通过 `link` 接口返回 `shares`，作为用户当前可卖出的 token 数量。

结论：

- 非断点状态：token 数量从合约读取
- 断点状态：token 数量使用接口返回的 `shares`

## 状态处理逻辑

### 1. 非断点状态

在正常状态下，用户 token 数量可从合约读取，`shares` 不需要使用。

流程：

前端 -> 读取合约 -> 获取用户 token balance -> 作为 `sellAmount`

### 2. 断点状态

在断点状态下，合约相关数据已被清除，无法读取用户 token 数量。

此时 `shares` 表示用户当前可卖出的 token 数量。

流程：

前端 -> 调用 `link` 接口 -> 接口返回 `shares` -> 使用 `shares` 作为 `sellAmount`

## 前端实现规则

前端需先判断是否处于断点状态，再决定 `sellAmount` 来源。

规则：

- 如果是断点状态：`sellAmount = shares`
- 如果不是断点状态：`sellAmount = 合约读取的 token 数量`

## 授权检查（Allowance Check）

在断点状态下，合约中的 token 数据已不存在，授权检查必须基于 `shares`。

规则：

- 检查 `allowance >= shares`

## Sell 交易数量规则

执行 Sell 时：

- 非断点状态：`sellAmount` 使用合约读取值
- 断点状态：`sellAmount` 使用接口返回的 `shares`

## 总结

`sellAmount` 来源：

- 非断点状态：从合约读取 token 数量
- 断点状态：使用接口返回的 `shares`

核心原则：

当合约数据无法读取时，`shares` 是唯一可信的 `sellAmount` 来源。

