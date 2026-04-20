# PRD: npm scope 迁移 @waffo-pancake → @waffo

> **状态：** 已完成
> **创建日期：** 2026-04-20
> **最后更新：** 2026-04-20
> **模板类型：** 简化版（优化/迭代）

## 变更记录

| 日期 | 变更内容 | 变更原因 | 发起方 |
|------|----------|----------|--------|
| 2026-04-20 | 创建 PRD | 公司 npm org `@waffo` 已添加作者，迁移个人 org 下的包到公司 org | huiling.mo |
| 2026-04-20 | 旧包处理从 unpublish 改为 deprecate | 新包已发布成功；unpublish 需要 2FA OTP 且 72 小时限制，deprecate 不需要 OTP、留迁移提示、不破坏任何已有安装 | huiling.mo |

---

## 1. 背景

目前包名 `@waffo-pancake/openclaw-plugin` 发布在个人账号注册的 `@waffo-pancake` org 下。公司 org `@waffo` 已将作者加入，需要把包迁到公司 scope。

当前版本 `0.3.9`，**尚无正式用户使用**，可以直接换 scope 并彻底清理旧包。

## 2. 目标

- 新包名：`@waffo/openclaw-plugin`
- 旧包 `@waffo-pancake/openclaw-plugin` 全部版本 deprecate，带迁移提示
- 所有仓库内对旧包名的引用全部更新

## 3. 变更范围

### 3.1 必改文件（包名引用）

| 文件 | 位置 | 说明 |
|------|------|------|
| `package.json` | L2 `name` | `@waffo-pancake/openclaw-plugin` → `@waffo/openclaw-plugin` |
| `README.md` | L1, 8, 27, 49, 129, 144 | 标题 + 所有 `npx -p ...` 与 `spec` 示例 |
| `bin/setup.mjs` | L48 (`npm pack`), L134 (`spec`) | 安装脚本里的包引用 |

### 3.2 不改（无关）

- `waffo-pancake-webhook-relay.vercel.app` / `waffo-pancake-auth-service.vercel.app` —— 独立服务 URL
- 仓库目录名 `waffo-pancake-openclaw-plugin/` —— 本地路径
- `bin` 命令名 `waffo-pancake` / `pancake-setup` / `pancake-hermes-setup` —— CLI 命令名，与 scope 无关
- `openclaw.plugin.json` —— 未引用包名

### 3.3 版本号策略

保留 `0.3.9` 不变，直接以同版本号发布到新 scope（新包名视作全新包，版本空间独立）。

## 4. 执行步骤

1. 改 `package.json` 的 `name` → `@waffo/openclaw-plugin`
2. 替换 `README.md` 6 处引用
3. 替换 `bin/setup.mjs` 2 处引用
4. 本地构建 + 测试：`npm run build && npm test`
5. `npm whoami` 确认账号有 `@waffo` 发布权限
6. `npm publish --access public`
7. `npm deprecate @waffo-pancake/openclaw-plugin@"*" "Package moved to @waffo/openclaw-plugin. Please update."`（所有旧版本标记为 deprecated）
8. 提交代码，commit message 引用本 PRD

## 5. 风险与回滚

- **风险 1**：`@waffo` scope 下已有同名包 → 发布时会报错，需要与 org 管理员确认。
- **风险 2**：unpublish 后 72 小时内不能用同名同版本号重新发布。因为旧包要彻底抛弃，不受影响。
- **回滚**：如果新包发布失败，`git checkout` 恢复三处文件即可。旧包 unpublish 前可以继续用。

## 6. 测试要点

- [ ] `npm run build` 通过
- [ ] `npm test` 通过
- [ ] 新包在 npm 网站可见：`https://www.npmjs.com/package/@waffo/openclaw-plugin`
- [ ] 旧包 npm 页面显示 deprecated 标记，提示迁移到 `@waffo/openclaw-plugin`
- [ ] `npx -p @waffo/openclaw-plugin pancake-setup` 本地 smoke test 能跑通

## 7. 后续（本次不做）

- Linear 同步：提交后按全局规范创建 `[PRD] npm scope 迁移` Issue
- 如果后续公司统一用 `@waffo/*` scope，其他相关仓库也考虑同样迁移

## 8. 实现摘要（与原 PRD 的差异）

- **旧包处理方式从 unpublish 改为 deprecate**（见变更记录第 2 条）
- **`package.json` 额外变更**：`npm publish` 发出 bin 路径 warning（`"./bin/xxx.mjs"` 不规范），执行 `npm pkg fix` 自动移除 `./` 前缀为 `"bin/xxx.mjs"`，功能无变化。
- **最终执行的命令**：
  - `npm publish --access public` → 发布 `@waffo/openclaw-plugin@0.3.9`
  - `npm deprecate '@waffo-pancake/openclaw-plugin@*' 'Package moved to @waffo/openclaw-plugin. Please update your dependency.'` → 旧包 12 个版本全部 deprecated
- **验证结果**：
  - `npm view @waffo/openclaw-plugin` → name=@waffo/openclaw-plugin, version=0.3.9
  - `npm view @waffo-pancake/openclaw-plugin@0.3.9 deprecated` → 返回迁移提示
