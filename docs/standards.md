# Career Explorer - 开发标准

## 1. 代码风格

- TypeScript 严格模式
- 组件使用默认导出，工具函数使用具名导出
- 客户端组件加 `"use client"` 指令
- API 路由使用 `NextRequest` / `NextResponse`
- 中文 UI，注释可不写或写英文
- 禁止空 `catch {}`，至少加 `console.error` 或用户错误提示

## 2. Git 分支策略

采用 **main + dev + release + hotfix** 分支模型。

| 分支 | 用途 | 来源 | 目标 |
|---|---|---|---|
| `main` | 稳定发布分支，只存放已发布版本 | release / hotfix | - |
| `dev` | 日常开发集成分支，所有功能 PR 的默认目标 | `main` / 功能分支 | `release/vX.Y.Z` |
| `release/vX.Y.Z` | 版本发布线，只做发版准备和发布修复 | `dev` | `main` |
| `hotfix/xxx` | 生产紧急修复 | `main` | `main`，随后回流 `dev` |
| `feat/`、`fix/`、`refactor/` | 功能、修复、重构分支 | `dev` | `dev` |

### 分支命名

| 前缀 | 用途 | 示例 |
|---|---|---|
| `feat/` | 新功能 | `feat/admin-dashboard` |
| `fix/` | Bug 修复 | `fix/issue-15-path-traversal` |
| `refactor/` | 重构 | `refactor/admin-split` |
| `release/` | 版本发布线 | `release/v2.0.0` |
| `hotfix/` | 生产紧急修复 | `hotfix/v2.0.1-login-error` |

### 分支规则

- 功能分支必须从 `dev` 切出，PR 回 `dev`
- `main` 只接受 `release/vX.Y.Z` 或 `hotfix/xxx` 的 PR
- `release/vX.Y.Z` 只接受发版所需变更：
  - 已进入 `dev` 且计划纳入该版本线的修复、依赖更新或其他变更
  - 版本号更新
  - `CHANGELOG.md`
  - 发布前修复
  - 发布相关文档
- 同一版本线共用一条 `release/vX.Y.Z` 分支：
  - `v2.0.0-beta.1`
  - `v2.0.0-beta.2`
  - `v2.0.0-rc.1`
  - `v2.0.0`

  这些都是 tag，不单独创建 release 分支。
- 正式版发布前保留 `release/vX.Y.Z`，用于继续发 beta / rc。
- 正式版发布并回流 `dev` 后，release 分支可以保留为历史，也可以删除；发布点由 tag 保留。

## 3. Git 提交规范

提交格式：

```text
<type>: <English description>
```

type 取值：

| type | 用途 |
|---|---|
| `feat` | 新功能 |
| `fix` | 修复 bug |
| `refactor` | 重构，不改变外部行为 |
| `chore` | 工具链、配置、依赖、发版 |
| `docs` | 文档 |
| `test` | 测试 |

示例：

```text
feat: add data dashboard visualization panel
fix: prevent path traversal in /api/uploads
refactor: split admin page into tab components
chore: release v2.0.0-beta.2
```

**签名要求：**

- 所有 commit 必须 GPG 签名
- commit 描述必须使用纯英文，不混用中文
- 推荐配置：

```bash
git config --global commit.gpgsign true
```

## 4. PR 规范

### 常规功能 / 修复 PR

- 目标分支：`dev`
- 合并方式：**Create a merge commit**
- 不使用 squash，除非 PR 内是草稿式多次修正提交
- 不使用 rebase merge，避免签名失效

### 发布 PR

- 目标分支：`main`
- 来源分支：`release/vX.Y.Z`
- 合并方式：**Create a merge commit**
- 必须保留 release commit 和 merge commit

### Hotfix PR

- 目标分支：`main`
- 来源分支：`hotfix/xxx`
- 合并方式：**Create a merge commit**
- 合并后必须回流 `dev`

### PR 标题

- 常规功能 / 修复 PR：与 commit 格式一致，如 `fix: prevent path traversal (#15)`
- 发布 PR：`Release vX.Y.Z-beta.N` 或 `Release vX.Y.Z`
- Hotfix PR：与 commit 格式一致，并在标题中带上 Issue 编号（如有）

