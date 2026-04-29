# PRD: 升级 cloudflared 依赖修复 tunnel emit 自递归 bug

> **状态：** In Progress
> **创建日期：** 2026-04-29
> **最后更新：** 2026-04-29
> **模板类型：** 简化版（Bug Fix / 优化迭代）

## 变更记录

| 日期 | 变更内容 | 变更原因 | 发起方 |
|------|----------|----------|--------|
| 2026-04-29 | 创建 PRD v1 草稿 | 远程 Mac Mini 安装 OpenClaw 插件后 `pancake` 无响应。本地 cc 排查后定位到 `cloudflared@0.6.0` 的 `lib/tunnel.js:74-85` `setupEventHandlers` 链式调用 `.on("error", (err) => this.emit("error", err))` 在 error 事件无监听者时被 EventEmitter 默认行为 re-throw，导致 emit→error→emit→error 无限递归。已下载 0.7.1 tarball diff 验证：该版本（2025-08-01 发布）已删除上述两段 `.on("error", ...)`，与 plan B 的本地 patch 完全等价 | huiling.mo |
| 2026-04-29 | 修正 §7 测试链路：tunnel → relay → ~~hermes~~ → **openclaw plugin handler** | 远程装的是 OpenClaw 插件，本次 bug fix 影响的是 `src/tunnel/cloudflare.ts`（OpenClaw 进程内 import 的 cloudflared npm 包），webhook 终点是 OpenClaw 自身的 plugin handler；Hermes 是独立链路（spawn 二进制）不走这条路，原文案描述的端到端目标错了 | huiling.mo |
| 2026-04-29 | PRD 确认，状态切换为 In Progress | 用户回复「确认」 | huiling.mo |

---

## 1. 背景

`src/tunnel/cloudflare.ts` 通过 `await import("cloudflared")` 调用 npm 包 `cloudflared` 的 `Tunnel` 类启动 Quick Tunnel。`package.json` 把它声明在 `optionalDependencies` 下，版本约束为 `^0.6.0`。

`cloudflared@0.6.0` 的 `lib/tunnel.js` 中：

```js
setupEventHandlers() {
  this.on("stdout", (output) => {
    this.processOutput(output);
  }).on("error", (err) => {
    this.emit("error", err);   // ← 自己 emit 自己
  });
  this.on("stderr", (output) => {
    this.processOutput(output);
  }).on("error", (err) => {
    this.emit("error", err);   // ← 自己 emit 自己
  });
}
```

一旦底层 `child.on("error", ...)` 触发了 Tunnel 实例的 `error` 事件，上面这两个 listener 会再 emit 一次 `error`，又被自己监听到再 emit……进入无限递归直至 stack overflow / 进程僵死。这正是远程 Mac Mini 上 `pancake` 无响应的根因。

`cloudflared@0.7.1`（2025-08-01）的同一函数已经清理为：

```js
setupEventHandlers() {
  this.on("stdout", (output) => { this.processOutput(output); });
  this.on("stderr", (output) => { this.processOutput(output); });
}
```

直接升级依赖即可消除该路径，不需要本地 patch。

`bin/hermes-setup.mjs` 走的是 `spawn(cfBin, ["tunnel", ...])` 直接拉起二进制（行 327-330），不经过 npm 包的 JS EventEmitter 层，**不受**该 bug 影响，无需改动。

## 2. 目标

- 把 `package.json` 里 `optionalDependencies.cloudflared` 从 `^0.6.0` 升级到 `^0.7.1`，重生成 lockfile
- 远程 Mac Mini 重装 `@waffo/pancake-plugin` 后，调用 `pancake` 启动 OpenClaw 插件，Quick Tunnel 在 30s 内成功返回 `https://*.trycloudflare.com` URL（修复前：0/N 成功 → 修复后：≥3/3 成功）
- `vitest run` 33/33 全绿不变
- 改动文件数 = 2（`package.json` + `package-lock.json`），零代码变更

## 3. 变更范围

### 3.1 必改文件

| 文件 | 改动 |
|------|------|
| `package.json` | `optionalDependencies.cloudflared`: `"^0.6.0"` → `"^0.7.1"` |
| `package-lock.json` | `npm install` 自动重生成 cloudflared 及其传递依赖的 hash |

### 3.2 不改（out of scope）

- `src/tunnel/cloudflare.ts`：0.7.1 公开 API（`Tunnel.quick`、`Tunnel.withToken`、`url`/`error`/`connected`/`close` 事件）保持兼容，无需调整
- `bin/hermes-setup.mjs`：行 309 `npm install cloudflared --silent` 无版本约束，默认拉 latest（即 0.7.1），且后续 `spawn` 二进制路径不依赖 JS EventEmitter，无需改
- `tests/unit/tunnel.test.ts`：mock 了 cloudflared 模块，与版本无关
- `version` bump：本次随 bug fix 一起在合并发版时 bump（建议 `0.4.1` → `0.4.2`，patch 级），由发版 PR 处理，本 PRD 不锁定版本号

