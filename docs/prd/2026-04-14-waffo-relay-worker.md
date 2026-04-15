# PRD: Waffo Webhook Relay Service

> **状态：** 开发中
> **创建日期：** 2026-04-14
> **最后更新：** 2026-04-14
> **模板类型：** 详细版（新功能）

## 变更记录

| 日期 | 变更内容 | 变更原因 | 发起方 |
|------|----------|----------|--------|
| 2026-04-14 | 初始版本 | 新建 | 开发 |
| 2026-04-14 | 技术方案从 Cloudflare Workers 改为 Vercel | 统一基础设施到 Vercel 平台 | 用户 |

---

## 1. 背景与动机

Pancake OpenClaw 插件运行在用户本地机器上，通过 Cloudflare Tunnel 暴露本地端口接收 Webhook。但 Tunnel 每次重启会生成新的随机 URL（如 `xxx.trycloudflare.com`），导致商户需要反复去 Pancake Dashboard 更新 Webhook 地址。

**Waffo Relay** 是一个部署在 Vercel 上的轻量代理服务，为每个插件实例提供一个**永久不变的 Webhook URL**（`https://relay.waffo.ai/webhook/{pluginId}`）。插件启动时向 Relay 注册当前的 Tunnel URL，Relay 收到 Pancake Webhook 后实时转发到该地址。

客户端代码已在插件中实现（`src/relay/client.ts`），现有仓库 `waffo-com/waffo-pancake-webhook-relay` 有 Cloudflare Workers 版本的实现，需要改写为 Vercel Serverless Functions 并部署。

## 2. 目标

- 目标 1：部署到 Vercel，提供永久 Webhook URL，消除 Tunnel URL 变化问题
- 目标 2：零成本运行 — Vercel Hobby 免费计划 + Vercel KV 免费额度
- 目标 3：与现有客户端代码 100% 兼容，无需修改插件侧代码
- 目标 4：统一基础设施 — 所有服务均部署在 Vercel 上

## 3. 用户故事

- 作为 **Pancake 商户**，我希望 Webhook URL 配一次就永远不变，以便 不用每次重启插件都去 Dashboard 改地址
- 作为 **插件开发者**，我希望 Relay 自动处理 URL 映射，以便 用户无感知地使用 Quick Tunnel
- 作为 **运维**，我希望 Relay 零成本免运维，以便 不增加基础设施负担

## 4. 功能规格

### 4.1 核心流程

```
插件启动:
  插件 → POST /register { pluginId, targetUrl } → Worker 存储映射到 KV

Pancake 发送 Webhook:
  Pancake → POST /webhook/{pluginId} → Worker 查 KV 找到 targetUrl → 转发完整请求 → 返回目标响应
```

### 4.2 详细规则

1. **注册（Register）**
   - 同一 pluginId 重复注册时，覆盖旧的 targetUrl（最新的 Tunnel URL 生效）
   - pluginId 和 targetUrl 均不可为空，否则返回 400
   - targetUrl 必须是合法的 HTTPS URL

2. **转发（Forward）**
   - 转发时保留原始请求的全部 Headers（包括 `X-Waffo-Signature`、`Content-Type` 等）
   - 转发时保留原始请求 Body（原样透传，不解析不修改）
   - 添加 `X-Forwarded-By: waffo-relay` Header 标识经过了 Relay
   - 转发超时 25 秒（Cloudflare Workers CPU 时限为 30 秒，留 5 秒余量）

3. **健康检查**
   - `GET /` 返回服务状态，用于监控

### 4.3 API 接口说明

无 UI，纯 API 服务。详见第 6 节。

## 5. 数据模型

使用 Vercel KV（Upstash Redis）存储

| Key | Value | TTL | 说明 |
|-----|-------|-----|------|
| `plugin:{pluginId}` | `{ targetUrl, registeredAt, lastSeen }` | 30 天 | pluginId → 转发目标 URL 映射 |

- 每次注册或成功转发时刷新 TTL（保持活跃的插件不会过期）
- Value 为 JSON 字符串

## 6. API 设计

### 6.1 POST /register — 注册/更新转发目标

**Request:**
```
POST /register
Content-Type: application/json

{
  "pluginId": "uuid-xxxx-xxxx",
  "targetUrl": "https://abc.trycloudflare.com"
}
```

**Response (成功):**
```
200 OK
Content-Type: application/json

{
  "ok": true,
  "webhookUrl": "https://relay.waffo.ai/webhook/uuid-xxxx-xxxx"
}
```

**Response (参数错误):**
```
400 Bad Request
Content-Type: application/json

{
  "ok": false,
  "error": "pluginId and targetUrl are required"
}
```

### 6.2 POST /webhook/{pluginId} — 接收并转发 Webhook

