# PRD: Hermes 安装向导文案英文化

> **状态：** 已完成
> **创建日期：** 2026-04-21
> **最后更新：** 2026-04-21
> **模板类型：** 简化版（优化/迭代）

## 变更记录

| 日期 | 变更内容 | 变更原因 | 发起方 |
|------|----------|----------|--------|
| 2026-04-21 | 创建 PRD | 面向海外用户，当前向导是中文输出，需要切换到高级感、SaaS 行业标准英文文案 | huiling.mo |
| 2026-04-21 | PRD 确认，状态切换为开发中 | 用户回复「确认」 | huiling.mo |
| 2026-04-21 | 扩展范围：修复 `findCloudflaredBin` 路径 bug | Smoke test 在 Mac Mini 跑时暴露既有 bug：`findCloudflaredBin()` 检查的是 `~/.hermes/pancake-cloudflared/bin/cloudflared`，但 `npm install cloudflared` 实际产出是 `~/.hermes/pancake-cloudflared/node_modules/cloudflared/bin/cloudflared`，导致 tunnel 启动失败、smoke test 无法走完全流程 | huiling.mo |
| 2026-04-21 | Prompt 从纯模板改为「上下文 + 指令」 | 飞书真实效果显示 Hermes 的 `--prompt` 参数是喂给 LLM 的上下文（LLM 基于此自主生成消息），不是字段替换模板。当前模板信息较扁平，需要：①强制展示商品/价格/邮箱；②按事件类型给个人开发者不同情绪价值（庆祝销售、鼓励续订、温和关怀流失） | huiling.mo |
| 2026-04-21 | Prompt 引导 LLM 输出 Markdown → 自动渲染为飞书 post 富文本卡片 | 实际投递后飞书消息是纯文本，层次感不足。调研 Hermes `feishu.py` 发现 `_build_outbound_payload` 会用正则 `_MARKDOWN_HINT_RE` 检测 markdown 特征（`**bold**` / `---` / `` `code` `` 等），命中则自动用 `msg_type=post` + `tag=md` 发送富文本 ——  零代码改动即可获得粗体产品名 / 分隔线 / inline code event ID 的卡片观感。Interactive card 方案成本高且需要 fork Hermes，本次不做（见本条 §7） | huiling.mo |
| 2026-04-21 | Prompt 结构从「横排混合」改为「字段分行」 | 第一版 markdown 输出横排塞太多字段，视觉散乱。用户要求：商品名称／金额／用户邮箱 各占一行，然后一句鼓励，最后订单号+时间。标签名随 product name 语言自适应（中文产品→中文 label，英文产品→英文 label） | huiling.mo |
| 2026-04-21 | Prompt 结构：订单号与时间分两行 | 视觉还是挤 | huiling.mo |
| 2026-04-21 | Prompt 增加 H1 标题 + 升级鼓励话风格 | 缺视觉重心（无 h1 标题）；鼓励话陷入"加油/值得/真棒"等空洞套路。用户要求：①顶部加事件标题（短、punchy、按事件类型变化），②鼓励话"有趣"——具象化生活场景（"够你点个烧烤了"）、调侃式观察（"又一个陌生人为你的代码付费"）、适度幽默，明确禁用通用加油话 | huiling.mo |
| 2026-04-21 | 鼓励话：首选「结合商品用途」 | 用户提出之前的"又一个人选择用你的模板管理人生"特别好——因为它把商品（模板）的实际用途（管理人生）融入文案。生活场景/调侃观察是 fallback，product-aware 是首选 | huiling.mo |

---

## 1. 背景

`bin/hermes-setup.mjs` 是 `pancake-hermes-setup` CLI 的入口。当前所有面向用户的 `console.log` / `ask` 文案是中文，但这个包 `@waffo/openclaw-plugin` 是发布到 npm 的公共包，主要目标用户是海外开发者。

参考 Stripe CLI、Vercel CLI、`gh` 等行业标杆的 CLI 文案风格：简洁、动作驱动、小写状态词、不堆砌语气词。

## 2. 目标