## 4. 失败模式

| 类别 | 失败场景 | 表现 | 处理策略 |
|------|----------|------|----------|
| 外部依赖故障 | npm registry 拉不到 `cloudflared@0.7.1`（registry 故障 / 用户切到了私有源没同步） | `npm install` 报 `404` 或超时 | 让 owner 走代理或切回 `registry.npmjs.org`；optionalDependency 的安装失败不阻塞主包安装，但 tunnel 不可用 |
| 外部依赖故障 | 0.7.1 启动时仍要从 GitHub Releases 下载 cloudflared 二进制（`postinstall`），CDN 超时或对应平台 binary 缺失 | `cloudflared` 模块加载成功但 `Tunnel.quick` 抛 `ENOENT` / binary not found | 已有兜底 — `findCloudflaredBin()` 会先查 homebrew (`/opt/homebrew/bin/cloudflared`) 和 `/usr/local/bin/cloudflared`；建议 owner 远程机预装 `brew install cloudflared` 作为 fallback |
| 并发 / 重复 | 升级前已残留运行中的 0.6.0 tunnel 进程，新版本启动时端口或 pid 文件冲突 | 新 tunnel 启动卡住或拿不到 URL | hermes-setup 的 `killExistingTunnel()` 已处理 PID 清理；OpenClaw 路径靠 `t.stop()`，升级前需 owner 手动 `pkill cloudflared` 清场 |
| 数据异常 | 用户在已 install 过 0.6.0 的本地仓库 `git pull` 但不跑 `npm install`，`node_modules/cloudflared` 仍是 0.6.0 | 升级生效不了，bug 重现 | 在 commit message / changelog 里明确写 "需重新 `npm install`"；远程机走 `npm install -g @waffo/pancake-plugin@new` 自动覆盖 |
| 用户操作异常 | 用户用 `npm install --omit=optional` 跳过 optionalDependencies，cloudflared 没装上 | `import("cloudflared")` 抛 `Cannot find module` | `src/tunnel/cloudflare.ts` 已用 `try/catch` 包住，错误会冒泡为 `Tunnel startup failed: Cannot find module 'cloudflared'`，文案清晰；不在本 PRD 修 |
| 性能极端 | N/A | 单依赖版本 bump，无性能维度变化 | — |

## 5. 执行步骤

1. `npm install cloudflared@^0.7.1 --save-optional`（替代手改 package.json，自动同步 lockfile）
2. `git diff package.json package-lock.json` 确认只有 cloudflared 及其传递依赖变化
3. `npm run build` 通过
4. `npm test` 通过（33/33）
5. `npm run lint` 通过
6. 本地 smoke：起一个 OpenClaw 进程，确认 `Tunnel active: https://*.trycloudflare.com` 出现
7. 远程 Mac Mini smoke（关键验证点）：
   - `npm uninstall -g @waffo/pancake-plugin && npm install -g @waffo/pancake-plugin@<new>`（或本地 `npm pack` 后远程装 tarball）
   - `pancake` 启动 → 等 30s 内 tunnel URL 出现
   - 跑一次真实 webhook 投递验证端到端
8. 提交：`fix(tunnel): upgrade cloudflared to ^0.7.1 to fix emit recursion (PRD: docs/prd/2026-04-29-cloudflared-upgrade.md)`
9. 走发版 PR（patch bump 0.4.1 → 0.4.2）

## 6. 风险与回滚

- **风险 1**：0.7.0 / 0.7.1 之间引入了我们没注意到的 breaking change（虽然 setupEventHandlers diff 看起来很干净）。缓解：本地 + 远程双 smoke，覆盖 quick tunnel 全流程。
- **风险 2**：cloudflared 二进制下载源在升级时变化（postinstall 脚本拉的 binary URL）。缓解：fallback 到 homebrew 路径已有，远程机已装 homebrew cloudflared。
- **回滚**：`git revert` 本次 commit 即可，单文件改动一次干净撤回；远程机 `npm install -g @waffo/pancake-plugin@0.4.1` 回退到旧版（仍带 bug，需要用户接受）。

## 7. 测试要点

- [ ] `npm run build` 通过
- [ ] `npm test` 33/33 通过
- [ ] `npm run lint` 通过
- [ ] 本地 OpenClaw 启动 tunnel：`Tunnel active: https://*.trycloudflare.com` 出现
- [ ] 远程 Mac Mini 重装新版后 `pancake` 启动，30s 内拿到 tunnel URL
- [ ] 真实 Pancake 测试 webhook 经过 tunnel → Waffo Relay → OpenClaw plugin handler 收到事件并完成处理
- [ ] 旧版 0.6.0 安装的远程机更新后 bug 不再复现（无 stack overflow，无僵死进程）

## 8. 评审记录

| 评审人 | 意见 | 处理结果 |
|--------|------|----------|
| —      | —    | —        |
