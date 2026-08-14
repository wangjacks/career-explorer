# Issue 编写标准规范

本文档定义了本项目 GitHub Issue 的编写标准，供所有 Agent 和协作者遵循。

---

## 1. 标题格式

```
[优先级-编号][类型] 简要描述
```

### 优先级

| 前缀 | 含义 | 示例 |
|------|------|------|
| `P0` | 阻塞性 Bug，功能完全不可用 | `[P0-A]` |
| `P1` | 高优先级，影响核心功能 | `[P1-B]` |
| `P2` | 中优先级，体验优化/代码质量 | `[P2-C]` |

编号为同优先级下的序号（A/B/C...），非必须，简单 Issue 可省略。

### 类型标签（方括号内第二段）

| 标签 | 对应 GitHub Label | 说明 |
|------|---|---|
| `bug` | `bug` | 功能异常/错误 |
| `enhancement` | `enhancement` | 新功能/新需求 |
| `refactor` | `refactor` | 代码重构，不改变外部行为 |
| `security` | `security` | 安全漏洞修复 |

**标题示例：**
- `[P0-A][bug] 管理后台 /admin 访问时 ERR_TOO_MANY_REDIRECTS 无限重定向`
- `[P2-C][refactor] 9 处空 catch {} 至少加日志 / 用户错误提示`
- `[M1-BE][enhancement] 数据大屏后端：扩展 stats API + created_at 索引`
- `[bug] 3 处 DOM text 未转义存在 XSS 风险`

---

## 2. Labels

从项目已有 label 中选择，常用组合：

| Issue 类型 | 推荐 Labels |
|---|---|
| Bug 修复 | `bug` |
| 安全漏洞 | `bug`, `security` |
| 新功能 | `enhancement` |
| 代码重构 | `refactor` |
| 性能优化 | `performance` |
| 需讨论 | `question` |

---

## 3. Milestone

所有纳入版本迭代的 Issue 必须加入对应 milestone（如 `v2.0.0`）。

---

## 4. Body 结构（必须包含以下章节）

### 4.1 背景（必须）

简述问题的上下文或需求的来源。回答"为什么要做这件事"。

```markdown
## 背景

访问管理后台 `/admin` 路由时浏览器报 `ERR_TOO_MANY_REDIRECTS`，管理后台完全无法进入。
```

### 4.2 现状（Bug 类必须，Enhancement 类用"实现目标"替代）

描述当前代码的行为、相关文件位置、问题复现步骤。

```markdown
## 现状

`src/middleware.ts` 的认证逻辑将所有匹配 `/admin/:path*` 的请求重定向到 `/admin/login`：

（代码片段）

**形成无限循环的过程：**
1. 用户访问 `/admin`，没有 cookie
2. Middleware 拦截 → 重定向到 `/admin/login`
3. ...
```

### 4.3 修复方案 / 实现目标（必须）

**Bug 类用"修复方案"**——给出具体的代码修改方向或伪代码：

```markdown
## 修复方案

将 `src/middleware.ts` 改为：
（代码示例）

理由：
- ...
```

**Enhancement 类用"实现目标"**——描述期望的行为、API 结构、目录规划等：

```markdown
## 新增 API

### `GET /api/admin/stats/trends?days=30`
返回近 N 天每日提交数：
（JSON 示例 + SQL）
```

### 4.4 涉及文件（推荐）

列出需要修改的文件及其职责：

```markdown
## 涉及文件

- `src/middleware.ts` — 问题所在，Middleware 认证逻辑
- `src/app/admin/page.tsx` — 管理后台页面
```

### 4.5 验收标准（必须）

用 checkbox 列表，明确可验证的完成条件：

```markdown
## 验收标准

- [ ] 访问 `/admin` 不再出现无限重定向
- [ ] 未登录时调用 `/api/admin/*` 返回 401
- [ ] `npm run lint` + `npm run build` 全绿
```

**验收标准必须包含的兜底项：**
- `npm run lint` + `npm run build` 全绿（所有 Issue 通用）

### 4.6 关联（推荐）

说明与其他 Issue 的依赖关系、所属 Roadmap Phase：

```markdown
## 关联

- v2.0.0 Roadmap P0 阻塞性 Bug
- 依赖 #M2 认证重构
- 与 #M1-FE 前端 issue 配套
```

---

## 5. 完整模板

```markdown
## 背景

（简述问题上下文，回答"为什么做这件事"）

## 现状

（描述当前代码行为、相关文件、复现步骤）

## 修复方案

（给出代码修改方向、伪代码或关键实现思路）

## 涉及文件

- `path/to/file.ts` — 职责说明
- `path/to/other.tsx` — 职责说明

## 验收标准

- [ ] （具体可验证的完成条件 1）
- [ ] （具体可验证的完成条件 2）
- [ ] `npm run lint` + `npm run build` 全绿

## 关联

- v2.0.0 Roadmap Phase X
- 依赖 #XX（说明依赖关系）
```

---

## 6. 质量检查清单

Issue 创建前自查：

- [ ] 标题包含类型标签（`[bug]`/`[enhancement]`/`[refactor]`）
- [ ] 已添加正确的 GitHub Label
- [ ] 已加入对应 Milestone
- [ ] Body 包含「背景」「修复方案/实现目标」「验收标准」三个必须章节
- [ ] 验收标准具体、可验证、非模糊描述
- [ ] 涉及文件已列出（至少 1 个）
- [ ] 如有依赖其他 Issue，已在「关联」中说明

---

## 7. 不同类型 Issue 的变体

### Bug 类

必须有：背景 → 现状（含复现步骤）→ 修复方案 → 验收标准

### Enhancement 类

必须有：背景 → 实现目标（含 API 结构/目录规划/选型说明）→ 验收标准

### Refactor 类

必须有：背景 → 现状（列出问题代码位置）→ 重构方案 → 验收标准

### Security 类

必须有：背景 → 风险描述（含攻击向量）→ 修复方案 → 验收标准
