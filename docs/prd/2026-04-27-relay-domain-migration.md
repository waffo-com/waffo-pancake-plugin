# Relay 服务域名迁移：waffo-pancake-webhook-relay.vercel.app → relay.waffo.ai

> **日期：** 2026-04-27
> **状态：** Implemented
> **模板类型：** 简化版（功能优化）

## 变更记录

| 日期 | 变更内容 | 变更原因 |
|------|----------|----------|
| 2026-04-27 | 创建 PRD | Vercel 默认域名 `waffo-pancake-webhook-relay.vercel.app` 长、不专业、且和品牌脱节。把 relay 服务挂到 `relay.waffo.ai` 子域名，统一品牌、出现在用户 Pancake Dashboard webhook 配置框里时更可信。`pancake.waffo.ai` 已被 Dashboard 占用，`waffo.ai` 是官网，故选 `relay.*` 这个语义型子域名（详见 §5 ADR） |
| 2026-04-27 | PRD 确认 + DNS 通后实施 | owner 回复「确认」；老板在 Cloudflare 加 CNAME `relay → db9e54c13be46334.vercel-dns-016.com`（DNS only，不开 Proxy）；SSL 自动签发完成后开始改代码 |

---

## 1. 业务目标 (The "Why")

- **用户痛点：**
  - 用户在 Pancake Dashboard 的 Webhooks 配置框里看到 `https://waffo-pancake-webhook-relay.vercel.app/webhook/<uuid>` —— 一眼就是「这是 Vercel 上一个第三方服务」，不像「Waffo 官方基础设施」
  - 长 URL 在文档/截图里观感差
- **核心业务价值：** 用 `relay.waffo.ai` 后，webhook URL 出现在所有用户面前的位置（Dashboard 配置 / 安装向导日志 / README 截图）都是品牌一致的子域名。

## 2. 逻辑流与规则 (Logic & Rules)

- **核心逻辑：**
  - 客户端硬编码常量 `RELAY_BASE` / `RELAY_BASE_URL` 全部替换为 `https://relay.waffo.ai`
  - 服务端**零改动** —— `api/register.ts:45-46` 已经是 host-aware 设计（`req.headers.host` 优先，`relay.waffo.ai` 已在 fallback 里），CORS 走 `*`，无 host 白名单
  - Vercel `*.vercel.app` 默认域名**保留**（不主动下线），充当老客户端兜底
- **隐含逻辑：**
  - 服务端 `register.ts` 返回的 `webhookUrl` 字段会跟随 `Host` 头走 —— 客户端从 `relay.waffo.ai/register` 注册，拿到的 `webhookUrl` 也是 `relay.waffo.ai/webhook/...`，不会出现混合域名
  - 已发布的 `0.4.0` 客户端仍然指向旧域名，正常工作（Vercel 默认域名仍存活）；本次发 `0.4.1` 后新装客户端走新域名
  - `.claude/settings.local.json` 里的 curl 白名单是**本地工具配置**，不进 npm 包、不影响用户，按需更新即可
- **权限/约束：**
  - 前置：DNS 加 CNAME（owner 在 DNS 控制台操作）+ Vercel SSL 证书签发完成
  - 验证通过 `curl https://relay.waffo.ai/` 返回 `{"service":"waffo-pancake-webhook-relay","status":"ok"}` 等同旧域名

## 3. 数据模型 (Data & State)

无新增字段，仅改字符串值。涉及位置：

| 文件 | 行号 | 旧值 | 新值 |
|------|------|------|------|
| `src/relay/client.ts` | 3 | `"https://waffo-pancake-webhook-relay.vercel.app"` | `"https://relay.waffo.ai"` |
| `bin/setup.mjs` | 14 | 同上 | 同上 |
| `bin/hermes-setup.mjs` | 16 | 同上 | 同上 |
| `tests/unit/relay-client.test.ts` | 11 | URL 断言 | 新域名 |
| `tests/unit/relay-client.test.ts` | 24 | URL 断言 | 新域名 |
| `README.md` | 78 | 安装日志示例 | 新域名 |
| `README.md` | 199 | 手动 curl 示例 | 新域名 |
| `package.json` | 3 | `"version": "0.4.0"` | `"version": "0.4.1"` |
| `.claude/settings.local.json` | 36, 38 | curl 白名单（可选） | 新增/替换 |

## 4. 边界情况与异常处理 (Edge Cases)

- **DNS 没通就发版**：禁止——执行步骤 1 是 DNS/SSL 验证，必须 200 响应才进步骤 2 改代码
- **存量 npm 客户端（0.4.0）**：仍然走旧域名 `*.vercel.app`，Vercel 默认域名永久保留，不会失效。
- **存量已配置的 webhook URL（写死在 Pancake Dashboard 里）**：若有用户已经粘贴过老 URL，老 URL 继续有效（因为 Vercel 默认域名留着 + 服务端 host-aware）。鉴于 owner 已确认无存量用户，不做任何迁移自动化。
- **301 redirect（旧域名 → 新域名）**：不做。理由：①无存量用户；②Vercel 默认域名作为兜底比 redirect 更稳；③加 redirect 反而会让未来"哪个 URL 才是权威"变模糊。
- **服务端是否要 deprecate 旧域名访问**：不 deprecate。Vercel `*.vercel.app` 是平台级域名，不主动断。

## 5. 关键决策记录 (ADR)

