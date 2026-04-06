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

## Tunnel (Local Deployment)

If OpenClaw runs locally, the plugin **automatically starts a Cloudflare Tunnel** so Pancake can reach your webhook. No Cloudflare account needed.

On startup you'll see:
```
✓ Pancake plugin ready!
✓ Webhook URL: https://abc-xyz.trycloudflare.com/pancake/webhook
📋 Copy this URL to Pancake Dashboard → Settings → Webhooks
```

**Quick Tunnel** (default): Free, no account needed. URL changes on restart — suitable for development and testing.

**Named Tunnel** (production): Stable custom domain. Requires a free Cloudflare account and tunnel token.

```json
{
  "tunnel": {
    "type": "named",
    "namedTunnelToken": "your-token-here"
  }
}
```

To disable the tunnel (cloud deployment):
```json
{
  "tunnel": { "enabled": false }
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
