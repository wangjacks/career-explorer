# Career Explorer - 开发标准

## 1. 代码风格

- TypeScript 严格模式
- 组件使用默认导出，工具函数使用具名导出
- 客户端组件加 `"use client"` 指令
- API 路由使用 `NextRequest` / `NextResponse`
- 中文 UI，注释可不写或写英文
- 禁止空 `catch {}`，至少加 `console.error` 或用户错误提示

## 2. Git 分支策略

采用 **GitHub Flow**：`main` 是唯一长期分支，始终可发布；所有变更通过短命分支 + Pull Request 合入 `main`，发布用签名 tag 表示。

| 分支 | 用途 | 来源 | 目标 |
|---|---|---|---|
| `main` | 唯一长期分支，始终可发布 | 短命分支 / Dependabot | - |
| `feat/`、`fix/`、`refactor/`、`docs/`、`chore/`、`hotfix/` | 单次变更的短命分支 | `main` | `main` |
| `release/vX.Y.Z`（可选） | 发布冻结线，仅按需创建 | 发布 tag | 删除，不回流 |

### 分支命名

| 前缀 | 用途 | 示例 |
|---|---|---|
| `feat/` | 新功能 | `feat/admin-dashboard` |
| `fix/` | Bug 修复 | `fix/issue-15-path-traversal` |
| `refactor/` | 重构 | `refactor/admin-split` |
| `docs/` | 文档与规范变更 | `docs/413-issue-title-guidelines` |
| `chore/` | 依赖、构建与发版准备 | `chore/release-v3.2.0` |
| `hotfix/` | 生产紧急修复 | `hotfix/login-error` |
| `release/` | 仅按需的发布冻结线 | `release/v3.2.0` |

### 分支规则

- 所有短命分支从 `main` 切出，PR 回 `main`；合并后删除分支
- `main` 必须始终通过 CI 且可发布；PR 合入即视为进入可发布状态
- 未完成的功能不要合入 `main`（本仓库暂未引入功能开关）
- 发布不使用长期 release 分支：发布点是签名 tag
- 只有需要多日冻结时才从发布 tag 切 `release/vX.Y.Z`：
  - 只接受发布阻塞修复，不接收新功能
  - 修复必须先合入 `main`，再 cherry-pick 到该分支；禁止反向 merge
  - 正式版发布后删除该分支
- 历史说明：`dev` 已于 2026-11 撤销；历史文档与旧 issue 中出现的 `dev` 均指当时的集成分支

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

- commit 必须在 GitHub 显示 **Verified**：本地 GPG/SSH 签名，或 GitHub 网页端操作（自动签名）均可
- 本地签名时，GPG/SSH 公钥须已添加到 GitHub 账户，否则不显示 Verified
- 所有 tag 必须签名（annotated tag：`git tag -s -a`）
- commit 描述必须使用纯英文，不混用中文
- 推荐配置：

```bash
git config --global commit.gpgsign true
```

## 4. PR 规范

### 常规功能 / 修复 PR

- 目标分支：`main`
- 合并方式：**Create a merge commit**
- 不使用 squash，除非 PR 内是草稿式多次修正提交
- 不使用 rebase merge，避免签名失效

### 发布 PR

- 目标分支：`main`
- 来源分支：`chore/release-vX.Y.Z`
- 合并方式：**Create a merge commit**
- tag 在 PR 合并后打在 `main` 的 merge commit 上

### Hotfix PR

- 目标分支：`main`
- 来源分支：`hotfix/xxx`
- 合并方式：**Create a merge commit**
- 合并后在 merge commit 上打补丁 tag

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

- Issue 标题使用描述性问题或结果描述，不写优先级、领域或类型前缀；具体规则见 `docs/issue-standard.md` §1
- 类型、优先级和业务领域通过 `type:*`、`priority:*`、`area:*` Label 表达
- Issue 编写、脱敏、Milestone 和验收标准遵循 `docs/issue-standard.md`
- PR 关联 Issue 使用 `Closes #xx`；`main` 是默认分支，合并后自动关闭

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

### 6.2 发布模型

- `main` 始终可发布；发布点由签名 tag 和 GitHub Release 表示
- 默认不创建 release 分支
- beta / rc 用预发布 tag 表示，同样落在 `main` 上
- 只有需要多日冻结时才按需切 `release/vX.Y.Z`，规则见 §2

### 6.3 发版步骤

以 `vX.Y.Z` 为例；beta / rc 把版本号换成 `X.Y.Z-beta.N` / `X.Y.Z-rc.N`，并在创建 Release 时加 `--prerelease`。