| 决策点 | 选择 | 原因 | 排除方案 |
|--------|------|------|----------|
| 子域名 | `relay.waffo.ai` | ① 语义准确（中继服务 ≠ webhook 接收方）；② 可复用——未来其他产品也走 `relay.waffo.ai/<product>/...`；③ 不抢 `api.waffo.ai`（留给真正的公开 REST API）命名空间 | `pancake.waffo.ai`（Dashboard 已占）；`hooks.waffo.ai`（Stripe convention 但和 Pancake 自己的「Webhooks 设置」语义混淆）；`webhook.waffo.ai`（单数太窄） |
| 旧域名处理 | 保留 Vercel 默认域名作兜底，不主动下线、不发 redirect | 无存量用户 + Vercel 平台域名稳定，无成本保留 | 设新域名为 Production Primary（无意义，Vercel 自动多域名共存）；服务端加 301 redirect（增加运维心智，无用户收益） |
| 版本号 | `0.4.0 → 0.4.1`（patch bump） | URL 常量替换无 API breaking | minor bump（语义错误，无新功能）；不 bump（npm publish 不允许同版本号） |
| 服务端是否改动 | **不改** | `register.ts:46` 已 host-aware；CORS 走 `*` | 显式硬编码 `relay.waffo.ai`（无收益，反而锁死） |

- **技术债：** 无新增。

## 6. 执行计划

1. **前置：DNS + SSL 验证**
   - 在 `waffo.ai` DNS 控制台加 CNAME：`relay` → `cname.vercel-dns.com`（具体值以 Vercel Domains 面板提示为准）
   - Vercel 自动签发 SSL（几十秒到几分钟）
   - 本机 `curl -s https://relay.waffo.ai/` 必须返回 `{"service":"waffo-pancake-webhook-relay","status":"ok"}`，且 `curl -s https://relay.waffo.ai/webhook/test-uuid` 返回 404 JSON（不是 502）
   - **此步骤通过前不动客户端代码**
2. 改 9 处常量 / 测试 / README / `package.json` 版本号（详见 §3 表格）
3. `npm run build` + `npm test`（vitest 33 case 应全绿）
4. `node --check` 两个 bin
5. 本地 dry run：`npm pack --dry-run` 看 tarball name
6. commit：`refactor: migrate relay domain to relay.waffo.ai (PRD: docs/prd/2026-04-27-relay-domain-migration.md)`
7. `npm publish --access public`
8. 发版后 smoke test：在远程 Mac Mini 上 `npx -p @waffo/pancake-plugin@0.4.1 hermes-setup --url`（如果有 fixture 配置）输出新域名

## 7. 测试要点

- [ ] DNS 解析：`dig relay.waffo.ai` 返回 Vercel CNAME
- [ ] SSL：浏览器/curl 不报证书错误
- [ ] `curl https://relay.waffo.ai/` 返回服务 ok
- [ ] `curl -X POST https://relay.waffo.ai/register -d '{"pluginId":"smoke-test","targetUrl":"https://example.com/webhook"}' -H 'Content-Type: application/json'` 返回 `webhookUrl: https://relay.waffo.ai/webhook/smoke-test`
- [ ] vitest 33/33 全绿（断言已替换）
- [ ] `npm pack --dry-run` 产物：`@waffo/pancake-plugin@0.4.1` → `waffo-pancake-plugin-0.4.1.tgz`

## 8. 风险与回滚

- **风险**：DNS/SSL 配置错误导致新域名不可用 —— 通过 §6 步骤 1 的硬性验证拦截，未通过不动代码
- **回滚**：如果发版后发现新域名问题，`git revert` + `npm publish` 0.4.2（patch）回到旧域名常量；存量 0.4.0 用户不受影响

---

## 9. 实现摘要（与原 PRD 的差异）

- **改动范围**：6 个文件 —— 3 处 `RELAY_BASE` 常量（`src/relay/client.ts` / `bin/setup.mjs` / `bin/hermes-setup.mjs`）+ 2 处测试断言（`tests/unit/relay-client.test.ts`，`replace_all`）+ 2 处 README 示例（同 `replace_all`）+ `package.json` 版本号 0.4.0 → 0.4.1。零业务逻辑变更。
- **服务端**：与 PRD 预测一致——`api/register.ts:46` 已 host-aware，CORS 走 `*`，零代码改动。已通过 `curl -X POST https://relay.waffo.ai/register` 验证返回的 `webhookUrl` 自动跟随新域名。
- **`.claude/settings.local.json`**：未更新——已存在 `Bash(curl:*)` 全通配，旧域名特化条目本就冗余；且该文件 untracked、不进发布包，无影响。
- **DNS 路径**：Cloudflare CNAME `relay → db9e54c13be46334.vercel-dns-016.com`（IP range expansion 后的新格式，非传统 `cname.vercel-dns.com`），Proxy 保持 DNS only。
- **验证结果**：
  - DNS：`dig +short relay.waffo.ai` → `db9e54c13be46334.vercel-dns-016.com.` + Vercel anycast IP
  - SSL：自动签发，约 1 分钟内通；`curl https://relay.waffo.ai/` 返回 `{"service":"waffo-pancake-webhook-relay","status":"ok"}`
  - register：`POST /register` 返回 `webhookUrl: "https://relay.waffo.ai/webhook/<uuid>"`
  - `node --check` × 2 / `npm run build` / `npm test`（vitest 33/33）/ `npm pack --dry-run`（`@waffo/pancake-plugin@0.4.1`）全部通过
