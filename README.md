# @waffo-pancake/openclaw-plugin

Pancake 支付事件 OpenClaw 插件。接收 Pancake 平台的支付、订阅、退款事件，自动通过飞书/Telegram/Slack 等 IM 渠道通知商户。

## 安装 & 配置（一键）

```bash
npx -p @waffo-pancake/openclaw-plugin pancake-setup
```

交互式向导会自动完成：
1. 安装插件到 `~/.openclaw/extensions/pancake`
2. 扫描已有 Agent，选择通知目标（飞书/Telegram/Slack 等）
3. 选择运行模式（test/prod）
4. 写入 `openclaw.json` 配置

### 手动安装

如果需要手动配置，参考以下步骤：

<details>
<summary>展开手动安装步骤</summary>

**安装插件：**
```bash
mkdir -p ~/.openclaw/extensions/pancake && cd ~/.openclaw/extensions/pancake \
  && npm pack @waffo-pancake/openclaw-plugin \
  && tar xzf *.tgz --strip-components=1 && rm *.tgz \
  && npm install --omit=dev
```

**编辑 `~/.openclaw/openclaw.json`：**
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
        "version": "0.3.0"
      }
    }
  }
}
```

`agentId` 决定通知发送到哪个 IM 渠道，格式为 `{channel}-{target}`：

| agentId 示例 | 通知渠道 |
|---|---|
| `feishu-ou_xxx` | 飞书 |
| `telegram-123456` | Telegram |
| `slack-U0xxx` | Slack |
| `discord-9876` | Discord |

在 OpenClaw 管理界面「代理」页面可以找到你的 Agent ID。

</details>

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

## Hermes Agent 兼容

Pancake Webhook 同样支持 [Hermes Agent](https://github.com/NousResearch/hermes-agent)。Hermes 内置 webhook 适配器，无需安装额外插件。

### 配置方式

在 Hermes 的 `config.yaml` 中添加：

```yaml
platforms:
  webhook:
    enabled: true
    extra:
      port: 8644
      routes:
        pancake:
          secret: "INSECURE_NO_AUTH"
          events: []
          prompt: |
            Pancake 支付通知
            📦 事件: {eventType}
            商品: {data.productName}
            金额: {data.amount} {data.currency}
            买家: {data.buyerEmail}
            时间: {timestamp}
            事件ID: {eventId}
            模式: {mode}
          deliver: "telegram"
          deliver_extra:
            chat_id: "你的chat_id"
```

支持的 `deliver` 目标：`telegram`、`discord`、`slack`、`feishu`、`dingtalk`、`weixin`、`wecom`、`matrix`、`email`、`sms` 等 18+ 渠道。

### 配置 Webhook URL

**方式一：Hermes 有公网地址**

直接在 Pancake Dashboard 填写：
```
http://your-server:8644/webhooks/pancake
```

**方式二：Hermes 在本地运行**

使用 Waffo Relay 获取永久 URL：
```bash
# 注册 Hermes 的 webhook 端点到 Relay
curl -X POST https://waffo-pancake-webhook-relay.vercel.app/register \
  -H "Content-Type: application/json" \
  -d '{"pluginId":"your-uuid","targetUrl":"http://localhost:8644/webhooks/pancake"}'
```

然后在 Pancake Dashboard 填写返回的 `webhookUrl`。

## 工作原理

```
Pancake → Waffo Relay (Vercel) → Agent (OpenClaw / Hermes) → IM 通知
```

- **OpenClaw**：插件自动创建 Tunnel + 注册 Relay，零配置
- **Hermes**：使用内置 webhook 适配器，配置 `config.yaml` 即可

## Agent Tools (OpenClaw)

| Tool | 说明 |
|---|---|
| `pancake_query_events` | 查询最近的支付/订阅/退款事件 |
| `pancake_status` | 插件状态和统计信息 |
| `pancake_retry_event` | 手动重试失败的事件 |

## 完整配置项 (OpenClaw)

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
