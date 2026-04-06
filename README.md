# @waffo/pancake

OpenClaw plugin for Pancake payment webhook events. Receives payment, subscription, and refund events from the Pancake platform and triggers the OpenClaw Agent to notify merchants via their connected IM channels (WeChat, Telegram, Lark, Feishu, etc.).

## Install

```bash
openclaw plugins install @waffo/pancake
```

## Setup

1. Install the plugin in OpenClaw
2. Get your webhook URL: `https://your-openclaw-host/pancake/webhook`
3. In Pancake Dashboard → Settings → Webhooks, add the URL and select events
4. Done — the Agent will notify you on your connected channels when events occur

## Networking (Local Deployment)

If OpenClaw runs locally, the plugin automatically handles public URL setup:

1. **Starts a Cloudflare Tunnel** — exposes your local webhook endpoint
2. **Registers with Waffo Relay** — gets a **permanent** webhook URL

On startup you'll see:
```
============================================================
Pancake plugin ready!
Webhook URL: https://relay.waffo.ai/webhook/a1b2c3d4-.../pancake/webhook
This URL is permanent — configure it once in Pancake Dashboard.
============================================================
```

**This URL never changes**, even when OpenClaw restarts. Configure it once in Pancake Dashboard and forget about it.

### How it works

- Plugin generates a unique ID on first install (stored locally)
- Each startup: tunnel gets a new random URL → plugin registers it with Waffo Relay
- Pancake sends webhooks to the relay → relay forwards to your current tunnel
- Relay doesn't store webhook data, only forwards in real-time

### Configuration

To disable tunnel (cloud deployment with stable public URL):
```json
{
  "tunnel": { "enabled": false }
}
```

For production with stable tunnel (requires Cloudflare account):
```json
{
  "tunnel": {
    "type": "named",
    "namedTunnelToken": "your-token-here"
  }
}
```

## Supported Events

| Event | Description |
|-------|-------------|
| `order.completed` | One-time payment succeeded |
| `subscription.activated` | New subscription activated |
| `subscription.payment_succeeded` | Subscription renewal succeeded |
| `subscription.updated` | Subscription details changed |
| `subscription.canceling` | Subscription will cancel at period end |
| `subscription.uncanceled` | Cancellation reversed |
| `subscription.canceled` | Subscription canceled |
| `subscription.past_due` | Subscription payment failed |
| `refund.succeeded` | Refund completed |
| `refund.failed` | Refund failed |

## Agent Tools

- `pancake_query_events` — Query recent payment/subscription/refund events
- `pancake_status` — Plugin status and statistics
- `pancake_retry_event` — Retry a failed event

## Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `mode` | `test` | Pancake environment (`test` or `prod`) |
| `logLevel` | `info` | Log level (`debug`, `info`, `warn`, `error`) |

## Development

```bash
npm install
npm test          # run tests
npm run build     # compile TypeScript
```