```bash
# 1. 从 main 切出发布准备分支
git switch main
git pull --ff-only
git switch -c chore/release-vX.Y.Z

# 2. 更新版本号
npm version X.Y.Z --no-git-tag-version

# 3. 更新 CHANGELOG.md

# 4. 验证
npm test
npm run build

# 5. 创建签名提交
git add package.json package-lock.json CHANGELOG.md
git commit -S -m "chore: release vX.Y.Z"

# 6. 推送并开 PR 到 main
git push -u origin chore/release-vX.Y.Z
gh pr create --base main --head chore/release-vX.Y.Z \
  --title "Release vX.Y.Z"

# 7. 合并后立即在 merge commit 上打签名 tag
#    若 main 已经前进，把 HEAD 换成该 PR 的 merge commit SHA
git switch main
git pull --ff-only
git tag -s -a vX.Y.Z -m "Career Explorer vX.Y.Z"
git tag -v vX.Y.Z
git push origin vX.Y.Z

# 8. 创建 GitHub Release
gh release create vX.Y.Z \
  --title "vX.Y.Z" \
  --generate-notes
```

### 6.4 Hotfix 流程

以下用 `X.Y.W` 表示补丁版本递增后的新版本，例如 `3.1.0 -> 3.1.1`。

```bash
# 1. 从 main 切出 hotfix 分支
git switch main
git pull --ff-only
git switch -c hotfix/vX.Y.W-short-description

# 2. 修复并验证
npm test
npm run build

# 3. 更新版本号和 CHANGELOG
npm version X.Y.W --no-git-tag-version

# 4. 签名提交并推送
git add package.json package-lock.json CHANGELOG.md
git commit -S -m "fix: ..."
git push -u origin hotfix/vX.Y.W-short-description

# 5. 开 PR 到 main，以 merge commit 合并

# 6. 合并后立即在 merge commit 上打签名 tag 并创建 Release
git switch main
git pull --ff-only
git tag -s -a vX.Y.W -m "Career Explorer vX.Y.W"
git tag -v vX.Y.W
git push origin vX.Y.W
gh release create vX.Y.W --title "vX.Y.W" --generate-notes
```

如果生产仍停在旧 tag 而 `main` 已经前进，需要只修旧版本线：从旧 tag 切短命 `release/vX.Y.W`，修复先合 `main` 再 cherry-pick 到该分支，发布后删除；不要反向 merge。

### 6.5 发布检查清单

- [ ] `package.json` version 与 tag 一致
- [ ] `package-lock.json` 已同步更新
- [ ] `CHANGELOG.md` 覆盖本版本所有变更
- [ ] `npm test` 通过
- [ ] `npm run build` 通过
- [ ] CI 全部通过
- [ ] CodeQL 全部通过
- [ ] commit 在 GitHub 显示 Verified
- [ ] PR 以 merge commit 合并，tag 打在 `main` 的 merge commit 上
- [ ] tag 已签名（`git tag -s -a`）并已验证
- [ ] GitHub Release 已创建
- [ ] 预发布版本已勾选 pre-release
- [ ] 生产已按 tag 部署并完成冒烟

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

GitHub Actions 在 `main` 的 push 和 PR 上自动运行：

1. `npm ci`
2. `npm run lint`
3. `npm test`
4. `npm run build`

CI workflow 遵循最小权限原则：

```yaml
permissions:
  contents: read
```

> **CodeQL 来源**：代码扫描由 GitHub 仓库设置侧的**默认代码扫描（default setup）**提供，不在 `.github/workflows/ci.yml` 内，仓库中也没有 CodeQL workflow 文件。发布检查清单与 PR 模板里的「CodeQL 通过」指该扫描在 PR 上的结果。

## 10. 变更解耦原则

大型重构必须遵循：

1. **单一关注点** - 每个 commit 只做一件事
2. **独立可构建** - 每个 commit 必须能通过 `npm run build`
3. **独立可回退** - 每个 commit 必须能单独 `git revert`
4. **先迁移后改造** - 路由重组和逻辑变更分开提交
5. **向后兼容过渡** - 新旧路由/API 可短暂并存，确认稳定后再删除旧路径

## 11. 环境变量

<!-- 对账：本表是环境变量的唯一权威，键集合须与 .env.example 一致（S3 为按后端 ID 展开的模式，模板中以注释示例给出；`PORT` 为例外——它不能写在 .env 文件中，故只在本表登记，不进模板） -->

