# Career Explorer — 架构说明

> v2.0.0：三角色统一用户体系（admin / teacher / student）

## 认证体系

- 统一 `users` 表存储三角色账户，bcrypt 哈希密码（`password_hash` 可为 NULL = 未设置密码）
- 登录签发 JWT（jose HS256, 24h，含 role/uid/name），HttpOnly Cookie `auth_token` 传递
- `proxy.ts`（Next.js 16，替代已弃用的 middleware）拦截管理域路由做角色权限校验
- 学生账户由教师导入名单预建（无密码），学生凭学号 + 姓名 + 本班邀请码三要素核验后激活；激活为两步单页（#93）：先 `verify` 核验取回名单姓名，再 `activate` 设置密码并自动登录
- 认证入口人机验证（#155）：`POST /api/auth` 与 `POST /api/auth/activate/verify` 在查库 / 三要素核验**之前**校验极验（GeeTest v4）票据，票据缺失或无效直接 400 并统一返回「请先完成人机验证」，不进入 bcrypt 密码比对；凭证经 `NEXT_PUBLIC_GEETEST_CAPTCHA_ID`（公开，前端初始化）与 `GEETEST_PRIVATE_KEY`（仅服务端生成 `sign_token`）注入，不落库、不入日志
- 人机验证降级策略（#155）：**fail-open，且仅针对服务端不可达**。凭证未配置，或极验校验服务不可达（超时 / 非 200 / 响应不可解析）时放行认证并记 `auth:captcha-degraded` 审计；票据缺失或无效统一返回 400「请先完成人机验证」并记 `auth:captcha-failed`。前端组件脚本被拦截 / 初始化失败时只做本地提示并要求重试——客户端自述「不可用」不可信，静默放行等于给出绕过通道
- 人机验证前端形态（#155）：绑定式（bind，点击提交按钮弹出验证），票据一次性；登录失败或核验失败后前端重置验证码要求重新验证。仅登录页与激活页第一步启用，激活第二步（设置密码）不启用

| 面板 | 路由 | 访问权限 |
|---|---|---|
| 管理面板 | `/dashboard/admin` | admin |
| 教师面板 | `/dashboard/teacher` | teacher |
| 学生面板 | `/dashboard/student` | student |

## 页面路由

<!-- 对账：`find src/app -name page.tsx`（当前 11 个） -->

| 路由 | 说明 |
|---|---|
| `/` | 首页 |
| `/about` | 关于页（学生探索 / 教师管理 / 数据统计三段产品介绍） |
| `/login` | 登录页（三角色统一） |
| `/activate` | 学生账户激活（学号 + 姓名 + 邀请码三要素核验；支持 `?invite=` 二维码预填，仅预填不绕过校验） |
| `/form` | 表单列表（标准化测评入口，#168）；数据源为页内常量空数组，当前仅渲染空态，不接 API |
| `/dashboard/admin` | 管理面板（分组见「面板导航结构」） |
| `/dashboard/teacher` | 教师面板（分组见「面板导航结构」） |
| `/dashboard/student` | 学生面板（我的档案：未提交可就地填写与提交、已提交可就地修改 / 历史提交 #95，两个 Tab；档案内容上方常驻**职业兴趣测评结果区** #224——雷达图 + 条状排名 + 三字码 + 六型解读 + 推荐职业，与档案提交流程解耦） |
| `/dashboard/student/assessment` | 职业测评中心（#222 骨架 + #225 内容卡）：三态状态卡（未开始 / 进行中 / 已完成）+ 测验清单卡 + 霍兰德六型科普卡 + 学职平台外链卡 + 页底「授权与免责」卡（O\*NET 署名 + 免责声明，锚点 `#assessment-attribution`）；结果解读在「我的档案」测评区（#224） |
| `/dashboard/student/assessment/quiz` | 职业兴趣测评答题页（#223）：单题单屏 + 进度条 + Likert 1-5，自动存草稿、可续答，提交前二次确认 |
| `/setup` | 安装引导（首次配置数据库 + 管理员密码） |

## 面板导航结构

<!-- 对账：读 src/app/dashboard/{admin,teacher}/page.tsx 的 MENU_GROUPS 与 src/app/dashboard/student/page.tsx 的 Tab 定义 -->

**管理面板 `/dashboard/admin`** — 三组两级：

| 组 | 项 |
|---|---|
| 数据中心 | 数据概览 / 数据大屏 / 数据导出 / 提交历史（#95） |
| 用户管理 | 学生管理 / 教师管理 / 班级管理 / 标签管理 |
| 系统设置 | 数据源设置 / 功能设置 / 存储管理（#111） / 媒体管理（#117） / 操作审计（#110） |

**教师面板 `/dashboard/teacher`** — 四组：

| 组 | 项 |
|---|---|
| （无组标题） | 主页 |
| 数据中心 | 数据概览 / 数据大屏 / 数据导出 |
| 数据管理 | 数据列表 / 学生管理 / 班级管理 / 标签管理 |
| 系统设置 | 功能设置 / 操作审计（仅本人记录） |

> **主页只负责问候与分流（#228）**：主页 = 品牌 hero（时段问候 + 日期 + 一句引导）+ 按上面三个分组排成的快捷入口卡片网格，**不渲染任何统计数字与班级概览**（统计能力的唯一入口是「数据概览」）。卡片与侧边栏**共用 `page.tsx` 的同一份 `MENU_GROUPS`**（`description` 是卡片的一句话说明，侧边栏不渲染），新增栏目只改这一处；点击卡片即切 Tab，不做路由跳转。

**学生面板 `/dashboard/student`** — 两个 Tab：我的档案（通览 + 就地修改，二次确认）/ 历史提交（#95，懒加载，恢复生成新版本）。侧边栏四项：我的档案 / 职业测评（#222）/ 我的班级（即将上线）/ 成长记录（即将上线）；高亮按路径判定（「我的档案」精确匹配、「职业测评」前缀匹配覆盖答题页），条目与判定规则在 `src/lib/student-nav.ts`。

**学生测评中心 `/dashboard/student/assessment`（#222 骨架 + #225 内容卡）** — 承载入口、状态与说明，结果解读与职业推荐留给「我的档案」测评区（#224）。状态来自 `GET /api/shared/assessment/results`（`current` / `inProgress`），三态判定在 `src/lib/assessment-center.ts`：**进行中 > 已完成 > 未开始**（重测中的草稿优先，旧三字码作为次要信息）；量表停用（`assessment.enabled=false`）时收掉「开始 / 继续作答」入口但历史结果照常展示。

内容卡（#225）从上到下四张，**接口不可用 / 加载失败时也常驻**（学生至少能看到「六型是什么」与「去哪儿做别的测评」）：