### PR Body 标准结构

推荐使用以下结构：

```markdown
## Summary

- 概括本 PR 做了什么

## Changes

- 分模块列出主要变更

## Validation

- [ ] `npm test`
- [ ] `npm run build`
- [ ] CI / CodeQL 通过

## Related Issues

- Closes #xx

## Notes

- 需要 reviewers 特别关注的内容
```

发布 PR 还应包含：

```markdown
## Release

- Tag: `vX.Y.Z`
- GitHub Release: 链接
```

## 5. Issue 管理

- Issue 标题保留可选的优先级前缀，例如 `[P1-A] 管理后台操作审计日志`
- 类型、优先级和业务领域通过 `type:*`、`priority:*`、`area:*` Label 表达
- Issue 编写、脱敏、Milestone 和验收标准遵循 `docs/issue-standard.md`
- PR 合并到 `dev` 后手动关闭 Issue
- dev 合并到 main 的发布 PR 中可再次写 `Closes #xx` 作为备份

## 6. 版本发布流程

### 6.1 版本号标准

遵循 SemVer：

```text
主版本.次版本.修订号
```

预发布版本：

```text
X.Y.Z-beta.1
X.Y.Z-beta.2
X.Y.Z-rc.1
```

示例：

```text
2.0.0-beta.1
2.0.0-beta.2
2.0.0-rc.1
2.0.0
```

### 6.2 Release 分支生命周期

1. 功能集在 `dev` 收官
2. 从 `dev` 切出 `release/vX.Y.Z`
3. 在 release 分支上完成版本号、CHANGELOG、测试和发版修复
4. 发布后续 beta / rc 前，把 `dev` 上计划纳入该版本线的变更同步到 release 分支：
   - 整批纳入时合并 `dev`
   - 选择性纳入时 cherry-pick 对应提交
5. 依次打出预发布 tag：
   - `vX.Y.Z-beta.1`
   - `vX.Y.Z-beta.2`
   - `vX.Y.Z-rc.1`
6. 最终打出正式 tag：
   - `vX.Y.Z`
7. 每个 tag 都通过 PR 合并到 `main`
8. 合并后立即把 `main` 回流到 `dev`：
   - `dev` 未领先时，fast-forward 到 `main`
   - `dev` 已领先时，创建 merge commit

### 6.3 发版步骤

以 `vX.Y.Z-beta.N` 为例：

```bash
# 1. 从 dev 切出 release 分支；已存在时切换并同步 dev 变更
git switch dev
git pull --ff-only
git switch -c release/vX.Y.Z

# 若 release/vX.Y.Z 已存在：
# git switch release/vX.Y.Z
# git pull --ff-only
# git merge dev   # 或 cherry-pick 计划发布的提交

# 2. 更新版本号
npm version X.Y.Z-beta.N --no-git-tag-version

# 3. 更新 CHANGELOG.md

# 4. 验证
npm test
npm run build

# 5. 创建签名提交
git add package.json package-lock.json CHANGELOG.md
git commit -S -m "chore: release vX.Y.Z-beta.N"

# 6. 创建并验证签名 annotated tag
git tag -s -a vX.Y.Z-beta.N -m "Career Explorer vX.Y.Z-beta.N"
git tag -v vX.Y.Z-beta.N

# 7. 推送分支和 tag
git push -u origin release/vX.Y.Z
git push origin vX.Y.Z-beta.N

# 8. 创建 GitHub Release
gh release create vX.Y.Z-beta.N \
  --title "vX.Y.Z-beta.N" \
  --prerelease \
  --generate-notes

# 9. 开 PR 到 main
gh pr create --base main --head release/vX.Y.Z \
  --title "Release vX.Y.Z-beta.N"
```

正式版发布时：

- 去掉 `--prerelease`
- tag 使用 `vX.Y.Z`
- commit message 使用 `chore: release vX.Y.Z`
- 合并后执行：

```bash
git switch dev
git pull --ff-only
git merge --no-edit main
git push
```

