# 功能名称：Agent 路由 — 用户指定 Webhook 事件推送到哪个 Agent

> **日期：** 2026-04-14
> **状态：** In Progress
> **模板类型：** 简化版（功能优化）

## 变更记录

| 日期 | 变更内容 | 变更原因 |
|------|----------|----------|
| 2026-04-14 | 初始版本 | Agent 触发失败 + 多 Agent 路由需求 |

---

## 1. 业务目标 (The "Why")

- **用户痛点：** 当前 `runEmbeddedPiAgent()` 调用因缺少 workspace path 而失败（`paths[0] must be of type string`）。同时 OpenClaw 支持多 Agent（飞书、微信、TG 等），用户需要指定支付事件推送到哪个 Agent。
- **核心业务价值：** 让用户在安装插件时选择推送目标 Agent，支付事件自动路由到正确的 IM 渠道通知商户。

## 2. 逻辑流与规则 (Logic & Rules)

- **核心逻辑：**
  - 插件配置新增 `agentId` 字段（必填），值为 OpenClaw Agent ID（如 `feishu-ou_55a5fed66adc...`）
  - Agent 的 workspace 路径通过 `agentId` 推导：`~/.openclaw/workspace-{agentId}`
  - 触发 Agent 时传入 workspace path + prompt

- **隐含逻辑：**
  - 如果 `agentId` 未配置，插件启动时打印警告，webhook 仍正常接收但 Agent 不触发
  - 如果指定的 Agent workspace 不存在，记录错误日志，event status 标记为 `agent_failed`

- **权限/约束：**
  - agentId 必须对应一个已存在的 OpenClaw Agent
  - 一个插件实例只对应一个 Agent（不支持按事件类型路由到不同 Agent，这是未来扩展）

## 3. 数据模型 (Data & State)

- **关键字段：**

| 字段名 | 类型 | 含义 |
|--------|------|------|
| config.agentId | string | 目标 Agent ID，如 `feishu-ou_55a5fed66adc...` |

- **状态变更：**

`event received` → `agent trigger with agentId` → `agent_completed / agent_failed`

## 4. 边界情况与异常处理 (Edge Cases)

- `agentId` 为空：插件正常运行，但跳过 Agent 触发，日志打印 `"agentId not configured, skipping agent trigger"`
- Agent workspace 目录不存在：返回 `agent_failed`，记录错误 `"workspace not found for agent {agentId}"`
- `runEmbeddedPiAgent` 调用失败：现有错误处理已覆盖

## 5. 关键决策记录 (ADR)

| 决策点 | 选择 | 原因 | 排除方案 |
|--------|------|------|----------|
| Agent 路由粒度 | 单 Agent（配置一个 agentId） | MVP 简单够用，一个店铺对应一个通知渠道 | 按事件类型路由到多个 Agent（复杂度高，未来扩展） |
| workspace 获取方式 | 从 agentId 推导路径 | 截图确认 OpenClaw 的 workspace 路径规则为 `~/.openclaw/workspace-{agentId}` | 通过 OpenClaw API 查询（API 不确定是否存在） |

- **技术债：** 未来可考虑通过 OpenClaw 插件 API 获取 Agent 列表，让用户从下拉框选择

---