- **测验清单卡**：一行一套量表（名称 / 题量 / 预计耗时 / 本人三态 / 是否开放 + 作答入口）。数据由 `buildAssessmentList` 归一——当前接口只返回单套 RIASEC（列表 1 行），接口将来返回 `assessments` 数组时即多行，渲染结构不变。**只有主测评渲染作答入口**（`isPrimary`）：答题页目前只认 RIASEC，预留项显示「即将开放」而不是给一个会进错量表的链接；新增量表要等它自己的答题路由落地后再放开。
- **六型科普卡**：R/I/A/S/E/C 各一段自建通俗介绍（参考 O\*NET 对六类的公开描述改写）+ 2–3 个关键词 + 三条作答提示。**只讲倾向、不做人格判断、不给「适合什么职业」的结论**；文案在 `src/lib/assessment-center-content.ts`，单测锁「六型齐全 + 顺序 R→I→A→S→E→C」。
- **权威渠道外链卡**：学职平台（教育部学信网）的测评入口 / 职业探索 / 平台首页，全部 `target="_blank" rel="noopener noreferrer"`，单测锁「只走 https 且 host 为 `xz.chsi.com.cn`」。**只外链、不复刻其题目**（平台内容版权归官方）。
- **授权与免责卡**：O\*NET 改编署名 + 授权说明 + 授权页外链 + 免责声明。权威文案是 `assessments` 表的授权字段（随 `/results` 下发），前端不复制一份；接口无数据时退化成一段简短来源说明 + 兜底免责声明，保证「结果不作诊断/录用依据」始终可见。免责声明组件 `AssessmentDisclaimer` 与「我的档案」测评区**共用**，两边口径只有一处。

版权红线：科普文案只写自建的通俗描述，**不出现 SDS / Strong / MBTI 等商业量表的名称与题面**（单测里有禁用词表，口径见 `docs/plan-assessment.md` 第 2 节）。

## API 路由

<!-- 对账：`find src/app/api -name route.ts | wc -l`（当前 60 条 = manage 41 + auth 3 + setup 3 + shared 10 + tags/upload/uploads 各 1） -->

### 认证层（proxy 之外，公开）

| 路由 | 方法 | 说明 |
|---|---|---|
| `/api/auth` | POST / GET / DELETE | 登录（#155 起需携带极验票据）/ 会话检测 / 登出 |
| `/api/auth/activate/verify` | POST | 激活前置核验（#93 两步激活第一步）：校验学号 + 姓名 + 邀请码三要素，不设置密码；通过时返回名单姓名供第二步问候语展示（#155 起需携带极验票据） |
| `/api/auth/activate` | POST | 学生账户激活（#93 第二步）：三要素核验通过后设置密码并自动登录 |

### 安装层（proxy 之外）

| 路由 | 方法 | 说明 |
|---|---|---|
| `/api/setup` | POST | 安装配置（数据库 + 管理员密码） |
| `/api/setup/status` | GET | 安装状态检查 |
| `/api/setup/test` | POST | 数据库连接测试 |

### 管理域 `/api/manage/*`（proxy 拦截：admin 全放行，teacher 按声明式权限表）

<!-- 对账：路由清单 `find src/app/api/manage -name route.ts`（共 42 条）；teacher 权限列须与 src/proxy.ts 的 TEACHER_ALLOWED 逐条一致 -->

**教师禁止（不在 `TEACHER_ALLOWED`，一律 403）**

| 路由 | 方法 | 说明 |
|---|---|---|
| `/api/manage/teachers` | GET / POST | 教师账户列表与新建 |
| `/api/manage/teachers/[id]` | PUT / DELETE | 教师账户改密 / 删除 |
| `/api/manage/settings` | GET / PUT | 数据源配置读写 |
| `/api/manage/backup` | GET / POST | 备份下载 / 恢复 |
| `/api/manage/test-db` | POST | 数据库连接测试 |
| `/api/manage/storage` | GET / POST / PUT / PATCH / DELETE | 存储后端管理（#111）：注册表 CRUD + 设默认，均记审计 |
| `/api/manage/storage/test` | POST | 存储后端连通性测试（#111） |
| `/api/manage/storage/migrate` | POST | 本地→云后端迁移（#111，幂等，已存在对象跳过） |
| `/api/manage/media/status` | GET / PUT | 媒体总览统计 + 孤儿保留期配置（#117，1–365 天） |
| `/api/manage/media/files` | GET | 媒体资源全量列表（#117）：类型/引用状态/学生/文件名筛选 + 分页 |
| `/api/manage/media/orphans` | GET | 孤儿文件分页明细（#117，按孤儿天数降序） |
| `/api/manage/media/orphans/cleanup` | POST | 批量删除孤儿（#117）：按清单（≤500）或 `mode:"all"`，服务端重扫自证 |
| `/api/manage/media/generate-thumbnails` | POST | 存量缩略图补生成（#118，单文件失败不中断） |
| `/api/manage/media/generate-thumbnails/status` | GET | 缩略图缺失检测（#118，只读统计） |
| `/api/manage/profiles/submissions/cleanup` | POST | 手动清理超限历史版本（#95，仅删 DB 记录、文件保留；指定 userId 或一键全量） |

> 媒体治理（`/media/*`）路由内二次校验仅 admin，教师即便前缀放行也拿不到数据。

**教师可用**

| 路由 | 方法 | teacher 权限 | 说明 |
|---|---|---|---|
| `/api/manage/classes` | GET / POST | 全方法 | 班级列表与新建 |
| `/api/manage/classes/[id]` | PATCH / DELETE | 全方法 | 班级改名 / 删除 |
| `/api/manage/classes/[id]/reset-code` | POST | 全方法 | 重置邀请码（旧码即时失效） |
| `/api/manage/classes/[id]/poster` | GET | 全方法 | 班级邀请海报 PNG（#102，`?download=1` 为附件） |
| `/api/manage/students` | GET / POST / PUT / DELETE | 全方法 | 学生名单查询 / 导入 / 修改 / 删除；**写入的班级归属在路由内判定**（#171，见下） |
| `/api/manage/students/batch-password` | POST | 全方法 | 批量重置学生密码（每人生成不同随机密码）；同样受 #171 的班级归属判定 |
| `/api/manage/tags` | GET / POST / PATCH / DELETE | 仅 GET | 预设标签查询；新建 / 改名排序 / 物理删除（分类级联删子标签）只归管理员（#171） |
| `/api/manage/tags/batch` | POST | 前缀随 tags | 标签批量导入 / 批量删除：教师被 proxy 前缀挡下，路由内亦二次拒绝 |
| `/api/manage/tags/restore` | POST | 前缀随 tags | 恢复默认预设（#94，清空后重插，前端二次确认）：仅管理员 |
| `/api/manage/profile-config` | GET / PUT | 仅 GET | 档案功能配置：自定义标签上限（#94）、提交截止时间（#96）、上传大小上限（#111）、历史版本上限（#95）；这些项全站生效，写入只归管理员（#171） |
| `/api/manage/export` | GET / POST | 全方法 | Excel/CSV 导出（XLSX 支持原生单元格图片与浮动图片双模式，默认单元格图片） |
| `/api/manage/export-images` | GET | 全方法 | 图片打包导出（ZIP） |
| `/api/manage/stats` | GET | 仅 GET | 统计汇总 |
| `/api/manage/stats/compare` | GET | 仅 GET | 班级对比：每班在册 / 已提交 / 提交率（#165） |
| `/api/manage/stats/class-roster` | GET | 仅 GET | 班级名册明细（#217）：按班名过滤，返回姓名 / 完整学号（前端脱敏展示）/ 提交状态 / 提交时间 / 标签数；每次查询记审计 |
| `/api/manage/stats/distribution` | GET | 仅 GET | 标签分布 |
| `/api/manage/stats/trends` | GET | 仅 GET | 提交趋势（全校合计，缺日补 0） |
| `/api/manage/stats/class-trends` | GET | 仅 GET | 按班级分层的提交趋势（#165，时间 × 班级交叉维度） |
| `/api/manage/stats/assessment` | GET | 仅 GET | 测评聚合统计（#229）：班级完成度 / 六型计数 / 三字码排行 / 总数小结，**不含任何个人标识**；`?scope=all`（默认，全校）或 `scope=mine`（仅本人归属班级） |
| `/api/manage/assessment/roster` | GET | 仅 GET | 测评名册（#229）：已完测学生的姓名 / 学号 / 三字码 / 完成时间，供下钻；教师恒收窄到本人归属班级（越权 403），每次读取记审计 `assessment:roster` |
| `/api/manage/profiles` | GET / DELETE | GET + DELETE | 档案列表 / 清除档案字段 |
| `/api/manage/profiles/submissions` | GET | GET | 管理端查看学生提交历史（#95）：admin 全量、teacher 仅管辖班级 |
| `/api/manage/profiles/submissions/exceeding` | GET | GET | 超出版本上限的学生列表（#95） |
| `/api/manage/groups` | GET / POST | 全方法 | 课堂分组（#101）：GET 读该班当前分组 + 指标 + 与最近一批的差异（读不限班级）；POST 触发自动分组，**完全覆盖**当前分组并追加一份历史批次归档 |
| `/api/manage/groups/members` | PATCH | 全方法 | 手工换人（#101）：把一个成员移到本班另一个组，允许移入超员组 |
| `/api/manage/groups/entries` | POST / DELETE | 全方法 | 手工建空组 / 删空组（#101）：非空组一律拒绝删除，先移人再删 |
| `/api/manage/groups/batches` | GET | 全方法（实际只读） | 该班历史批次列表（#101，新→旧） |
| `/api/manage/groups/batches/[id]` | GET | 全方法（实际只读） | 单批次明细：批次头 + 各组内聚度快照 + 成员姓名学号快照（#101） |
| `/api/manage/audit-logs` | GET | 仅 GET | 操作审计只读查询（#110；教师强制限本人记录，查询自身也被审计） |