说明：`dev` 可以 fast-forward 时会直接前进到 `main`；已分叉时会生成 merge commit。

### 6.4 Hotfix 流程

以下用 `X.Y.W` 表示补丁版本递增后的新版本，例如 `2.0.0 -> 2.0.1`。

```bash
# 1. 从 main 切出 hotfix 分支
git switch main
git pull --ff-only
git switch -c hotfix/vX.Y.W-short-description

# 2. 修复问题并验证
npm test
npm run build

# 3. 如需发新版本，更新版本号和 CHANGELOG
npm version X.Y.W --no-git-tag-version

# 4. 签名提交并打 tag
git add package.json package-lock.json CHANGELOG.md
git commit -S -m "fix: ..."
git tag -s -a vX.Y.W -m "Career Explorer vX.Y.W"
git tag -v vX.Y.W

# 5. 推送并 PR 到 main
git push -u origin hotfix/vX.Y.W-short-description
git push origin vX.Y.W

# 6. 合并后回流 dev
git switch dev
git pull --ff-only
git merge --no-edit main
git push

# 7. 如 release/vX.Y.Z 仍在维护且修复属于该版本线，同步到该分支
```

### 6.5 发布检查清单

- [ ] `package.json` version 与 tag 一致
- [ ] `package-lock.json` 已同步更新
- [ ] `CHANGELOG.md` 覆盖本版本所有变更
- [ ] `npm test` 通过
- [ ] `npm run build` 通过
- [ ] CI 全部通过
- [ ] CodeQL 全部通过
- [ ] commit 已 GPG 签名
- [ ] tag 使用 `git tag -s -a` 并已验证
- [ ] GitHub Release 已创建
- [ ] 预发布版本已勾选 pre-release
- [ ] PR 使用 merge commit 合并
- [ ] 合并后 `main` 已回流 `dev`

## 7. GitHub Release 规范

### 标题

Release 标题必须与 tag 完全一致：

```text
vX.Y.Z-beta.N
vX.Y.Z-rc.N
vX.Y.Z
```

### 正文

优先使用 GitHub 自动生成的标准格式：

```markdown
## What's Changed

* PR 标题 by @user in PR 链接
...

## New Contributors

* @user made their first contribution in PR 链接

**Full Changelog**: compare 链接
```

要求：

- 预发布版本必须勾选 **Set as a pre-release**
- 正式版不勾选 pre-release
- tag 与 Release 一一对应
- 不手写营销式说明替代标准变更列表
- 可在自动生成内容后补充关键说明，但不得删除标准结构

## 8. Pre-commit Hooks

配置 husky + lint-staged，提交前自动对 `.ts` / `.tsx` 运行 `eslint --fix`。

建议提交前手动执行：

```bash
npm run build
```

## 9. CI

GitHub Actions 在 `main` / `dev` 的 push 和 PR 上自动运行：

1. `npm ci`
2. `npm run lint`
3. `npm test`
4. `npm run build`

CI workflow 遵循最小权限原则：

```yaml
permissions:
  contents: read
```

## 10. 变更解耦原则

大型重构必须遵循：

1. **单一关注点** - 每个 commit 只做一件事
2. **独立可构建** - 每个 commit 必须能通过 `npm run build`
3. **独立可回退** - 每个 commit 必须能单独 `git revert`
4. **先迁移后改造** - 路由重组和逻辑变更分开提交
5. **向后兼容过渡** - 新旧路由/API 可短暂并存，确认稳定后再删除旧路径

## 11. 环境变量

| 变量 | 说明 |
|---|---|
| `JWT_SECRET` | JWT 签名密钥（生产必需；未配置会回退到代码内置的不安全默认值） |
| `FONT_CDN_PREFIX` | 可选：Google Fonts 镜像前缀（构建时生效，如 https://fonts.loli.net） |
| `ALLOWED_ORIGINS` | 仅 dev 模式：Next.js 开发服务器 origin 白名单（逗号分隔），生产无效 |
| `PORT` | 应用端口（Next.js 内置，默认 3000） |

模板文件为 `.env.example`（部署时复制为 `.env.local` 填写）；部署流程见 `DEPLOY.md`。
