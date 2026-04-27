# 包名重命名：@waffo/openclaw-plugin → @waffo/pancake-plugin，bin 改为子命令风格

> **日期：** 2026-04-27
> **状态：** Implemented
> **模板类型：** 简化版（功能优化）

## 变更记录

| 日期 | 变更内容 | 变更原因 |
|------|----------|----------|
| 2026-04-27 | 创建 PRD | 当前包名 `@waffo/openclaw-plugin` 暗示只服务 OpenClaw，但实际同时支持 OpenClaw 和 Hermes 两条投递链路；bin 名 `pancake-setup` / `pancake-hermes-setup` 也未体现这是「Pancake 插件 + 选择目标」的关系。要换成 `@waffo/pancake-plugin` + `openclaw-setup` / `hermes-setup`，让安装命令一眼看清「谁是产品、谁是目标」 |
| 2026-04-27 | PRD 确认，状态切换为开发中 | owner 拍板三项待定：① 旧包不 deprecate（无存量用户）；② 新版本走 `0.4.0`；③ README 不加 Migration note |
| 2026-04-27 | 扩展范围：同时移除 `waffo-pancake` 老 bin alias | 改名期间发现 `package.json` 还留着 4-20 npm scope 迁移时的兼容 bin（`"waffo-pancake": "bin/setup.mjs"`）。既无存量用户，保留这条仅是历史包袱，一并清掉 |

---

## 1. 业务目标 (The "Why")

- **用户痛点：**
  - 包名 `openclaw-plugin` 让走 Hermes 链路的用户疑惑（"我没装 OpenClaw 也要装这个？"）
  - bin 命名前缀 `pancake-` 重复（包名已经是 pancake 域），且把 hermes 当成 setup 的"修饰词"而非平级选项
- **核心业务价值：** 安装命令自解释——`@waffo/pancake-plugin` 是 Pancake 官方插件，`openclaw-setup` / `hermes-setup` 分别是两种部署目标。新用户拿到命令就知道在做什么。

## 2. 逻辑流与规则 (Logic & Rules)

- **核心逻辑：**
  - `package.json` `name`: `@waffo/openclaw-plugin` → `@waffo/pancake-plugin`
  - `package.json` `bin`:
    - `pancake-setup` → `openclaw-setup`
    - `pancake-hermes-setup` → `hermes-setup`
  - 新安装命令：
    - `npx -p @waffo/pancake-plugin openclaw-setup`
    - `npx -p @waffo/pancake-plugin hermes-setup`
- **隐含逻辑：**
  - `bin/setup.mjs:48` 里有自己 `npm pack @waffo/openclaw-plugin` 的逻辑（OpenClaw 把插件下载到 `~/.openclaw/extensions/pancake`），这条 spec 必须同步改名
  - `bin/setup.mjs:134` 写入 OpenClaw 配置时也带 `spec: "@waffo/openclaw-plugin"`，跟着改
  - 用户机器上 `~/.openclaw/openclaw.json` 里已存的 `installs.pancake.spec` 是历史值——存量用户重新跑 `openclaw-setup` 时会被新版本覆盖（Step 5 已经无脑写新值），不需要专门做迁移逻辑
  - 历史 PRD 文档（`docs/prd/2026-04-20-*.md` / `2026-04-21-*.md` / `2026-04-26-*.md`）里的旧包名/旧命令是**史料**，不动
- **权限/约束：** owner（huiling.mo）有 npm `@waffo` scope 发布权限（4-20 那次迁移已验证）

## 3. 数据模型 (Data & State)

无新增字段，仅改字符串值。涉及位置：

| 文件 | 行号 | 旧值 | 新值 |
|------|------|------|------|
| `package.json` | 2 | `"@waffo/openclaw-plugin"` | `"@waffo/pancake-plugin"` |
| `package.json` | 14 | `"pancake-setup"` | `"openclaw-setup"` |
| `package.json` | 16 | `"pancake-hermes-setup"` | `"hermes-setup"` |
| `bin/setup.mjs` | 23 | `pancake-setup` | `openclaw-setup` |
| `bin/setup.mjs` | 48 | `npm pack @waffo/openclaw-plugin` | `npm pack @waffo/pancake-plugin` |
| `bin/setup.mjs` | 134 | `spec: "@waffo/openclaw-plugin"` | `spec: "@waffo/pancake-plugin"` |
| `bin/setup.mjs` | 155 | `pancake-setup --url` | `openclaw-setup --url` |
| `bin/hermes-setup.mjs` | 43 | `pancake-hermes-setup` | `hermes-setup` |
| `bin/hermes-setup.mjs` | 277 | `pancake-hermes-setup --url` | `hermes-setup --url` |
| `bin/hermes-setup.mjs` | 278 | `pancake-hermes-setup --stop` | `hermes-setup --stop` |
| `README.md` | 多处 | 旧名 | 新名（包名 + 安装命令 + 命令对照表） |