> 分组（`/api/manage/groups*`）前缀整体放行给教师，**班级归属在路由内判定**（`canModifyClass`）：教师可看任意班的分组，但只能触发/调整自己带的班；被拒的写操作同样落审计（`status:"failed"`）。

> 学生写入（`/api/manage/students*`）前缀整体放行给教师，**归属在路由内判定**（#171，`WriteGuard`）：学生以其当前 `class_id` 落在教师关联班级内为准，未分班学生（`class_id` 为 NULL）只有管理员能维护；转班要求来源与目标班级都在管辖范围内；批量导入/删除/重置密码任一行的目标班级或在册学生越界则**整批拒绝**，不留半写状态。教师面板仍可读到全校名单（既定设计）。

> 全站生效的配置（预设标签、`profile-config`）写入只归管理员（#171）：proxy 权限表按方法收敛到 GET，路由内再用 `WriteGuard.canWriteGlobal` 二次拒绝；教师面板以 `readOnly` 呈现这两个 Tab。

> 前缀匹配特性：`/api/manage/export` 覆盖 `export-images`；`/api/manage/profiles` 的 GET+DELETE 覆盖 submissions 子路由的 GET，但 `submissions/cleanup` 是 POST，教师被拒。
>
> 数据范围：`/api/manage/stats/*` 只做角色放行，不按班级裁剪，教师与管理员读到同一份全校数据（#165 的决策，界面已在面板标题与各卡片标注，非缺陷）。
>
> **#229 测评统计的两层范围**：聚合 `/stats/assessment` 沿用上面这条口径（默认全校，`scope=mine` 才收窄到本人归属班级）；**个人明细 `/assessment/roster` 例外**——它是全仓唯一把测评结果与姓名学号放在一起的端点，教师恒为本人归属班级（`classId` 越权直接 403），并每次读取记审计。两者的取舍见「教师端测评统计（#229）」。

### 共享域 `/api/shared/*`（不进 proxy，路由自鉴权）

| 路由 | 方法 | 说明 |
|---|---|---|
| `/api/shared/profile` | GET / POST | GET 会话查询本人档案（含提交截止状态，#96）；POST 仅学生本人会话保存（拒绝显式指定学号；超过提交时限强制 403），每次保存生成一个历史版本 |
| `/api/shared/profile/submissions` | GET | 学生本人历史提交列表（#95，按版本倒序返回完整快照元数据） |
| `/api/shared/profile/submissions/restore` | POST | 学生恢复历史版本（#95）：截止后 403 → 校验版本归属 → 生成新版本（不回写旧记录）→ 审计 `profile:restore` |
| `/api/shared/group` | GET | 学生读本组名单（#101）：只返回**本人所在组**的成员（姓名/学号/头像引用/标签），不提供遍历班级的接口；未分组返回 `grouped:false` |
| `/api/shared/storage-sign` | GET | 文件访问地址签发（#111）：本地后端回显代理路径；云后端按归属记录的 `storage_id` 签发 30 分钟签名 URL；权限校验：学生仅本人与**同组同学的头像**（#101，词云不放行、非同组 403）、教师仅管辖班级、管理员全量 |
| `/api/shared/assessment/start` | GET | 进入答题页（#223）：下发题面（不含维度，避免暗示答案）+ 量表元信息（署名/授权/免责）+ 草稿进度与续答落点；**只读，不建草稿行** |
| `/api/shared/assessment/answer` | POST | 保存一次作答（#223）：服务端**合并**进 `status=in_progress` 草稿并回进度 + 下一个未答题；非法题号/取值 400，停用量表 403 |
| `/api/shared/assessment/submit` | POST | 提交作答（#223）：未答完 400（回带 `missingIndexes`）→ 复用 #220 引擎计分 → 结果快照落库（`is_current` 唯一，重复提交生成新版本）→ 审计 `assessment:submit` |
| `/api/shared/assessment/results` | GET | 结果查询（#223）：当前有效结果 + 最近 10 个历史版本 + 进行中进度，供「我的档案」测评区（#224）与测评中心（#222）消费；量表元信息带 `enabled`（停用时测评中心收掉作答入口，历史结果仍可读）；只按会话 uid 读取，**无 userId 参数**，因此没有越权读他人结果的路径 |
| `/api/shared/assessment/careers` | GET | 本人最新霍兰德结果 → Top-N 推荐职业（#226）：只认会话 uid（显式传别人的 `user_id` 直接 403，非学生 403），`?limit=1–20`（非法值 400），返回推荐列表 + O*NET 署名与快照版本；没完成测评 404、结果里既无六维分也无三字码 409、职业库为空 503 |

### 其他开放端点（proxy 之外）

| 路由 | 方法 | 说明 |
|---|---|---|
| `/api/tags` | GET | 预设标签 + 自定义标签上限（#94）+ 提交截止状态（#96）加载（学生面板与标签着色复用） |
| `/api/upload` | POST | 文件上传（头像 / 评价词云图；#111 起按默认后端路由 + 服务端压缩 + 大小上限 + SVG 拒绝） |
| `/api/uploads/[...path]` | GET | 静态文件服务（本地后端的代理路径，含路径穿越防护） |