- `bin/hermes-setup.mjs` 所有用户可见输出（prompts、status、errors、completion message）切换为英文
- 文案风格对齐 Stripe / Vercel CLI 的产品级水准
- 保留现有 emoji（🥞 🎉 ✅ ❌ ⚠️ 📬 📝 🔄 📦 🚇 🔗 🛑 📥 🔧），它们是视觉锚点
- 同步更新 Hermes 投递时的 `--prompt` 模板（即用户最终在 IM 收到的消息模板）为英文版

## 3. 变更范围

### 3.1 必改文件

| 文件 | 位置 | 说明 |
|------|------|------|
| `bin/hermes-setup.mjs` | 全文 console.log / readline question / throw message | 用户可见字符串全部英文化 |

### 3.2 文案映射（关键项）

| 场景 | 当前中文 | 英文提案 |
|------|----------|----------|
| 主标题 | `🥞 Pancake × Hermes — 安装向导` | `🥞 Pancake × Hermes · Setup` |
| 找不到 Hermes | `❌ 未找到 Hermes 安装 (~/.hermes/hermes-agent/)` | `❌ Hermes installation not found at ~/.hermes/hermes-agent/` |
| 引导安装 Hermes | `请先安装 Hermes: <URL>` | `Install Hermes first: <URL>` |
| 版本过旧 | `⚠️ Hermes 版本过旧，不支持多平台 webhook 投递。` | `⚠️  Your Hermes build predates multi-platform webhook delivery.` |
| 升级确认 | `是否自动升级 Hermes 到最新版本？[Y/n]: ` | `Upgrade Hermes to the latest version? [Y/n]: ` |
| 升级中 | `📦 升级 Hermes...` | `📦 Upgrading Hermes…` |
| 升级成功 | `✅ Hermes 已升级` | `✅ Hermes upgraded.` |
| 放弃升级 | `取消安装。需要 2026-04-10 之后的 Hermes 版本。` | `Aborted. Hermes builds from 2026-04-10 or later are required.` |
| 检测失败 | `⚠️ 无法检查 Hermes 版本: …` | `⚠️  Couldn't verify Hermes version: …` |
| 选择渠道 | `📬 选择通知投递渠道：` | `📬 Choose a delivery channel:` |
| 输入序号 | `请输入序号 (1-N): ` | `Enter a number (1–N): ` |
| 无效选择 | `❌ 无效选择` | `❌ Invalid selection.` |
| 不支持 | `❌ 不支持的平台: X` / `支持: …` | `❌ Unsupported platform: X` / `   Available: …` |
| 已选 | `✅ 已选择: X` | `✅ Selected: X` |
| chat_id 提示（feishu） | `(飞书: oc_xxx 群聊 ID 或用户 open_id)` | `(Lark / Feishu: oc_xxx group ID or user open_id)` |
| chat_id 提示（telegram） | `(Telegram: 数字 chat_id)` | `(Telegram: numeric chat_id)` |
| chat_id 提示（slack） | `(Slack: C0xxxxx channel ID)` | `(Slack: C0xxxxx channel ID)` |
| chat_id 输入 | `请输入目标 chat_id …: ` | `Target chat_id …: ` |
| chat_id 为空 | `❌ chat_id 不能为空` | `❌ chat_id cannot be empty.` |
| 订阅中 | `📝 订阅 pancake webhook 路由...` | `📝 Subscribing the pancake webhook route…` |
| 订阅成功 | `✅ Webhook 路由已订阅` | `✅ Webhook route subscribed.` |
| 订阅失败 | `❌ 订阅失败: …` | `❌ Subscription failed: …` |
| 启动 tunnel | `🚇 启动 Cloudflare Tunnel...` | `🚇 Starting Cloudflare Tunnel…` |
| tunnel 失败 | `❌ Tunnel 启动失败，请手动运行：…` | `❌ Tunnel failed to start. Run manually: …` |
| tunnel 成功 | `✅ Tunnel 已启动: URL` | `✅ Tunnel up: URL` |
| cloudflared 缺失 | `📥 未找到 cloudflared，正在安装...` | `📥 cloudflared not found — installing…` |
| cloudflared 装好 | `✅ cloudflared 已安装` | `✅ cloudflared installed.` |
| cloudflared 失败 | `❌ cloudflared 安装失败: …` | `❌ cloudflared install failed: …` |
| 注册 relay | `🔗 注册到 Waffo Relay...` | `🔗 Registering with Waffo Relay…` |
| 注册失败 | `❌ Relay 注册失败` | `❌ Relay registration failed.` |
| 注册成功 | `✅ Relay 已注册` | `✅ Relay registered.` |
| 重启 gateway | `🔄 重启 Hermes gateway...` | `🔄 Restarting Hermes gateway…` |
| gateway 成功 | `✅ Gateway 已重启` | `✅ Gateway restarted.` |
| 完成标题 | `🎉 安装完成！` | `🎉 All set.` |
| URL 引导 | `📋 你的 Webhook URL（永久有效，复制到 Pancake Dashboard）:` | `📋 Your permanent Webhook URL — paste into the Pancake Dashboard:` |
| gateway 手动提示 | `⚠️ Gateway 自动重启失败，请手动执行以下命令使配置生效：` | `⚠️  Automatic gateway restart failed. Run this to apply the config:` |
| 下一步 | `下一步：` | `Next steps:` |
| step 1 | `手动重启 gateway（上面的命令）` | `Run the command above to restart the gateway` |
| step 2 | `打开 Pancake Dashboard → Settings → Webhooks` | `Open Pancake Dashboard → Settings → Webhooks` |
| step 3 | `粘贴上面的 URL，勾选事件，保存` | `Paste the URL above, select events, save` |
| 辅助命令 1 | `随时查看 URL：pancake-hermes-setup --url` | `Show URL anytime:  pancake-hermes-setup --url` |
| 辅助命令 2 | `停止 Tunnel：pancake-hermes-setup --stop` | `Stop the tunnel:   pancake-hermes-setup --stop` |
| Webhook platform 已开 | `✅ Webhook platform 已启用` | `✅ Webhook platform already enabled.` |
| Webhook platform 启用中 | `📝 启用 Webhook platform...` | `📝 Enabling the webhook platform…` |
| Webhook platform 启用成功 | `✅ Webhook platform 已启用` | `✅ Webhook platform enabled.` |
| 配置缺失 | `❌ 未找到 Hermes 配置: …` | `❌ Hermes config not found: …` |
| --url 无配置 | `未找到 Pancake × Hermes 配置。先运行 pancake-hermes-setup 完成安装。` | `No Pancake × Hermes configuration found. Run pancake-hermes-setup to finish setup.` |
| --stop 成功 | `✅ Tunnel 已停止 (PID: X)` | `✅ Tunnel stopped (PID: X)` |
| --stop 失败 | `⚠️ 无法停止 PID X: …` | `⚠️  Couldn't stop PID X: …` |
| --stop 无运行 | `无运行中的 tunnel 记录` | `No tunnel is currently tracked.` |
| kill 旧 tunnel | `🛑 已停止旧 tunnel (PID: X)` | `🛑 Stopped previous tunnel (PID: X)` |
| 顶层异常 | `安装出错:` | `Setup failed:` |

