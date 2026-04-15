# @waffo-pancake/openclaw-plugin

Pancake 支付事件 OpenClaw 插件。接收 Pancake 平台的支付、订阅、退款事件，自动通过飞书/Telegram/Slack 等 IM 渠道通知商户。

## 安装

```bash
mkdir -p ~/.openclaw/extensions/pancake && cd ~/.openclaw/extensions/pancake \
  && npm pack @waffo-pancake/openclaw-plugin \
  && tar xzf *.tgz --strip-components=1 && rm *.tgz \
  && npm install --omit=dev
```

## 配置

编辑 `~/.openclaw/openclaw.json`，在 `plugins` 中添加：

```json
{
  "plugins": {
    "allow": ["pancake"],
    "entries": {
      "pancake": {
        "enabled": true,
        "config": {
          "mode": "test",
          "agentId": "feishu-ou_xxxxxxxxxxxxxxxx"
        }
      }
    },
    "installs": {
      "pancake": {
        "source": "local",
        "spec": "@waffo-pancake/openclaw-plugin",
        "installPath": "~/.openclaw/extensions/pancake",
        "version": "0.2.0"
      }
    }
  }
}
```

### agentId 配置

`agentId` 决定通知发送到哪个 IM 渠道，格式为 `{channel}-{target}`：

| agentId 示例 | 通知渠道 |
|---|---|
| `feishu-ou_xxx` | 飞书 |
| `telegram-123456` | Telegram |
| `slack-U0xxx` | Slack |
| `discord-9876` | Discord |

在 OpenClaw 管理界面「代理」页面可以找到你的 Agent ID。

## 获取 Webhook URL

重启 OpenClaw 后，启动日志会输出永久 Webhook URL：

```
[pancake] ============================================================
[pancake] Pancake plugin ready!
[pancake] Webhook URL: https://waffo-pancake-webhook-relay.vercel.app/webhook/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
[pancake] This URL is permanent — configure it once in Pancake Dashboard.
[pancake] ============================================================
```

## 配置 Pancake Dashboard

1. 登录 [Pancake Dashboard](https://www.waffo.ai)
2. 进入 **Settings → Webhooks**
3. 粘贴上一步获取的 Webhook URL
4. 勾选要接收的事件类型
5. 保存

配置一次，永不过期。插件重启后 URL 不会变。

## 通知效果

收到支付事件后，IM 渠道自动收到通知：

```
Pancake 支付通知
📦 订单完成 (支付成功)
商品: Pancake Pro Plan
金额: 49.00 USD
买家: customer@example.com
时间: 2026-04-14T12:30:00Z
事件ID: PAY_xxx
```

## 支持的事件

| 事件 | 说明 |
|---|---|
| `order.completed` | 订单支付成功 |
| `subscription.activated` | 新订阅激活 |
| `subscription.payment_succeeded` | 订阅续费成功 |
| `subscription.updated` | 订阅信息变更 |
| `subscription.canceling` | 订阅取消中（到期后失效） |
| `subscription.uncanceled` | 取消已撤回 |
| `subscription.canceled` | 订阅已取消 |
| `subscription.past_due` | 订阅欠费（续费失败） |
| `refund.succeeded` | 退款成功 |
| `refund.failed` | 退款失败 |

## 工作原理

```
Pancake → Waffo Relay (Vercel) → Cloudflare Tunnel → OpenClaw 插件 → IM 通知
```

- 插件启动时自动创建 Cloudflare Tunnel（免费，无需账号）
- Tunnel URL 注册到 Waffo Relay 服务，获得永久 Webhook URL
- Pancake 发送 Webhook → Relay 实时转发 → 插件处理 → 通过 Gateway 发送 IM 通知

## Agent Tools

| Tool | 说明 |
|---|---|
| `pancake_query_events` | 查询最近的支付/订阅/退款事件 |
| `pancake_status` | 插件状态和统计信息 |
| `pancake_retry_event` | 手动重试失败的事件 |

## 完整配置项

| 选项 | 默认值 | 说明 |
|---|---|---|
| `mode` | `test` | Pancake 环境（`test` 或 `prod`） |
| `agentId` | — | 通知目标 Agent ID（必填） |
| `logLevel` | `info` | 日志级别（`debug`/`info`/`warn`/`error`） |
| `tunnel.enabled` | `true` | 是否自动启动 Cloudflare Tunnel |
| `tunnel.type` | `quick` | Tunnel 类型（`quick` 免费随机 / `named` 稳定域名） |
| `tunnel.namedTunnelToken` | — | Named Tunnel token（type=named 时必填） |
| `tunnel.port` | `18789` | OpenClaw Gateway 端口 |

## 开发

```bash
npm install
npm test          # 运行测试
npm run build     # 编译 TypeScript
npm run dev       # watch 模式
```