**Request:** Pancake 原始 Webhook 请求（原样接收）

**Response (成功):** 返回目标服务的响应状态码和 Body

**Response (pluginId 未注册):**
```
404 Not Found
Content-Type: application/json

{
  "ok": false,
  "error": "plugin not registered"
}
```

**Response (转发失败):**
```
502 Bad Gateway
Content-Type: application/json

{
  "ok": false,
  "error": "failed to forward webhook: <reason>"
}
```

### 6.3 GET / — 健康检查

**Response:**
```
200 OK
Content-Type: application/json

{
  "service": "waffo-relay",
  "status": "ok"
}
```

## 7. 技术方案

### 7.1 技术选型

| 项 | 选择 | 原因 |
|----|------|------|
| 运行时 | Vercel Serverless Functions | 统一基础设施，团队熟悉 |
| 存储 | Vercel KV（Upstash Redis） | 免费 10000 命令/天，与 Vercel 深度集成 |
| 域名 | `relay.waffo.ai` | 通过 Vercel Custom Domain 配置 |
| 开发工具 | Vercel CLI | 部署 + 环境变量管理 |
| 语言 | TypeScript | 与插件一致 |

### 7.2 项目结构

使用现有仓库 `waffo-com/waffo-pancake-webhook-relay`，改造为 Vercel 项目：

```
waffo-pancake-webhook-relay/
├── api/
│   ├── register.ts              # POST /api/register
│   ├── webhook/[pluginId].ts    # POST /api/webhook/{pluginId}
│   └── health/[pluginId].ts     # GET /api/health/{pluginId}
├── lib/
│   ├── cors.ts                  # CORS 响应工具
│   └── kv.ts                    # Vercel KV 操作封装
├── tests/
│   └── worker.test.ts           # 单元测试（vitest）
├── vercel.json                  # 路由 rewrites（去掉 /api 前缀）
├── package.json
└── tsconfig.json
```

### 7.3 路由映射（vercel.json rewrites）

插件客户端调用的是 `/register`、`/webhook/{pluginId}`，而 Vercel 函数位于 `api/` 目录下。通过 rewrites 保持 API 契约不变：

```json
{
  "rewrites": [
    { "source": "/register", "destination": "/api/register" },
    { "source": "/webhook/:pluginId", "destination": "/api/webhook/:pluginId" },
    { "source": "/health/:pluginId", "destination": "/api/health/:pluginId" }
  ]
}
```

### 7.4 部署流程

```bash
vercel link                      # 关联 Vercel 项目
vercel env pull                  # 拉取 KV 环境变量
vercel deploy --prod             # 部署到生产
# 在 Vercel Dashboard 绑定自定义域名 relay.waffo.ai
```

### 7.5 免费额度评估

| 资源 | 免费额度（Hobby） | 预估用量（100 个商户） | 结论 |
|------|-------------------|----------------------|------|
| Serverless 函数调用 | 无硬性日限额 | ~1000 次/天 | 安全 |
| Vercel KV 命令 | 10000 次/天 | ~1000 次/天 | 远低于限额 |
| KV 存储 | 256 MB | ~几 KB | 无风险 |

## 8. 边界条件与异常处理

- **pluginId 不存在**：返回 404，Pancake 的 QStash 会触发重试，等插件注册后下次重试可成功
- **目标服务不可达**：返回 502，同样触发 Pancake 重试机制
- **请求体过大**：Vercel Serverless 限制 4.5MB，Pancake Webhook payload 通常 < 10KB，无风险
- **冷启动**：Vercel Serverless 有冷启动延迟（~200ms），但 Pancake 有重试机制，不影响可靠性
- **并发注册**：同一 pluginId 并发注册时，KV 最后写入者胜出，符合预期（总是最新的 Tunnel URL 生效）

## 9. 测试要点

- [ ] POST /register 成功注册返回 200 + webhookUrl
- [ ] POST /register 缺少参数返回 400
- [ ] POST /register 重复注册覆盖旧值
- [ ] POST /webhook/{pluginId} 已注册时成功转发
- [ ] POST /webhook/{pluginId} 未注册时返回 404
- [ ] POST /webhook/{pluginId} 转发失败时返回 502
- [ ] 转发保留原始 Headers 和 Body
- [ ] 转发添加 X-Forwarded-By header
- [ ] GET / 返回健康状态
- [ ] 端到端：客户端注册 → 发送 webhook → 目标收到

## 10. 未来扩展

- **离线事件排队**：插件不可达时将 Webhook 存入队列，插件上线后推送（已从 MVP 移除，依赖 Pancake 重试机制）
- **认证机制**：注册接口增加 API Key 验证，防止恶意注册
- **监控面板**：转发成功率、延迟等指标
- **多区域路由**：根据插件所在区域选择最近的边缘节点转发

---