| 变量 | 说明 |
|---|---|
| `JWT_SECRET` | JWT 签名密钥（生产必需；未配置会回退到代码内置的不安全默认值） |
| `FONT_CDN_PREFIX` | 可选：Google Fonts 镜像前缀（构建时生效，如 https://fonts.loli.net） |
| `APP_PUBLIC_URL` | 站点公网地址，班级邀请海报二维码的链接基址（#102）。**生产必需**：Next 未开启 `experimental.trustHostHeader`，`request.url` 的 host 取进程绑定地址而非 `Host` 头，`next start` 无 `-H` 时恒为 `localhost`，反向代理下无法从请求推导真实域名；而 `Host` / `X-Forwarded-Host` 可被客户端伪造（钓鱼域名会直接印进海报），故不作为可信来源。缺失或非法（须为含协议的站点根地址、不得指向 localhost/127.0.0.1/0.0.0.0/::1）时 `GET /api/manage/classes/[id]/poster` 返回 503 与中文原因（#148）。仅非生产模式回退请求 origin。不带 `NEXT_PUBLIC_` 前缀，不会被 Next.js 构建时内联，运行时读取，改后重启进程即生效、无需重新构建（#196） |
| `NEXT_PUBLIC_GEETEST_CAPTCHA_ID` | 可选：极验行为验证验证 ID（#155），登录页与激活页第一步前端初始化使用；与 `GEETEST_PRIVATE_KEY` 必须同时配置，公开值 |
| `GEETEST_PRIVATE_KEY` | 可选：极验行为验证私钥（#155），仅服务端生成 `sign_token` 使用；不提交仓库、不写入日志。两者缺失或极验不可达时按 fail-open 降级放行并记 `auth:captcha-degraded` 审计 |
| `S3_{后端ID}_ACCESS_KEY` | 可选：对象存储凭据（#111），`{后端ID}` 为管理面板「系统设置 → 存储管理」创建后端后返回的 ID（对应 `storage_backends.id`）；凭据不入库 |
| `S3_{后端ID}_SECRET_KEY` | 可选：同上，Secret Key / SecretKey |
| `ALLOWED_ORIGINS` | 仅 dev 模式：Next.js 开发服务器 origin 白名单（逗号分隔），生产无效 |
| `DEMO_ENABLED` | 可选：演示沙箱总开关（#250）。值为 `"true"` 时进程内多开一个独立 SQLite 演示库（路径见 `DEMO_DB_PATH`），带 `demo` claim 的 token 其全部 DB 访问经 `AsyncLocalStorage` 请求级作用域改道到演示库，与生产库**物理隔离**（`ensureInit()` 依作用域选择 adapter）。未设置或非 `"true"` 时整套演示能力不存在，且演示作用域内访问 DB 直接抛错（fail-safe，绝不回落生产库）。运行时读取、改后重启进程生效；刻意**不放入 `db-config.json`**，避免经 settings API 暴露或被 PUT 覆盖。演示登录/播种/文件目录隔离分别见 #252/#253 |
| `DEMO_DB_PATH` | 可选：演示库 SQLite 文件路径（#250），默认 `./data/career-demo.db`。须落在 `process.cwd()` 或系统临时目录内（由 `SqliteAdapter` 的 `sanitizeSqlitePath` 校验，越界拒绝）。仅 `DEMO_ENABLED=true` 时生效 |
| `UPLOADS_DIR` | 可选：本地存储根目录（相对 `process.cwd()`，默认 `uploads`，#253 S1）。演示作用域下本地读写/serve/media 扫描一律经 `getUploadsBaseDir()` 落到 `<UPLOADS_DIR>/demo/`，与生产上传物理隔离。生产部署一般无需设置；主要供集成测试隔离 uploads 根、避免并发用例互清 `uploads/demo`。改此目录即改全部本地落盘/读取位置（单一真源），无需再动其它处 |
| `PORT` | 应用端口（Next.js 内置，默认 3000）。**只能在进程环境中设置**（如 `PORT=<端口> pm2 restart <应用名>`）或用 `next start -p <port>`；写入 `.env.local` 无效——HTTP server 绑定端口早于 env 文件加载。应用代码不读取此变量 |

模板文件为 `.env.example`（部署时复制为 `.env.local` 填写）；新增或改名环境变量时，本表与 `.env.example` 必须同步修改（`PORT` 除外，见上表说明）。部署流程与云存储端点配置见 `DEPLOY.md`。