### 3.3 通知 Prompt（Hermes `--prompt` 参数）

**定位澄清**：此 prompt 不是字段替换模板，而是喂给 LLM 的上下文 + 指令。LLM 基于事件数据和这段指令自主生成最终消息。

当前（中文纯模板）：
```
Pancake 支付通知
📦 事件: {eventType}
商品: {data.productName}
金额: {data.amount} {data.currency}
买家: {data.buyerEmail}
时间: {timestamp}
事件ID: {eventId}
```

最终采用（英文 · 上下文 + 指令 · Markdown 结构化输出 · 字段分行）：
```
Pancake payment event for an indie maker.

Event: {eventType}
Product: {data.productName}
Amount: {data.amount} {data.currency}
Buyer: {data.buyerEmail}
Time: {timestamp}
Event ID: {eventId}

Respond in Feishu-friendly Markdown. Match the product's language (Chinese product name → Chinese labels; English → English labels).

Exact 10-line structure:

Line 1: "# " + event emoji(s) + " " + punchy event title (≤ 10 chars)
  · order.completed → "新订单入账" / "New sale"
  · subscription.activated → "新订阅到手" / "New subscription"
  · subscription.payment_succeeded → "续费成功" / "Renewed"
  · subscription.canceling / canceled → "有人要走了" / "Cancellation"
  · refund.succeeded → "退款完成" / "Refunded"
  · refund.failed / past_due → "扣款异常" / "Payment issue"
Line 2: (blank)
Line 3: "商品名称：" (or "Product: ") + **bold product name**
Line 4: "金额：" (or "Amount: ") + amount + " " + currency
Line 5: "用户邮箱：" (or "Buyer: ") + buyer email
Line 6: (blank)
Line 7: one fun, product-aware line. AVOID generic cheers ("加油", "值得", "太棒了", "nice work", "keep it up"). PREFER in priority order:
  1. BEST — infer what the product does and weave that into the line:
     · "人生管理模板" → "又一个人选择用你的模板管理人生"
     · "AI 对话助手" → "又有人让你的 AI 替他加班"
     · "code editor" → "someone just trusted your editor to ship their side project"
  2. If product use is unclear, fall back to tangible life scenes — "这单够你今晚点个烧烤了", "又凑够一个月云服务器钱"
  3. Playful observations — "又一个陌生人为你的代码付费", "someone just voted with their wallet"
  4. Gentle humor on churn / refund — "天要下雨，用户要取消", "退就退吧，钱来过见过"
  Match the event mood: celebratory for sales, affectionate for renewals, composed for cancellations, matter-of-fact for refunds.
Line 8: ---
Line 9: "订单号：" (or "Order ID: ") + `event_id` in inline backticks
Line 10: "时间：" (or "Time: ") + time

Event emoji: 💰🎉 order.completed · ✨ subscription.activated · 🔁 subscription.payment_succeeded · 👋 subscription.canceling/canceled · 💸 refund.succeeded · ⚠️ refund.failed/past_due

Emit only those ten lines. No preamble or trailer.
```