## 4. 边界情况与异常处理 (Edge Cases)

- **存量用户**：用户机器上 PATH 里有旧 bin（`pancake-setup` / `pancake-hermes-setup`）—— 这些是 npm 全局/`npx` 缓存里的，下次 `npx -p @waffo/pancake-plugin ...` 会拉新包，不冲突。不写自动迁移脚本。
- **OpenClaw 已安装的旧 plugin 目录**：`~/.openclaw/extensions/pancake/` 里有旧版 tarball 解出来的文件。重跑 `openclaw-setup` 会重新 `npm pack` 新包到同目录，新文件覆盖旧文件。`openclaw.json` 的 `installs.pancake.spec` 也会被新代码覆盖为新名。**不会出现既装旧又装新的双装态**。
- **下面三个由 owner 在确认 PRD 时拍板（暂不处理 = 当前默认）：**
  - **旧包 `@waffo/openclaw-plugin` 是否发 deprecation 通知？** —— 默认走 `npm deprecate @waffo/openclaw-plugin "moved to @waffo/pancake-plugin"`，这样老用户 `npm install` 旧包会看到一行警告但不报错。
  - **版本号策略** —— 当前 `0.3.10`。新包从 `0.4.0` 起步（minor bump，标记包名/CLI 命令的 breaking change 但不到 1.0），还是直接走 `1.0.0`？倾向 `0.4.0`（产品还没出 GA，留 1.0 给真正成熟节点）。
  - **README 里要不要保留"旧命令 → 新命令"的对照行？** —— 倾向加一段 Migration note，让 4-20 那批早期用户能搜到。

## 5. 关键决策记录 (ADR)

| 决策点 | 选择 | 原因 | 排除方案 |
|--------|------|------|----------|
| 包名 | `@waffo/pancake-plugin` | Pancake 是产品、OpenClaw / Hermes 是部署目标，包名应该跟产品 | `@waffo/pancake` 太宽泛，易撞未来仓库 |
| bin 名 | 子命令风格 `openclaw-setup` / `hermes-setup` | 在 `npx -p <pkg>` 上下文里读起来是「pancake-plugin 提供 openclaw 的 setup」 | 保持 `pancake-` 前缀（重复 scope）；做单 entry `pancake-setup --target openclaw` 改动太大 |
| 版本号 | 待 owner 确认（默认 `0.4.0`） | minor bump 表达 breaking 但保 0.x 状态 | 1.0.0（过早） |
| 旧包处理 | 待 owner 确认（默认 deprecate） | npm deprecate 是无痛的迁移信号 | 直接弃用不通知（差） |

- **技术债：** 无新增。

---

## 6. 执行计划（确认后展开）

1. 改 `package.json`、两个 bin 文件、`README.md`（含 Migration note 视确认而定）
2. `npm run build` + `npm test`（vitest 33 case 应全绿）
3. 本地 `node --check` 两个 bin 文件
4. `npm pack` 看产物 tarball 名是不是 `waffo-pancake-plugin-0.4.0.tgz`
5. 如果 owner 同意：
   - `npm publish --access public`
   - `npm deprecate @waffo/openclaw-plugin "Moved to @waffo/pancake-plugin. Run: npx -p @waffo/pancake-plugin openclaw-setup (or hermes-setup)"`
6. 提交 commit：`refactor: rename package to @waffo/pancake-plugin with subcommand-style bins (PRD: docs/prd/2026-04-27-package-rename-pancake-plugin.md)`
7. 同步 Linear（`[PRD] 包名重命名 @waffo/pancake-plugin`）

---

## 7. 实现摘要（与原 PRD 的差异）

- **改动范围**：4 个文件（`package.json` / `bin/setup.mjs` / `bin/hermes-setup.mjs` / `README.md`）—— 全部为字符串重命名 + 1 处描述更新，零业务逻辑变更。
- **PRD 范围扩展**：开发中发现 `package.json` 还有 4-20 npm scope 迁移期遗留的 `waffo-pancake` bin alias，一并清除（见变更记录）。
- **owner 决策落地**：
  - 旧包 `@waffo/openclaw-plugin` 不发 deprecate（无存量用户）。
  - 版本号 `0.3.10` → `0.4.0`（minor bump，标记包名 + bin 命名 breaking）。
  - README 未加 Migration note。
- **验证结果**：
  - `node --check` 两个 bin 文件 → OK
  - `npm run build`（tsc）→ OK
  - `npm test`（vitest）→ 33/33 全绿
  - `npm pack --dry-run` 产物：`@waffo/pancake-plugin@0.4.0` → `waffo-pancake-plugin-0.4.0.tgz`