## 数据库

<!-- 对账：`grep -oE "CREATE TABLE IF NOT EXISTS \`?[a-z_]+" src/lib/db-sqlite.ts src/lib/db-mysql.ts`；两适配器表集合必须一致（当前 17 张） -->

十七张表，SQLite / MySQL 双适配器实现同一 `DbAdapter` 接口（`src/lib/db.ts`）。权威定义在两适配器的 `CREATE TABLE`，本表为索引：

| 表 | 用途 | 引入 | 纳入备份 |
|---|---|---|---|
| `users` | 统一用户表（三角色）：`user_code`（学生 12 位 / 教师 8 位 / 管理员 5 位，兼登录标识）、`password_hash`（NULL = 未设置）、`role`、`name`、`class_id`（仅学生）、`tags`（#94 起为标签名称文本数组）、`avatar_url`、`evaluation_url`、`submitted_at`、`storage_id`（#111 文件级路由） | v2.0.0 | ✅（含 `password_hash`） |
| `classes` | 班级：`name`、`invitation_code`（唯一） | v2.0.0 | ✅ |
| `teacher_classes` | 教师-班级多对多关联 | v2.0.0 | ✅ |
| `tags` | 预设二级标签：`type`（category/tag）、`parent_id` 层级、`class_id=0` 为全局；#94 起降级为表单预设项，物理删除（分类级联删子标签），`active` 列保留但不再操作 | v2.0.0 | ✅ |
| `configs_profile` | 档案功能配置键值表：`max_custom_tags`(#94)、`submission_deadline`(#96)、`max_avatar_size_mb` / `max_evaluation_size_mb`(#111)、`max_profile_submissions`(#95)、`media_orphan_retention_days`(#117)、`tags_seeded` / `onet_seeded_version`（种子与快照版本标记，见 #226） | #94 | ✅ |
| `audit_logs` | 操作审计（#110）：只追加 + 查询，操作者字段快照冗余，敏感键脱敏剔除、metadata 截断 2000 字符；索引 `created_at` / `actor_id` / `(resource_type, resource_id)` | #110 | ✅ |
| `storage_backends` | 存储后端注册表（#111）：内置本地后端（不可删）+ 多个 S3 兼容实例；凭据不入库（走 `.env.local`）；`name` 唯一 | #111 | ✅（不含凭据） |
| `profile_submissions` | 档案提交历史版本（#95）：`user_id` + `version` + 快照字段（`tags`/`avatar_url`/`evaluation_url`/`storage_id`/`submitted_at`）+ `is_current`；索引 `(user_id, version)`、`(user_id, is_current)` | #95 | ✅ |
| `assessments` | 测评定义（#221）：`code`（唯一，如 `riasec`）、`name`、`question_count`、`dimensions_json`（`[{key,label}]`，顺序即计分与展示顺序）、`scoring_mode`（`typological` 取类型码 / `dimensional` 多维高低分档）、`scale_version`、`attribution`（署名）/ `license_text`（授权与修改声明）/ `disclaimer`（免责声明）、`enabled` | #221 | ✅ |
| `assessment_questions` | 题库（#221）：`assessment_id` + `question_index`（量表内从 1 开始，`UNIQUE`）+ `prompt` + `dimension`（须是 `dimensions_json` 的 key）+ `reverse_scored` + `version`（题面版本，改动时自增） | #221 | ✅ |
| `assessment_results` | 作答与结果**快照**（#221）：`user_id` + `assessment_id` + `status`（`in_progress` 草稿 / `completed` 完成）+ `answers_json` + `scores_json` + `type_code`（三字码，dimensional 量表为 NULL）+ `is_current` + `draft_slot`（草稿位：草稿为 1、完成为 NULL，`UNIQUE(user_id, assessment_id, draft_slot)`）+ `started_at` / `updated_at` / `completed_at` | #221 | ✅（学生个人数据） |
| `onet_occupations` | O*NET 职业库（#226）：`code`（O*NET-SOC，唯一）、`name`（英文 Title）、`name_zh`（首批中文译名，未覆盖为 NULL）、`interest_code`（O*NET 官方兴趣高码 1–3 位）、`interests_json`（六型原始分 1–7）、`job_zone`（2–5：当前发布版把原 1–2 级合并为「Job Zone 1-2」，数据里没有 1）、`education_level`（由 Job Zone 归纳的中文学历）、`cluster`（SOC 大类中文职业群）、`dataset_version` | #226 | ❌（只读参考数据，离线可重灌，避免备份膨胀） |

**课堂分组（#101）五张表 —— 当前态与历史态物理分离**

| 表 | 用途 | 纳入备份 |
|---|---|---|
| `class_groups` | **当前**分组的组：`class_id` + `group_no`，`UNIQUE(class_id, group_no)`；允许空组（教师手工建组先占位再移人） | ✅ |
| `class_group_members` | **当前**分组的成员：`group_id` + `user_id`，`UNIQUE(user_id)` 全局——一个学生同时只能属于一个组，转班/删人必须清理旧行 | ✅ |
| `group_batches` | 历史批次头（每次自动分组追加一条，永不覆盖）：`strategy`、`feature_sources`（本次用到的特征源 key/kind/weight）、`student_count` / `tagged_count`（覆盖率）、`metrics`（含两条基线）、操作者快照 | ✅ |
| `group_batch_groups` | 批次内各组快照：`group_no` + `cohesion`（组内平均相似度）+ `member_count`；**内聚度必须存快照**，标签随时间变，事后算不出当时的质量 | ✅ |
| `group_batch_members` | 批次内成员快照：`user_id` + **冗余的 `user_code` / `name`**，账号删除后历史批次仍可读；因此该列**不建外键**（当前侧 `class_group_members.user_id` 建外键，两侧职责不同） | ✅ |

**班级名匹配口径（#191）**：`classes.name` 的比较统一为 **trim 后全等、区分大小写**，与前端 JS 全等对齐。`getClassByName()` 在两适配器内部均用 `getClasses()` + JS 全等实现（不依赖 SQL 排序规则），确保 SQLite / MySQL / MariaDB 行为恒等；归一化入口为 `resolveClassByName()`（`src/lib/class-utils.ts`），业务层禁止再写 `WHERE name = ?`。

备份格式 `BackupData`（**version 6**，定义在 `src/lib/db.ts`）：十六表全量（`onet_occupations` 是唯一不纳入备份的表），其中 `audit_logs` / `configs_profile` / `storage_backends` / `profile_submissions` / 分组五表 / 测评三表为可选字段（旧备份缺失时读取方容忍 `undefined`）；含 `password_hash`，不含上传文件。

> `onet_occupations`（#226）**不纳入备份**：它是离线快照导出的只读参考数据，重新部署/清表后由 `init()` 按快照重灌即可，没必要让每份备份多背 923 行；它不引用 `users` / `classes`，与下面 #211 的「按 id 引用就整表清空」口径无关。

> **恢复期间的「缺字段」口径（#211 统一）**：`users` / `classes` 是**整表替换并按备份里的原始 `id` 重插**，恢复全程外键检查又是关闭的（SQLite `PRAGMA foreign_keys = OFF` / MySQL `SET FOREIGN_KEY_CHECKS = 0`，事后开启**不回溯校验**已存在的行）。所以规则是：**凡按 `user_id` / `class_id` 引用这两张表的持久表，一律无条件先清空，只有备份带该字段才回填**——「缺字段 = 恢复后该功能无数据」，不是「保留现状」。分组五表（#101）、`profile_submissions`（#95）与 `assessment_results`（#221）都走这条；留着旧行等于把上一个占这个 id 的人的数据交给新的人，而 `GET /api/shared/profile/submissions` 是学生本人可读的。
>
> 两条已接受的副作用：① 清空后历史版本表为空，但**下一次冷启动 `init()` 里的迁移会按恢复后的 `users` 给已提交学生补一条 `version=1 / is_current=1`**，归属取自那条 `users` 行、不会复活别人的数据，所以「无历史版本」只维持到下次启动为止；② 只存在于历史快照里的文件（`avatar_url` / `evaluation_url` 未被当前 `users` 引用的那些）失去最后一条 DB 引用，会进入 #117 孤儿清单——恢复不碰上传文件，孤儿也不自动删，留给人工确认。
>
> 仍保留现状的表：`configs_profile`（键值配置，与身份无关）、`assessments` / `assessment_questions`（参考数据，见下）、`onet_occupations`（#226 只读职业库，离线可重灌，且不引用 `users` / `classes`）、`storage_backends`（缺字段即 #111 之前的备份，其 `users` 行没有可用的 `storage_id`，恢复时回落到内置本地后端；该后端是 `storage_backends` 首行且管理端禁删，编号恒为 1）。`audit_logs` 是唯一**引用了 `users` 却仍保留**的表：**审计记录不可丢**优先于归属洁净，行内已冗余存了操作者编号/姓名/角色，`actor_id` 错配只影响展示归属与教师「只看本人」的过滤范围（该项为后续议题，见 #211）。

> **测评三表的两种处理**：`assessments` + `assessment_questions` 是参考数据，**两字段齐备才整体替换**，缺字段保留现状（可被种子自愈，不会出现「换了定义没换题库」）。`assessment_results` 则**一律先清空**、备份带字段才回填：它只靠数值 `user_id` 关联，而 `users` 恢复时已整表替换，保留旧结果会把甲的结果挂到乙名下（恢复到另一套库的旧备份时尤其明显）——与分组五表的「旧备份恢复后即为未分组」同口径。

## 课堂分组（#101）

<!-- 对账：规模规则与相似度口径见 `src/__tests__/grouping-utils.test.ts`；纯函数在 `src/lib/grouping-utils.ts` / `grouping-features.ts` -->

- **目标函数**：同质聚类——最大化各组内两两相似度之和。全班相似度总和恒定，故「组内最大」等价于「组间最小」，无需另设间组项
- **规模规则**：组数 `g = ⌈n/5⌉`，前 `n mod g` 组各多 1 人（54 人 → 10×5 + 1×4）。`n ≥ 3` 时**不产生 1–2 人组**；`n = 1 / 2` 只有一个组、就是一两个人（不拆分），`n ∈ {6,7,11}` 数学上只能到 3 人组，均属已知取舍
- **相似度**：平滑 IDF 加权的二值余弦，`idf = ln((1+N)/(1+df)) + 1`（scikit-learn `smooth_idf` 口径）。平滑项**不可去掉**：`ln(N/df)` 在 df=N（全班都打同一标签）时退化为 0，会把所有相似度塌成 0、分组退回无意义
- **分配两阶段**：① 容量优先贪心——有特征的学生按「最孤立者优先做种子 → 与当前组最相似者优先入组」；② FM 式交换精修——一轮内连续取当前最优交换（**允许暂时变差**），轮末回到本轮最优快照，只做等量交换所以容量天然守恒。`bestSwap` 的 delta 需要「每个学生 × 每个组」的相似度前缀和，只填自己所在组会让交叉项恒为 0（看似在精修，其实没优化目标）
- **确定性**：输入先按 `user_code` 升序稳定排序，平局按 `user_code`，全流程无随机源；只有对比基线用固定种子（mulberry32，随机基线取 20 次均值）
- **特征源注册表**：算法只认 `FeatureSourceDef {key,label,kind,weight,extract}`，**不碰 `users.tags`**。新增一个数据源 = 往 `FEATURE_SOURCES` 加一条（必要时新增一种 `kind` 的相似度实现），历史批次靠 `group_batches.feature_sources` 记下当时用了哪些源；某源覆盖人数 <2 时自动不参与，不会稀释其他源
- **指标与零信号**：`coveredCount`（有特征的人）/ `nonZeroPairs`（有共同特征的配对数）如实反映信号强弱，两条基线给出「比随机好多少」。全班没标签时不报错、指标为 0，界面显示警告但**不阻断**（开学第一天必然零提交）
- **端点边界**：读不限班级（教师可看全校），写限自建班级；触发自动分组 = **完全覆盖当前分组**（手工调整不可恢复）+ 追加一份历史归档，两步在同一事务内完成
- **学生侧可见性**：`/api/shared/group` 只返回请求者所在组的名单；`/api/shared/storage-sign` 为学生放行**同组同学的头像**（仅此一项，词云不放行），同组判定用单条查询按 `group_id` 比对，避免两次读之间被原子重分组复用组号

## 职业测评数据层（#221）

<!-- 对账：表结构见上「数据库」；题库种子在 `src/lib/assessment-data.ts`，行为测试在 `src/__tests__/assessment-db.test.ts` -->

- **量表进库、不写死代码**：`assessments` 存定义（维度 JSON / 计分类型 / 量表版本 / 署名授权），`assessment_questions` 存题面；首套量表为 O*NET Interest Profiler Mini-IP 30 题中文改编版（RIASEC，6 维各 5 题，原始量表无反向题）。种子由两适配器 `init()` 写入，判定口径是「`code` 不存在 **或** 该量表题库为空」——**非空题库一律不碰**（后台维护过的题面不会被覆盖），空题库（如恢复了一份 `assessment_questions: []` 的备份）会补种并校正 `question_count`，避免留下「可用但 0 题」的量表。坏种子在落库前被 `validateAssessmentSeed` 挡住（题数、题号连续、维度归属、题干非空）
- **题号即作答键**：`question_index` 从 1 连续到 n，作答 JSON 以它为键，故跳号会让「已答 n 题 / 总 n 题」的进度口径失真；`dimension` 必须是 `dimensions_json` 里的 key，且每个维度至少一题（零题维度恒 0 分，会与真实低分混淆）
- **草稿与结果同表**：`in_progress` 草稿在同一 `user_id + assessment_id` 下至多一条，靠 **可空 `draft_slot` + 唯一约束**兜住（草稿恒填 1、完成记录置 NULL，两库都允许多个 NULL，正好当「部分唯一索引」的可移植替代；MySQL 无部分唯一索引）。写入用单条 upsert（`ON CONFLICT` / `ON DUPLICATE KEY UPDATE`），并发自动保存不会插出第二条草稿。完成时**沿用草稿行**翻状态（保留 `started_at`、把 `draft_slot` 置 NULL 释放草稿位），同事务内把该用户该量表其他完成版本 `is_current` 置 0，保证当前版本唯一；历史版本用 `getAssessmentResults`（完成时间新→旧）
- **结果是快照**：`answers_json` / `scores_json` / `type_code` 落库，学生回看是当时的结论，不随改题或重算漂移。计分由计分引擎（#220）在写入前算好，数据层不重复实现算法，`dimensional` 量表不产出三字码（该列为 NULL）。注意作答明细以**题号**为键、不含题面文本：若后续要做「逐题作答明细回看」，需先补一列记录当时的量表/题面版本，否则改题后可能套错题面（当前结果页只呈现得分快照，不受影响）
- **两库一致性靠三条硬约束**（都在 `assessment-db.test.ts` 的 Schema 对账里锁住）：① 列名/可空性逐列相同；② 外键相同——SQLite 的 `REFERENCES`（本机 `foreign_keys=ON`，真实生效）与 MySQL 的 `FOREIGN KEY` 必须成对存在；③ `code` 的唯一比较语义相同——MySQL 显式 `COLLATE utf8mb4_bin`，否则默认 collation 不区分大小写，`riasec` / `RIASEC` 在 MySQL 里撞唯一键、在 SQLite 里共存，跨库迁移直接失败
- **完成动作串行化**：MySQL 侧事务开头 `SELECT ... FOR UPDATE` 锁学生行（与档案归档提交同款做法），否则两个「首次完成」并发时都 UPDATE 到 0 行、再各自插入 `is_current = 1`，当前版本就不唯一了；SQLite 由单写者事务天然串行
- **个人数据随账号删除**：`deleteStudents` 一并清 `assessment_results`；历史档案快照 `profile_submissions` 仍按 #95 口径保留
- **授权合规**：`attribution`（署名）/ `license_text`（授权与修改声明）/ `disclaimer`（免责声明）三列随量表下发，作答页与结果页必须展示。O*NET Tools Developer License 要求署名并声明「修改未经 USDOL/ETA 审核、认可或测试」（https://www.onetcenter.org/license_tools.html ）
- **信效度验证（#227）**：同一授权还要求「对整合了 Tools 内容的产品做验证」。验证方案、判定线（α / CITC / 重测 / 样本量）、施测 SOP 与常模实施预案见 `docs/assessment-validation-plan.md`；统计口径在 `src/lib/assessment-validation.ts`（单测锁定），一键报告用 `npm run validate:assessment -- --db ./data/career.db`（只用聚合值，不含个人数据）

## 职业测评作答流程（#223）

<!-- 对账：纯函数在 `src/lib/assessment-flow.ts`（测试 `assessment-flow.test.ts`）；4 个端点见上「共享域」；接口测试 `assessment-api.test.ts` 跑的是真实 SQLite + 真实计分引擎 -->

- **进度以服务端草稿为唯一真相**：答题页每答一题就 `POST /answer` 落 `status=in_progress` 草稿，**不用 localStorage**；退出再进由 `GET /start` 的 `resumeIndex`（第一个未答题，全答完则末题）续答。只打开页面不建草稿行，避免留下空记录
- **合并式保存而不是整份覆盖**：客户端每次只提交「题号 + 取值」，服务端读出现有草稿、按当前题库过滤后合并再 upsert——整份回写不会把别的题冲掉，旧草稿里超出当前题库的题号也不会带进新一轮。**边界**：合并是「读草稿 → 合并 → 整份写」的读-改-写，跨标签页**并发**请求在极端重叠时仍是最后写入为准（单标签页由前端「保存中禁用」串行）；丢的一题会显示为未答、重进补答即可，不会产生半份脏结果。要彻底消除需把合并下沉成适配器事务（SQLite 事务 / MySQL `FOR UPDATE` 锁草稿行），当前单实例部署按前者取舍
- **提交必须完整**：缺答一律 400 并回带 `missingIndexes`（答题页据此跳回漏题）；计分复用 #220 的引擎（`src/lib/assessment-scoring.ts`），数据层不重复实现算法；作答内容**只认服务端草稿**，不接受客户端传来的答案或 userId，改分无从下手
- **结果与审计**：得分 JSON + 三字码作为快照写入 `assessment_results`，重复提交生成新版本（旧版本保留、`is_current` 唯一）。审计动作为 `assessment:answer`（**只记进度，不记选了哪一项**——选项是个人数据不重复落审计表）、`assessment:submit`（成功/失败）、`assessment:results`（读取也记）；**被拒的写同样落审计**——参数非法 400、量表不存在 404、量表停用 403 各记一条 failed（带 `reason` / 题号），停用后仍有人刷题或刷错 `code` 在审计里看得到
- **停用与越权**：停用的量表拒绝 start / answer / submit（403），但**历史结果仍可读**（结果不随量表下线消失）；所有端点只按会话 uid 读写，无 userId 入参，因此不存在越权读他人结果的路径（教师/管理员访问同样 403）
- **作答锚点**：Likert 1-5 记为「非常不愿意 → 非常愿意」（兴趣量表问的是愿不愿意做，与计分引擎 1-5 量程同一口径，锚点常量在 `assessment-flow.ts`）

## 职业库与推荐匹配（#226）

<!-- 对账：数据快照 `src/lib/onet-data.ts`（自动生成）、译名 `src/lib/onet-name-zh.ts`、匹配纯函数 `src/lib/assessment-match.ts`；测试在 `onet-data` / `onet-db` / `assessment-match` / `careers-api`.test.ts -->

- **数据源与版本**：O*NET 数据库 **30.2**（2026-02 发布，CC BY 4.0），本轮先固定版本、把升级留成一次可控动作。**注意 O\*NET 从 30.3 起把兴趣数据表从 `Interests.txt` 改名为 `Career Interest Types.txt`（不是移除）**：7 列结构不变，已用 30.2 与 30.3 两个官方发布包逐值比对——923 个职业的六型分与官方高码**完全相同**，唯一差异是 1 个职业的 Job Zone（`15-1211.00` 3→4）。`scripts/import-onet.mjs` 自动识别两种文件名，将来升级只需重跑并传 `--version`。发布包里 1016 个职业中有 923 个同时具备六型分与 Job Zone，只收录这 923 个
- **离线导入**：`scripts/import-onet.mjs <解压后的 O*NET 文本版目录>` 解析兴趣表（**30.2 叫 `Interests.txt`，30.3 起改名 `Career Interest Types.txt`，脚本自动识别**）/ `Occupation Data.txt` / `Job Zones.txt`，生成 `src/lib/onet-data.ts`（元组数组，约 92KB）；运行时不读任何外部文件、不依赖国外 API。中文译名单独维护在 `src/lib/onet-name-zh.ts`（首批 178 个常见职业，覆盖六型与各 Job Zone），重新生成快照不会覆盖译名。脚本会校验必需列、code 格式/唯一性、分数与 Job Zone 量程，并在解析出的职业数 < 900 时直接失败（防列名变化时静默产出空快照）
- **入库与重灌**：`onet_occupations` 由 `init()` 幂等灌入，判据是 `configs_profile.onet_seeded_version` + 行数（`needsOnetReseed`，两适配器共用）；快照升级（本文件版本号变化）时**整表重灌**，平时只做两条轻查询就跳过。灌库失败只 `console.error` 降级（职业库为空 → 接口 503），**不阻断全站启动**：推荐是渐进功能，下次 `init()` 自动重试。**不纳入备份**：只读参考数据，清表后重启即恢复；`restore()` 不碰该表，恢复旧备份后它照旧可用
- **匹配口径**：`assessment-match.ts` 是纯函数——学生六维画像与职业六型分各自在量程内折算到 0–1（学生 0–100、O\*NET 1–7），算余弦相似度，取 Top-N（默认 6、上限 20）；同分按职业 code 升序破平，因此**同输入必然同输出**（无随机、不依赖 locale）。画像优先用结果快照的六维标准分，只有三字码时按 3/2/1 权重构造方向向量兜底；画像全 0 直接返回空列表而不是硬凑。**口径限制**：未做均值中心化的余弦只忽略「整体高低」（向量长度），不消除「整体兴趣水平」这一偏移——普遍高分型的职业对任何画像都更容易靠前；这是有意的取舍（RIASEC 关心方向），若要纯形状匹配可改中心化余弦（Pearson）
- **与官方口径对照**：`interest_code` 保存 O\*NET 官方兴趣高码（由发布包的 First/Second/Third Interest High-Point 指标推导，1–3 位，缺失位因并列），单测用它校验「高码首位 = 六型最高分维」，并用 **6 个代表性职业（六型各一）**做**自匹配回环**（拿职业自己的分当学生画像，必须排进 Top-3 且自身相似度 = 1）
- **接口**：`GET /api/shared/assessment/careers`，自鉴权（只认会话 uid，显式传别人 `user_id` 403、非学生 403），返回 `careers`（含中文译名 / 学历 / 职业群 / 相似度）、画像来源（`scores` / `typeCode`）、快照版本与 **CC BY 4.0 署名文本**（前端必须展示署名）。**不记审计**：与 `/api/shared/profile`、`/submissions` 等本人读本人的 GET 同口径（#110 的审计范围是管理域写操作、认证事件、档案提交、导出/备份）
- **已知边界**：职业分是 2026-02 的快照，不随 O\*NET 后续版本自动更新；Job Zone → 学历是归纳口径（如「本科」不是硬性要求）；`name_zh` 未覆盖的职业回退英文名

## 教师端测评统计（#229）

<!-- 对账：口径纯函数 `src/lib/assessment-stats.ts`（测试 `assessment-stats.test.ts`）；SQL 在两适配器的 getAssessmentStats / getAssessmentRoster；行为与越权测试 `assessment-stats-db.test.ts` / `assessment-stats-api.test.ts` -->

- **两个端点、两种数据敏感度**：`/api/manage/stats/assessment` 是**纯聚合**（班级完成度 / 六型计数 / 三字码 Top-10 / 总数），响应里没有姓名学号，可直接投屏；`/api/manage/assessment/roster` 才返回个人明细，因此它是全仓唯一「测评结果 + 姓名学号」同体的端点，边界单独收紧（见下）
- **关联口径**（表关系）：`assessment_results.user_id → users.id`（只取 `role='student'` 且在册）→ `users.class_id → classes.id`。三个条件缺一不可：`status='completed'`（草稿不算）、`is_current=1`（旧版本不算）、学生账号（教师/管理员本人作答不算）。未分班学生（`class_id IS NULL`）进**总分母**但不进任何班级分母，所以各班级完成率之和不等于全校完成率（有意为之，否则未分班学生凭空消失）
- **完成率**：`assessed / enrolled` 乘 100 保留一位小数，分母是**在册学生数**（未测评也计入），并在纯函数里钳到 100% 以内——脏数据（重复当前结果、跨班归属不一致）不会把完成度刷成 150%。`enrolled`/`assessed` 都数学生而不是行数，`assessed` 用 `COUNT(DISTINCT user_id)`
- **六型归型依据是结果快照的三字码首位**（`type_code[0]`）：计分引擎（#220）产码时已按「标准分降序 + RIASEC 破平序」选维度，统计层**不重算分数**，因此聚合计数与学生端逐人展示必然一致（单测逐人核对）。六型输出以量表 `dimensions_json` 的顺序为准、计数为 0 也返回，前端画图不用自己补零
- **范围参数与取舍**：聚合沿用既有 `/stats/*` 的全校口径（`scope=all` 默认，教师与管理员同数据，#165 的决策），`scope=mine` 才按 `teacher_classes` 收窄到本人班级；管理员没有班级归属，`scope=mine` 等同全校（要看单班结构用名册按 `classId` 下钻）。**明细接口例外：教师恒为本人归属班级**（`scope=all/mine` 都不放大范围，显式传别的班 `classId` 直接 403，不静默返回空列表）；管理员不受限
- **审计**：名册接口每次读取都记 `assessment:roster`（成功/失败都记：被拒的越权请求、非法参数、量表未配置各记一条 failed，含 `classId` / `lead` / 教师可查班级集合），便于回答「谁查过谁」；聚合接口不记（无个人信息，与既有 stats 同口径）
- **双适配器一致性**：适配器只做 SQL 计数（同一套 SQL 语义，表 `idx_assessment_results_assessment` 支撑），完成率、排序破平、Top-N 截断与中文标签统一在 `assessment-stats.ts` 的纯函数里算——口径不落在两个适配器上，避免 SQLite / MySQL 慢慢分叉；班级排序也在纯函数里做，不依赖两库的排序规则
- **性能**：按全表聚合（一所学校几百到几千行结果），走 `assessment_id` 索引即可，不额外建索引；高频轮询投屏时才需要考虑缓存，当前不做

## 文件存储（#111 对象存储）

- **统一抽象**：`src/lib/storage.ts` 定义 `StorageAdapter`（上传 / 读取 / 删除 / 存在性 / 访问地址签发），文件类型中立；本地实现 `storage-local.ts`（uploads/ 目录）+ S3 兼容实现 `storage-s3.ts`（`@aws-sdk/client-s3`，覆盖腾讯云 COS / 阿里云 OSS / MinIO / AWS S3）
- **多后端注册表**：`storage_backends` 表 + `users.storage_id` 文件级路由；切换默认后端只影响新上传，存量文件按归属后端照常读写；迁移端点幂等（已存在对象跳过）
- **私有读写**：云对象访问一律经 `/api/shared/storage-sign` 签发 30 分钟签名 URL（按角色 + 班级权限校验）；本地后端保持代理路径行为不变；前端经 `useFileUrl` / `StorageImage` 统一解析并缓存签名结果（28 分钟）
- **双端点**：服务端读写（上传/迁移/导出读图）优先内网端点，签名 URL 强制公网端点；对象路径 = `{bucket}/{path_prefix}/{key}`
- **上传约束**：服务端压缩（头像 ≤512×512、词云长边 ≤1024，JPEG 质量 85）、可配置大小上限（默认头像 5MB / 词云 10MB）、唯一命名不覆盖、SVG 显式拒绝（防存储型 XSS）

## 媒体资源治理（#117 孤儿检测 / #118 缩略图）

- **扫描口径**：`src/lib/media-scan.ts` 枚举全部后端的对象，与 `users`（当前档案）+ `profile_submissions`（历史快照）的引用比对，得出「被引用 / 孤儿」状态与关联学生
- **孤儿保留期**：`configs_profile.media_orphan_retention_days`（1–365 天，默认见代码），仅超期孤儿可删；**不做自动删除**，一律人工在管理面板「系统设置 → 媒体管理」确认后清理
- **清理安全链**：按清单（≤500 条）或 `mode:"all"`；服务端重新扫描自证（引用重查 + 保留期校验），不信任前端；删除源图连带 `_thumb` 缩略图，幂等静默；审计记统计与明细（key 条数受限，超出打 `truncated` 标记）
- **缩略图**：key 派生规则 `{base}.jpg` → `{base}_thumb.jpg`（仅 `.jpg` 派生，常量在 `src/lib/thumbnail-utils.ts`，生成逻辑 `src/lib/thumbnail.ts` 仅服务端）；`generate-thumbnails/status` 只读检测缺失，`generate-thumbnails` 补生成（单文件失败不中断，返回统计）
- **权限**：媒体治理不开放教师，路由内二次校验仅 admin

## 职业测评结果展示（#224）

<!-- 对账：视图模型纯函数在 `src/lib/assessment-view.ts`（测试 `assessment-view.test.ts`）；组件在 `src/components/student/`；数据来自 `/api/shared/assessment/results`（#223）与 `/careers`（#226） -->

- **位置**：学生面板「我的档案」内容区（hero 之下、Tab/表单之上）常驻一张卡片，不区分「已提交 / 建档中 / 编辑态」——这样无论档案提交流程处于哪一步，结果都能看到
- **与档案提交流程完全解耦**：卡片自己读 `/api/shared/assessment/results`，**不看 `submissionClosed` / 截止日期**（档案截止后仍可查看与重测）、不进档案版本快照、不显示「已归档 / 未提交」状态。测评的截止/停用规则只由测评自身（量表 `enabled`）决定
- **内容构成**：三字码徽章（`bg-brand` 深绿块 + 每枚字母的中文型名）→ 六型雷达图（recharts `RadarChart`，量程固定 0–100、不画半径刻度）与条状排名并列（排名标出三字码里的「主要兴趣」）→ 六型逐条通俗解读（按排名顺序，不出现「维度 / 标准分 / 口径」等术语）→ 推荐职业（#226，渐进增强）→ 免责声明 + 署名
- **视图模型先行**：`assessment-view.ts` 是纯函数层（补齐缺失维度、固定 RIASEC 顺序、排序破平、三字码规范化、职业卡清洗），组件只负责画。仓库没有 DOM 测试环境，界面逻辑一律先落到这里再被单测覆盖
- **推荐职业渐进增强**：只在有当前结果时补拉 `/careers`；接口失败 / 为空 / 无中文数据时**整块静默不渲染**（`console.error` 留痕，不打断学生），与「A3 未就绪也能上线」的验收口径一致；渲染时必须展示接口下发的 **CC BY 4.0 署名**
- **无结果空态**：引导去答题页（`/dashboard/student/assessment/quiz`，约 10 分钟）；有未完成草稿时提示「上次答到 N/M」并把 CTA 改成「继续作答」。测评中心（#222）上线后由它承担总入口，本卡片的空态链接不依赖它
- **容错**：结果接口失败显示「暂时读不到」+ 重试，不会把失败说成「没做过测评」；得分缺 `standard` 等脏数据在 `parseScores`（#223）与视图模型两层过滤，不用坏数据渲染

## 数据流

```
学生端（档案提交，#168 / #208）：登录 → 学生面板「我的档案」→ 未提交学生直接就地填写（标签为必填项、虚拟形象与评价词云可选填，空标签由服务端 400 拦截）→ 二次确认后提交；已提交学生走「修改数据」就地修改；每次保存生成新版本（#95）
学生端（登录态）：学生面板「我的档案」通览本人档案；「历史提交」Tab 查看/恢复旧版本（#95）；档案内容上方的职业兴趣测评区（#224）独立读取本人结果快照，包含三字码、六型雷达图/排名/解读与推荐职业（推荐为渐进增强）
学生端（激活）：/activate 第一步 verify 三要素核验（#93）→ 第二步设置密码并自动登录
学生端（职业测评，#222/#223/#225）：侧边栏「职业测评」→ 测评中心（三态状态卡：未开始 / 进行中 / 已完成 + 测验清单 / 六型科普 / 学职平台外链 / 授权与免责四张内容卡）→「开始 / 继续作答」进答题页单题单屏（每题自动存草稿，可退出续答）→ 全部答完后二次确认提交 → 服务端计分并按快照落库 → 答题页展示三字码与六维分；完整解读在「我的档案」测评区（#224）
教师端：登录 → 主页（问候 + 分组快捷入口，**不含统计数字**）→ 数据中心（概览/大屏/导出）→ 数据管理（数据列表/学生/班级/标签）→ 系统设置（功能设置/操作审计）
管理端：登录 → 数据中心（概览/大屏/导出/提交历史）→ 用户管理（学生/教师/班级/标签）→ 系统设置（数据源/功能设置/存储管理/媒体管理/操作审计）
```

## 班级邀请海报（#102）

- **入口**：管理/教师面板「班级管理」列表，有权限（admin 全权 / teacher 本人创建）的班级可生成海报；`GET /api/manage/classes/[id]/poster` 返回 PNG（`?download=1` 为附件下载）
- **生成链路**：`src/lib/invite-poster.ts` 用 `qrcode` 生成二维码 SVG，拼入海报 SVG（班级名称 + 邀请说明 + 品牌配色），再由 `sharp` 栅格化为 600×800 PNG；二维码基址由 `resolvePosterBaseUrl()` 解析——生产环境必须显式配置 `APP_PUBLIC_URL`，缺失或非法时接口返回 503 与中文原因、不产出错误域名的海报（#148），仅非生产模式回退请求 origin；成功响应的 `X-Invite-Url` 头把生效链接回给面板核对
- **安全边界**：二维码只携带 `/activate?invite=CODE`，激活页仅做表单预填，服务端 `resolveActivation` 仍强制学号 + 姓名 + 班级归属三要素一致；邀请码重置后旧码在数据库即失效，旧海报二维码无法通过校验；海报不含学生个人信息、管理员凭据等敏感数据
- **文本渲染依赖**：海报中文由服务端系统字体渲染（SVG 多字体回退栈）；Linux 部署须安装中文字体（如 `fonts-noto-cjk`），见 DEPLOY.md
- **审计**：生成海报计入操作审计（`class:poster`），邀请码本身不落审计日志（#110 凭据类数据不落库）

## 守护进程

PM2 管理。重启命令：

```bash
PORT=<端口> pm2 restart <应用名>
pm2 save
```

## 配置文件

- `db-config.json` — 数据库连接信息（安装引导生成，gitignored）
- `.env.local` — 环境变量（gitignored），模板 `.env.example`；**变量清单以 `docs/standards.md` §11 为唯一权威**，两处必须同步