Markdown 触发逻辑：**Line 1 的 `# header`、Line 3 的 `**bold**`、Line 8 的 `---`、Line 9 的 inline backticks 共四处命中** Hermes 的 `_MARKDOWN_HINT_RE`，整体消息以 `msg_type=post` + `tag=md` 渲染。

### 3.4 附带 bug 修复（smoke test 发现）

`findCloudflaredBin()` 返回路径修正：

```js
// before
join(homedir(), ".hermes/pancake-cloudflared/bin/cloudflared")
// after
join(homedir(), ".hermes/pancake-cloudflared/node_modules/cloudflared/bin/cloudflared")
```

### 3.5 不改（out of scope）

- `README.md` 的中文章节（Hermes 整段目前是中文） — 后续单独 PRD 一并处理 README 英文化
- `bin/setup.mjs`（OpenClaw 版本向导） — 本 PRD 只涵盖 hermes 向导
- 代码注释 — 对用户不可见，保持不变
- 抛出的 `Error` 里 `err.message` 透传部分 — 来自底层，不改写
- 版本号 — 不 bump，合并发版时再一起 bump（最小变更原则）

## 4. 执行步骤

1. 按 §3.2 和 §3.3 替换 `bin/hermes-setup.mjs` 的字符串
2. 本地 `node --check bin/hermes-setup.mjs` 语法自检
3. `npm run build` + `npm test` 走一遍，确保无副作用（本文件不进 TS 编译，但跑完整检查）
4. 在本地（或远程 Mac Mini）跑 `--url` / `--stop` 两个只读分支验证输出
5. 完整安装走一次 smoke test（远程 Mac Mini 上已准备好环境）
6. 提交代码，commit message 格式：`refactor(hermes-setup): rewrite wizard copy in English (PRD: docs/prd/2026-04-21-hermes-setup-english-copy.md)`

## 5. 风险与回滚

