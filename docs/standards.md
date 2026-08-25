# Career Explorer — 开发标准

## 代码风格

- TypeScript 严格模式
- 组件使用默认导出，工具函数使用具名导出
- 客户端组件加 `"use client"` 指令
- API 路由使用 `NextRequest` / `NextResponse`
- 中文 UI，注释可不写或写英文
- 禁止空 `catch {}`，至少加 `console.error` 或用户错误提示

## Git 分支策略

采用 **main + dev 双分支策略**：

| 分支 | 用途 |
|---|---|
| `main` | 稳定发布分支，仅接受 dev 合并 |
| `dev` | 日常开发集成分支，所有 PR 目标 |

**工作流：**

```
1. 从 dev 创建特性分支：  git checkout dev && git checkout -b fix/issue-15-path-traversal
2. 开发完成后提 PR 到 dev：gh pr create --base dev
3. dev 验证稳定后合并到 main：git merge --no-ff dev
4. 在 main 上打 tag 发布：  git tag -s v2.0.0
```

**分支命名：**

| 前缀 | 用途 | 示例 |
|---|---|---|
| `fix/` | Bug 修复 | `fix/issue-15-path-traversal` |
| `feat/` | 新功能 | `feat/admin-dashboard` |
| `refactor/` | 重构 | `refactor/admin-split` |

## Git 提交规范

```
<type>: <中文描述>
```

**type 类型：**

| type | 用途 |
|---|---|
| `feat` | 新功能 |
| `fix` | 修复 bug |
| `refactor` | 重构（不改变功能） |
| `chore` | 工具链、配置、依赖变更 |
| `docs` | 文档 |
| `test` | 测试 |

**示例：**

```
feat: 添加数据大屏可视化面板
fix: 修复 /api/uploads 路径穿越漏洞
refactor: 拆分 admin 巨石页面为 Tab 子组件
chore: TypeScript 升级到 6.0.3
```

**签名：** 所有 commit 必须 GPG 签名（`commit.gpgsign=true`）。

## PR 规范

- **目标分支：** 始终 PR 到 `dev`，不直接 PR 到 `main`
- **合并方式：** 使用 **Create a merge commit**。理由：PR 内 commit 按变更解耦原则原子化（独立可构建、单一主题、GPG 签名），merge commit 保留原子粒度与**签名验证状态**（Squash 压缩丢失粒度、Rebase 重放后签名失效）；代价是 dev 历史存在分叉，对本项目规模可接受。仅当 PR 内为草稿式提交（wip/多次修正）时改用 Squash and Merge 收敛
- **PR body：** 包含修复内容、涉及文件、验收清单，末尾加 `Closes #xx` 关联 Issue
- **PR 标题：** 与 commit 格式一致，如 `fix: 修复路径穿越漏洞 (#15)`

**PR body 模板：**

```markdown
## 修复内容

- **#15**: `/api/uploads/[...path]` 路径穿越防护

### 修改文件

- `src/app/api/uploads/[...path]/route.ts`

### 验收

- [x] `npm run build` 通过
- [x] 正常功能不受影响

Closes #15
```

## Issue 管理

- Issue 标题保留可选的优先级前缀，例如 `[P1-A] 管理后台操作审计日志`；类型不写入标题
- Issue 类型、优先级和业务领域通过现有 `type:*`、`priority:*`、`area:*` Label 表达
- Issue 编写、脱敏、Milestone 和验收标准遵循 `docs/issue-standard.md`
- **关闭时机：** PR 合并到 `dev` 后**手动关闭** Issue（因默认分支是 main，`Closes #xx` 不会自动触发）
- **最终关闭：** dev 合并到 main 的 PR 中统一写 `Closes #xx` 作为备份

## 版本发布流程

遵循 SemVer：`主版本.次版本.修订号`

**发布步骤：**

```bash
# 1. dev 合并到 main
git checkout main
git merge --no-ff dev -m "chore: release v2.0.0"

# 2. 更新版本号
# package.json → "version": "2.0.0"

# 3. 更新 CHANGELOG.md（汇总本版本所有变更）

# 4. 提交版本文件
git add package.json package-lock.json CHANGELOG.md
git commit -m "chore: release v2.0.0"

# 5. 打签名 tag
git tag -s v2.0.0 -m "v2.0.0: 版本描述"

# 6. 推送
git push origin main
git push origin v2.0.0

# 7. 创建 GitHub Release
gh release create v2.0.0 --title "v2.0.0" --notes "变更内容..."
```

**检查清单：**

- [ ] `package.json` version 与 tag 一致
- [ ] `CHANGELOG.md` 覆盖本版本所有 PR
- [ ] Git tag 已签名（`git tag -s`）
- [ ] GitHub Release 已创建（tag 与 Release 一一对应）

## Pre-commit Hooks

配置了 husky + lint-staged，提交前自动对 `.ts` / `.tsx` 运行 `eslint --fix`。建议提交前先手动跑一次 `npm run build`。

## CI

已配置 GitHub Actions，每次 push 到 `main`/`dev` 或 PR 时自动运行：

1. `npm ci`
2. `npm run lint`
3. `npm run build`

CI workflow 遵循最小权限原则：`permissions: contents: read`。

## 变更解耦原则

大型重构必须遵循以下规则，避免回退代价过大：

1. **单一关注点** — 每个 commit 只做一件事。路由迁移、认证改造、功能新增必须分开提交，禁止混合。
2. **独立可构建** — 每个 commit 必须能通过 `npm run build`，不允许存在"半成品"提交。
3. **独立可回退** — 每个 commit 必须能单独 `git revert` 而不破坏系统。commit 之间不能有隐式依赖。
4. **先迁移后改造** — 路由重组（纯路径变更）和认证重构（逻辑变更）分两步做，先验证路由迁移无误再改认证。
5. **向后兼容过渡** — 新旧路由/API 并存一个提交周期，确认新路径稳定后再删除旧路径。

## 环境变量

| 变量 | 说明 |
|---|---|
| `JWT_SECRET` | JWT 签名密钥（生产必需；未配置会回退到代码内置的不安全默认值） |
| `FONT_CDN_PREFIX` | 可选：Google Fonts 镜像前缀（构建时生效，如 https://fonts.loli.net） |
| `ALLOWED_ORIGINS` | 仅 dev 模式：Next.js 开发服务器 origin 白名单（逗号分隔），生产无效 |
| `PORT` | 应用端口（Next.js 内置，默认 3000） |

模板文件为 `.env.example`（部署时复制为 `.env.local` 填写）；部署流程见 DEPLOY.md。