- **风险 1**：某些字符串是在错误路径里（e.g., `❌ 订阅失败`），测试可能覆盖不到。通过对每条路径做 grep review 降低风险。
- **风险 2**：已有用户看到中文提示 → 变英文，有迁移摩擦。鉴于包当前还没正式用户（见 `2026-04-20-npm-scope-migration.md` §1），不做兼容。
- **回滚**：`git revert` 本次 commit，一次搞定。

## 6. 测试要点

- [ ] `node --check bin/hermes-setup.mjs` 通过
- [ ] `npm run build` 通过
- [ ] `npm test` 通过
- [ ] `pancake-hermes-setup --url`（有/无配置两种情况）输出是英文
- [ ] `pancake-hermes-setup --stop`（有/无 tunnel 两种情况）输出是英文
- [ ] 走完整向导一次，从头到尾输出全英文，无残留中文
- [ ] IM 侧收到的 pancake 通知格式切换为英文模板

## 7. 后续（本次不做）

- README.md Hermes 章节英文化（另开 PRD）
- `bin/setup.mjs` OpenClaw 向导英文化（另开 PRD）
- Linear 同步：提交后按全局规范创建 `[PRD] Hermes 向导文案英文化` Issue

## 8. 实现摘要（与原 PRD 的差异）

- **改动范围**：只涉及 `bin/hermes-setup.mjs`（1 个文件）。三类改动：① 用户可见字符串全部英文化；② `findCloudflaredBin()` 路径 bug 修复（1 行）；③ Hermes `--prompt` 参数从中文纯模板 → 英文「上下文 + 指令 + 10-line Markdown 结构化输出 + product-aware 鼓励话」。
- **Prompt 迭代轨迹**（共 5 版，最终定稿见 §3.3）：
  1. v1 中文纯模板（原版）
  2. v2 英文纯模板（初版英文化）
  3. v3 英文 + 指令式 + 上下文（引导 LLM 而非字段替换）
  4. v4 + Markdown 结构（`**bold**` + `---` + inline backticks → 走 post 富文本）
  5. v5 + 字段分行（商品/金额/邮箱各占一行）
  6. v6 + 订单号与时间分两行
  7. v7 + H1 标题 + 鼓励话禁用"加油/值得"等套话
  8. v8（定稿）+ 鼓励话首选 product-aware（结合商品用途），fallback 到生活场景 / 调侃观察 / 幽默
- **PRD 范围扩展**（见变更记录）：
  1. `findCloudflaredBin()` 路径修正 — smoke test 暴露的既有 bug。
  2. Prompt 从纯字段模板升级为指令式 — Hermes `--prompt` 是 LLM 上下文而非模板。
  3. Prompt 引入 Markdown → 自动触发 Hermes `_MARKDOWN_HINT_RE` → 走 `msg_type=post` 富文本卡片（零 Hermes 代码改动）。
  4. Prompt 加 h1 标题 + 字段分行 + product-aware 鼓励话 — 用户体验打磨。
  5. 研究后排除 Interactive Card 方案：`feishu.py` 里 `msg_type="interactive"` 是 `send_exec_approval` 专用硬编码路径，通用 send 管道不暴露；要走 interactive 卡片必须 fork Hermes 或绕开其飞书投递，成本过高，本次不做。
- **版本号**：保持 `0.3.9` 未 bump，等下次正式发版统一 bump。
- **验证结果**：
  - 静态：`node --check`、`npm run build`、`npm test`（33/33 全绿）本地全部通过
  - 文案：`--url`（有/无配置）、`--stop`（有/无 tunnel）四种分支本地 + 远程 Mac Mini 均输出英文；向导全流程零残留中文
  - 投递：真实 Pancake 测试订单在飞书群渲染为 post 富文本卡片 —— h1 标题 + 粗体产品名 + 字段分行 + 水平分隔线 + inline code event ID 五个视觉特征全部命中；鼓励话结合商品用途（如 "又一个人选择用你的模板管理人生"）。
  - 端到端链路：Pancake Dashboard → Waffo Relay → Cloudflare tunnel → Hermes webhook adapter → LLM 加工 → 飞书群，完整走通。
