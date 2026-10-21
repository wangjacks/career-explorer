# Career Explorer — 架构说明

> v2.0.0：三角色统一用户体系（admin / teacher / student）

## 认证体系

- 统一 `users` 表存储三角色账户，bcrypt 哈希密码（`password_hash` 可为 NULL = 未设置密码）
- 登录签发 JWT（jose HS256, 24h，含 role/uid/name），HttpOnly Cookie `auth_token` 传递
- `proxy.ts`（Next.js 16，替代已弃用的 middleware）拦截管理域路由做角色权限校验
- 学生账户由教师导入名单预建（无密码），学生凭学号 + 姓名 + 本班邀请码三要素核验后激活；激活为两步单页（#93）：先 `verify` 核验取回名单姓名，再 `activate` 设置密码并自动登录
- 认证入口人机验证（#155）：`POST /api/auth`、`POST /api/auth/demo` 与 `POST /api/auth/activate/verify` 在查库 / 三要素核验**之前**校验极验（GeeTest v4）票据，票据缺失或无效直接 400 并统一返回「请先完成人机验证」，不进入 bcrypt 密码比对；凭证经 `NEXT_PUBLIC_GEETEST_CAPTCHA_ID`（公开，前端初始化）与 `GEETEST_PRIVATE_KEY`（仅服务端生成 `sign_token`）注入，不落库、不入日志
- 人机验证降级策略（#155）：**fail-open，且仅针对服务端不可达**。凭证未配置，或极验校验服务不可达（超时 / 非 200 / 响应不可解析）时放行认证并记 `auth:captcha-degraded` 审计；票据缺失或无效统一返回 400「请先完成人机验证」并记 `auth:captcha-failed`。前端组件脚本被拦截 / 初始化失败时只做本地提示并要求重试——客户端自述「不可用」不可信，静默放行等于给出绕过通道
- 人机验证前端形态（#155）：绑定式（bind，点击提交按钮弹出验证），票据一次性；登录失败或核验失败后前端重置验证码要求重新验证。仅登录页与激活页第一步启用，激活第二步（设置密码）不启用

| 面板 | 路由 | 访问权限 |
|---|---|---|
| 管理面板 | `/dashboard/admin` | admin |
| 教师面板 | `/dashboard/teacher` | teacher |
| 学生面板 | `/dashboard/student` | student |

## 页面路由

<!-- 对账：`find src/app -name page.tsx`（当前 10 个） -->

| 路由 | 说明 |
|---|---|
| `/` | 首页 |
| `/about` | 关于页（学生探索 / 教师管理 / 数据统计三段产品介绍） |
| `/login` | 登录页（三角色统一） |
| `/activate` | 学生账户激活（学号 + 姓名 + 邀请码三要素核验；支持 `?invite=` 二维码预填，仅预填不绕过校验） |
| `/dashboard/admin` | 管理面板（分组见「面板导航结构」） |
| `/dashboard/teacher` | 教师面板（分组见「面板导航结构」） |
| `/dashboard/student` | 学生面板（我的档案：未提交可就地填写与提交、已提交可就地修改 / 历史提交 #95，两个 Tab；档案内容上方常驻**测评结果区** #224 + #292——按量表清单循环渲染每套结果卡：霍兰德卡（三字码 + 六型雷达/排名/解读 + 推荐职业）与大五卡（画像标签 + 五维雷达/排名/高低分解读），两套都完成时附「人格与兴趣一起看」提示卡；与档案提交流程解耦；侧边栏另含「我的小组 #101」视图） |
| `/dashboard/student/assessment` | 职业测评中心（#222 骨架 + #225 内容卡 + #291 多量表）：Hero 题量徽章取主测评元信息 + 「我的测评」卡（最近活跃量表的三态 / 进度 / 结果摘要）+ 多行测验清单卡 + 霍兰德六型科普卡 + 大五人格科普卡（#291，随大五量表启用）+ 学职平台 / IPIP 外链卡 + 页底「授权与免责」卡（锚点 `#assessment-attribution`）；结果解读在「我的档案」测评区（#224 + #292） |
| `/dashboard/student/assessment/quiz` | 职业兴趣测评答题页（#223）：按 `?code=` 取量表（#289，缺省 `riasec`），单题单屏 + 进度条 + Likert 1-5，自动存草稿、可续答，提交前二次确认；霍兰德每次答的是**分层抽出的 30 题**（#282），不是 120 题题库 |
| `/setup` | 安装引导（首次配置数据库 + 管理员密码） |

> `/form` 已删除（#318），不再有对应页面路由；旧链接由 `next.config.ts` 的 `redirects()` 以 `permanent: true`（308）重定向到 `/`。它底下从未存在子路由，因此没有通配规则。

## 面板导航结构

<!-- 对账：读 src/app/dashboard/{admin,teacher}/page.tsx 的 MENU_GROUPS 与 src/app/dashboard/student/page.tsx 的 Tab 定义 -->

**管理面板 `/dashboard/admin`** — 三组两级：

| 组 | 项 |
|---|---|
| 数据中心 | 数据概览 / 数据大屏 / 数据导出 / 提交历史（#95） |
| 用户管理 | 学生管理 / 教师管理 / 班级管理 / 课堂分组（#101） / 标签管理 |
| 系统设置 | 数据源设置 / 功能设置 / 存储管理（#111） / 媒体管理（#117） / 操作审计（#110） / 演示环境（#258） |

> **演示环境 Tab（#258）**：仅生产 admin 可用。`DEMO_ENABLED` 关闭时显示启用引导而非报错；开启后可查看演示库状态、全量重置演示数据、发放/禁用/启用/重置密码/删除访客账户（密码明文仅展示一次）。重置会清空全部访客账户，UI 与 `DEPLOY.md` 均明示。demo-admin 无权访问（`demo/*` 不在 `DEMO_ALLOWED`），该 Tab 对其隐藏。

**教师面板 `/dashboard/teacher`** — 四组：

| 组 | 项 |
|---|---|
| （无组标题） | 主页 |
| 数据中心 | 数据概览 / 数据大屏 / 数据导出 |
| 数据管理 | 数据列表 / 学生管理 / 班级管理 / 课堂分组（#101） / 标签管理 |
| 系统设置 | 功能设置 / 操作审计（仅本人记录） |

> **主页只负责问候与分流（#228）**：主页 = 品牌 hero（时段问候 + 日期 + 一句引导）+ 按上面三个分组排成的快捷入口卡片网格，**不渲染任何统计数字与班级概览**（统计能力的唯一入口是「数据概览」）。卡片与侧边栏**共用 `page.tsx` 的同一份 `MENU_GROUPS`**（`description` 是卡片的一句话说明，侧边栏不渲染），新增栏目只改这一处；点击卡片即切 Tab，不做路由跳转。

> **数据概览只回答「有没有做」，图表归数据大屏（#230）**：概览 = 四张统计卡（总提交数 / 标签种类 / **测评完成** / 热门标签，栅格 `1 → 2 → 4` 列）+ 班级概览表（在原有四列后追加 **测评完成**、**交齐比例**，百分比全表取整）。测评数据来自 `/api/manage/stats/assessment`（#229），口径与「提交率」一致（分母=在册人数）；接口不可用/还没人测评时卡片显示 `0` + 「学生还没开始测评」、表格两列显示 `-`，**不出现报错态**。教师端在表下多一条「去数据大屏看兴趣类型分布」引导（`mode="teacher"` 才渲染，管理员端概览不受影响）；**分布类需求一律进数据大屏，概览不新增图表**——这条边界写在 `src/lib/assessment-overview.ts` 的文件头。

**学生面板 `/dashboard/student`** — 侧边栏五项：我的档案、我的小组（#101）、职业测评（#222）、我的班级（即将上线）、成长记录（即将上线）。「我的档案」「我的小组」是页内视图切换（由 `StudentSidebar` 的 `activeView` / `onSelect` 控制，历史提交作为「我的档案」子视图仍高亮「我的档案」）；「职业测评」是独立路由，按路径前缀高亮（覆盖答题页）。条目定义与判定规则在 `src/lib/student-nav.ts`。

**学生测评中心 `/dashboard/student/assessment`（#222 骨架 + #225 内容卡 + #291 多量表）** — 承载入口、状态与说明，结果解读与职业推荐留给「我的档案」测评区（#224）。数据来自 `GET /api/shared/assessment/list`（#291）：只含启用量表，每套带本人的 `status / typeCode / completedAt / historyCount / inProgress` 与定义元信息（题量 / 题库 / 计分模式 / 维度 / 署名授权）。三态判定仍复用 `src/lib/assessment-center.ts`（**进行中 > 已完成 > 未开始**，重测中的草稿优先）；多量表的选择与逐行归一在 `src/lib/assessment-list.ts`：`deriveLatestActive` 决定「我的测评」卡展示哪一套（**有草稿者优先、按 `updatedAt` 最新 → 最近完成 → 主测评 `riasec` 兜底**），`buildAssessmentList` 生成清单行。停用量表不出现在列表里（答不了新卷），历史结果仍可在「我的档案」查看。

内容卡（#225 / #291）从上到下。**六型科普、外链与授权卡在接口不可用 / 加载失败时也常驻**（学生至少能看到「六型是什么」与「去哪儿做别的测评」）；清单与大五科普随 list 结果渲染（列表读取失败时无法判断量表是否启用，不渲染以免误导）：

- **我的测评卡（#291）**：展示最近活跃的那套量表——名称、三态徽章、进行中进度条（按本轮题量）、已完成的三字码 / 完成时间 / 结果版本；结果形式按 `scoringMode` 说明（大五为「五大人格画像」，没有三字码）。CTA 一律带该量表的 `?code=`（`quizHref`）。
- **测验清单卡**：一行一套启用的量表（名称 / 题量 / 预计耗时 / 本人三态 + 作答入口）。每套量表都能进自己的卷子（答题页 #289 按 `?code=` 取量表），`isPrimary` 已退役；状态直通 list 接口，不再统一写「未开始」。
- **六型科普卡**：R/I/A/S/E/C 各一段自建通俗介绍（参考 O\*NET 对六类的公开描述改写）+ 2–3 个关键词 + 三条作答提示。**只讲倾向、不做人格判断、不给「适合什么职业」的结论**；文案在 `src/lib/assessment-center-content.ts`，单测锁「六型齐全 + 顺序 R→I→A→S→E→C」。
- **大五人格科普卡（#291）**：N/E/O/A/C 五个方面各一段通俗介绍 + 高低分各两个常见表现标签（两端用同一套中性标签，不暗示高分更好）+ 卡底「大五与霍兰德六型的关系」（S↔宜人性、E↔外向性、C↔尽责性）。与大五量表（`ipip-neo-ffi`）的启用状态绑定：量表停用或列表加载失败时不渲染，单量表页面与 #225 时一致；名称与 `IPIP_DIMENSIONS` 由单测逐项比对。
- **权威渠道外链卡**：学职平台（教育部学信网）的测评入口 / 职业探索 / 平台首页 + IPIP 国际人格题库（#291，标明公有领域），全部 `target="_blank" rel="noopener noreferrer"`，单测锁「只走 https 且 host 在允许清单内」。**只外链、不复刻其题目**（平台内容版权归官方，IPIP 条目本身属于公有领域）。
- **授权与免责卡**：O\*NET 改编署名 + 授权说明 + 授权页外链 + 免责声明。权威文案是 `assessments` 表的授权字段（随 list 接口下发，按主测评展示），前端不复制一份；接口无数据时退化成一段简短来源说明 + 兜底免责声明，保证「结果不作诊断/录用依据」始终可见。免责声明组件 `AssessmentDisclaimer` 与「我的档案」测评区**共用**，两边口径只有一处。

版权红线：科普文案只写自建的通俗描述，**不出现 SDS / Strong / MBTI 等商业量表的名称与题面**（单测里有禁用词表，口径见 `docs/plan-assessment.md` 第 2 节）。

## API 路由

<!-- 对账：`find src/app/api -name route.ts | wc -l`（当前 72 条 = manage 50 + auth 5 + setup 3 + shared 11 + tags/upload/uploads 各 1） -->

### 认证层（proxy 之外，公开）

| 路由 | 方法 | 说明 |
|---|---|---|
| `/api/auth` | POST / GET / DELETE | 登录（#155 起需携带极验票据）/ 会话检测 / 登出 |
| `/api/auth/activate/verify` | POST | 激活前置核验（#93 两步激活第一步）：校验学号 + 姓名 + 邀请码三要素，不设置密码；通过时返回名单姓名供第二步问候语展示（#155 起需携带极验票据） |
| `/api/auth/activate` | POST | 学生账户激活（#93 第二步）：三要素核验通过后设置密码并自动登录 |
| `/api/auth/demo` | POST | 演示登录（#252）：在演示库作用域内校验演示账号、签发带 `demo` 的会话 cookie；同样 captcha 前置、错误口径与生产一致；`DEMO_ENABLED` 关闭时 404 |
| `/api/auth/demo-switch` | POST | 演示角色切换（#255）：仅 demo 会话；按当前身份反解 `seq`，取同账户目标角色身份（admin/teacher/student），重签 `role+uid+name+demo` 并刷新 cookie；非 demo / 名册学生（seq<1000）/ 目标身份缺失 / 禁用账户拒绝，审计按作用域分流 |

### 安装层（proxy 之外）

| 路由 | 方法 | 说明 |
|---|---|---|
| `/api/setup` | POST | 安装配置（数据库 + 管理员密码） |
| `/api/setup/status` | GET | 安装状态检查 |
| `/api/setup/test` | POST | 数据库连接测试 |

### 管理域 `/api/manage/*`（proxy 拦截：生产 admin 全放行；demo-admin 按 `DEMO_ALLOWED` 收敛；teacher 按声明式权限表）

<!-- 对账：路由清单 `find src/app/api/manage -name route.ts`（共 50 条）；teacher 权限列须与 src/proxy.ts 的 TEACHER_ALLOWED 逐条一致，demo-admin 允许列须与 DEMO_ALLOWED 逐条一致 -->

**教师禁止（不在 `TEACHER_ALLOWED`，一律 403）**

| 路由 | 方法 | 说明 |
|---|---|---|
| `/api/manage/teachers` | GET / POST | 教师账户列表与新建 |
| `/api/manage/teachers/[id]` | PUT / DELETE | 教师账户改密 / 删除 |
| `/api/manage/settings` | GET / PUT | 数据源配置读写 |
| `/api/manage/backup` | GET / POST | 备份下载 / 恢复 |
| `/api/manage/test-db` | POST | 数据库连接测试 |
| `/api/manage/demo/reset` | POST | 演示库全量重置（#253，**仅生产 admin**）：删演示库文件 + 清 `uploads/demo` + 重新 init + 全新随机重播账户/提交/测评（完成+进行中草稿）/分组/占位图；测评数据按**每次 30 题的分层抽题**生成并带 `items_json` 快照（#282：演示班级与真实施测同口径，草稿的已答题是本轮卷子的前缀、可被真人续答）；`DEMO_ENABLED` 关 404、演示会话 403；成功与生产越权拒绝落**生产**审计、演示会话越权拒绝落**演示**审计（隔离不变量）；并发重置经模块级单飞锁、播种失败丢弃半成品回到可重试态 |
| `/api/manage/demo/status` | GET | 演示库状态（#253，仅生产 admin）：initialized + 按演示号段过滤的规模计数，绝不泄露生产；库文件不存在时直接返回未初始化（不开 adapter、无建库副作用）。成功只读不审计；越权拒绝记审计（演示会话拒绝落演示审计、生产非 admin 落生产审计） |
| `/api/manage/demo/accounts` | GET / POST | 演示访客账户（#278，仅生产 admin）：GET 列表（无 hash，演示库不存在返空）；POST 创建 3 角色套装（admin/teacher/student 共用一个姓名与密码、按同一 `seq` 从专用号段派生编号），密码缺省服务端生成、明文仅返回一次；演示库未初始化 409；成功审计落生产、演示会话拒绝落演示审计 |
| `/api/manage/demo/accounts/[seq]` | PATCH / DELETE | 单个访客账户（#278，仅生产 admin）：PATCH `action=disable\|enable\|regenerate-password`（禁用=三身份 `password_hash` 置空；enable 即重生成密码并返回明文一次）；DELETE 级联清 `profile_submissions`/`class_group_members`/`assessment_results`/`teacher_classes`/`users` 并 best-effort 删 `uploads/demo` 派生文件（含缩略图） |
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
| `/api/manage/export` | GET / POST | 全方法 | Excel/CSV 导出（XLSX 支持原生单元格图片与浮动图片双模式，默认单元格图片）；列按「基础信息 / 职业兴趣测评」两组可选（#233，含班级与六型分/推荐职业；#162 追加他人评价1/2/3 三列，历史词云图片列保留）；`?capabilities=1` 只探测职业库是否就绪（不下数据） |
| `/api/manage/export-images` | GET | 全方法 | 图片打包导出（ZIP） |
| `/api/manage/stats` | GET | 仅 GET | 统计汇总 |
| `/api/manage/stats/compare` | GET | 仅 GET | 班级对比：每班在册 / 已提交 / 提交率（#165）；每行 `{ key, label, total, submitted }`，`key` 是身份、`label` 是展示名（#260） |
| `/api/manage/stats/class-roster` | GET | 仅 GET | 班级名册明细（#217/#260）：`?class=` 是统计分组键（班名或 `__unassigned__`），服务端用 `getClassByName()` 解析成 `class_id` 后取数（不写 `WHERE name = ?`）；返回姓名 / 完整学号（前端脱敏展示）/ 提交状态 / 提交时间 / 标签数；未知或已改名班级 404；每次查询记审计。`?classId`（#313，正整数，**优先于** `?class`）按稳定主键定位，班级改名后仍正确；非法 id → 400、库里没有该班 → 404 |
| `/api/manage/stats/distribution` | GET | 仅 GET | 标签分布 |
| `/api/manage/stats/trends` | GET | 仅 GET | 提交趋势（全校合计，缺日补 0） |
| `/api/manage/stats/class-trends` | GET | 仅 GET | 按班级分层的提交趋势（#165，时间 × 班级交叉维度）；响应 `{ series: [{ key, label }], points: [{ date, counts }] }`，`counts` 以 `key` 索引、未分班固定最后（#260） |
| `/api/manage/stats/assessment` | GET | 仅 GET | 测评聚合统计（#229/#311）：班级完成度 / 六型计数 / 三字码排行 / 总数小结 / 逐班六型构成，**不含任何个人标识**；`?scope=all`（默认，全校）或 `scope=mine`（仅本人归属班级）；`?code` 默认 `riasec` 且只接受 `typological` 量表；`?classId` 收窄到单班；`assessment.enabled` 供大屏区分「还没开放」与「还没人做」（#232） |
| `/api/manage/stats/completion` | GET | 仅 GET | 班级 × 事项完成矩阵（#310）：档案提交 + 各启用量表各一列，**不含姓名/学号**；`?scope=all`（默认，所有班级）或 `scope=mine`（教师仅本人归属班级）；`unassigned` 与 `total` 含未分班学生（scope=all 时）；教师看所有班级时行 `canDrilldown=false`；纯聚合不记审计 |
| `/api/manage/stats/big-five` | GET | 仅 GET | 大五人格班级分布（#312）：五维各按低/中/高三档计数，**响应不含姓名/学号/逐人分数**；`?scope=all`（默认，全校）或 `scope=mine`（教师仅本人班级）；`?classId` 收窄单班、教师非本人班级 403；量表元信息只从 `assessments` 表读，停用返回 `enabled:false` + 全 0；未安装/量表缺失返回 `assessment:null` 空态；纯聚合不记审计 |
| `/api/manage/assessment/roster` | GET | 仅 GET | 测评名册（#229）：已完测学生的姓名 / 学号 / 三字码 / 完成时间，供下钻；过滤参数 `classId` / `lead`（三字码首位，与 #305 后 `/profiles` 的任意位置包含筛选口径不同）/ `code`（完整三字码，#232）+ `scope`；**#313 增** `scale`（默认 `riasec`，白名单 = 启用量表的完整 `code`，非法 400）与 `status`（`done` 默认 / `missing` 未完成名单）：`lead` / `code` 与非 `riasec` 或与 `missing` 组合一律 400；`missing` 只回姓名 / 学号 / 班级；dimensional 量表（如 `ipip-neo-ffi`）已测名册以 `bands` 取代三字码、不含 raw / standard；教师恒收窄到本人归属班级（越权 403），每次读取记审计 `assessment:roster` |
| `/api/manage/profiles` | GET / DELETE | GET + DELETE | 档案列表 / 清除档案字段。GET 支持**服务端筛选与排序**（#295：`q` / `tag`（可重复，**一个参数就是一个标签、不按逗号切分**——标签名允许含逗号，切分会把下拉里选中的那一项筛成别的条件）/ `lead`（兴趣测评三字码任意位置包含所选六型字母（#305）或 `none`）/ `sortKey` / `sortDir`，分页在过滤后执行、`total` 为过滤后命中数）。GET 每行另带 `classId`（#243：教师面板据此隐藏越界行的删除入口）与兴趣测评字段（#234：`assessmentCode` / `assessmentStatus` / `assessmentAt` + 详情条形用的六型快照 `assessmentScores`），取「`completed` 且 `is_current=1`」的当前有效结果，未测行为 `none` / `null`；分页、总数与既有排序口径不变。DELETE 由 `WriteGuard` 在路由内判定班级归属（#243）：教师只能清除本人管辖班级学生的档案，未分班 / 他班 / 不在册 id 整批 403、不落任何写入；管理员仍可清除任意在册学生，不在册 id 显式 404；成功与被拒均记审计 `profile:clear`（metadata 只含学号与条数，不含档案内容） |
| `/api/manage/profiles/submissions` | GET | GET | 管理端查看学生提交历史（#95）：admin 全量、teacher 仅管辖班级 |
| `/api/manage/profiles/submissions/exceeding` | GET | GET | 超出版本上限的学生列表（#95） |
| `/api/manage/groups` | GET / POST | 全方法 | 课堂分组（#101）：GET 读该班当前分组 + 指标 + 与最近一批的差异（读不限班级）；POST 触发自动分组，**完全覆盖**当前分组并追加一份历史批次归档 |
| `/api/manage/groups/members` | PATCH | 全方法 | 手工换人（#101）：把一个成员移到本班另一个组，允许移入超员组 |
| `/api/manage/groups/entries` | POST / DELETE | 全方法 | 手工建空组 / 删空组（#101）：非空组一律拒绝删除，先移人再删 |
| `/api/manage/groups/batches` | GET | 全方法（实际只读） | 该班历史批次列表（#101，新→旧） |
| `/api/manage/groups/batches/[id]` | GET | 全方法（实际只读） | 单批次明细：批次头 + 各组内聚度快照 + 成员姓名学号快照（#101） |
| `/api/manage/groups/export` | GET | 全方法（读操作，不限班级） | 导出该班**当前**分组的 XLSX（组号/学号/姓名，学号写成文本单元格）；未分组时导空白模板（全班学生 + 空组号）；审计 `group:export`（#101） |
| `/api/manage/groups/import` | POST | 全方法 | 按文件**全量覆盖**当前分组：xlsx 由客户端解析成 JSON 行提交；严格核对文件学号集合与班级名单完全一致（缺人/多人/重复/非法组号一律整份 400 拒绝），空组号=不进组；**不写历史批次**；审计 `group:import`（记组数人数，不记文件名） |
| `/api/manage/audit-logs` | GET | 仅 GET | 操作审计只读查询（#110；教师强制限本人记录，查询自身也被审计） |

> 分组（`/api/manage/groups*`）前缀整体放行给教师，**班级归属在路由内判定**（`canModifyClass`）：教师可看任意班的分组，但只能触发/调整自己带的班；被拒的写操作同样落审计（`status:"failed"`）。

> 学生写入（`/api/manage/students*`）前缀整体放行给教师，**归属在路由内判定**（#171，`WriteGuard`）：学生以其当前 `class_id` 落在教师关联班级内为准，未分班学生（`class_id` 为 NULL）只有管理员能维护；转班要求来源与目标班级都在管辖范围内；批量导入/删除/重置密码任一行的目标班级或在册学生越界则**整批拒绝**，不留半写状态。教师面板仍可读到全校名单（既定设计）。

> 全站生效的配置（预设标签、`profile-config`）写入只归管理员（#171）：proxy 权限表按方法收敛到 GET，路由内再用 `WriteGuard.canWriteGlobal` 二次拒绝；教师面板以 `readOnly` 呈现这两个 Tab。

> 前缀匹配特性：`/api/manage/export` 覆盖 `export-images`；`/api/manage/profiles` 的 GET+DELETE 覆盖 submissions 子路由的 GET，但 `submissions/cleanup` 是 POST，教师被拒。
>
> 数据范围：`/api/manage/stats/*` 默认全校（#165 的决策：教师与管理员读到同一份聚合数据）；需要按教师归属收窄的端点走显式参数——`scope=mine` 收窄到本人班级（#310/#312），`classId` 再收窄单班，其中 #312 对教师传非本人班级直接 403。聚合端点本身不含个人信息。
>
> **#229 测评统计的两层范围**：聚合 `/stats/assessment` 沿用上面这条口径（默认全校，`scope=mine` 才收窄到本人归属班级）；**个人明细 `/assessment/roster` 例外**——它是唯一**专用的**「测评结果 + 姓名学号」下钻端点，教师恒为本人归属班级（`classId` 越权直接 403），并每次读取记审计。注意「唯一」只指**专用测评端点**：档案数据列表 `/api/manage/profiles` GET 自 #234 起也在每行附带三字码/完成时间/六型分，它沿用档案列表既有权限（教师可见全校已提交档案学生、GET 无班级收窄且不记审计；DELETE 按 #243 记审计），不是第二套测评权限。两者的取舍见「教师端测评统计（#229）」与「教师端数据列表测评列（#234）」。

**演示管理员（demo-admin，#274）**

演示会话（token `demo:true` 且 `role=admin`）不再享受生产 admin 的全放行，由 `DEMO_ALLOWED` 收敛；生产 admin 不受影响。demo-teacher 仍按上表 `TEACHER_ALLOWED`（演示库内），demo-student 一律 403。

| 允许（`DEMO_ALLOWED`） | 方法 |
|---|---|
| `/api/manage/classes`（含 `[id]` 的 GET 与 poster） | GET |
| `/api/manage/students` | GET（只读名册） |
| `/api/manage/tags` | GET |
| `/api/manage/profile-config` | GET |
| `/api/manage/profiles`（含 submissions 子路由的 GET） | GET / DELETE |
| `/api/manage/groups`（含 members/entries/batches/export/import） | 全方法 |
| `/api/manage/export`（含 export-images） | 全方法 |
| `/api/manage/stats` | GET |
| `/api/manage/assessment` | GET |
| `/api/manage/audit-logs` | GET |

**显式拒绝**：`/api/manage/test-db`（唯一绕过演示作用域、可按请求体打开任意 SQLite/MySQL 的端点，**含生产库**）、`settings`、`storage*`、`backup`、`media*`、`teachers*`、`demo/*`，以及 `students` / `tags` / `classes` / `profile-config` 的写与 `profiles/submissions/cleanup`。拒绝由 proxy 直接 403、不进入路由。#258 起，演示管理员的侧边栏隐藏完全无权的 Tab（演示环境 / 数据源设置 / 教师管理 / 存储管理 / 媒体管理）；其余只读 Tab 保留，其中的写操作仍会收到 403（读可用、写不可用）。

### 共享域 `/api/shared/*`（不进 proxy，路由自鉴权）

| 路由 | 方法 | 说明 |
|---|---|---|
| `/api/shared/profile` | GET / POST | GET 会话查询本人档案（含提交截止状态，#96、三条评价与词表 #162）；POST 仅学生本人会话保存（拒绝显式指定学号；超过提交时限强制 403；新档案须标签 + 三条评价齐全，存量仅历史图片账户三条留空可保留旧图），每次保存生成一个历史版本 |
| `/api/shared/profile/submissions` | GET | 学生本人历史提交列表（#95，按版本倒序返回完整快照元数据） |
| `/api/shared/profile/submissions/restore` | POST | 学生恢复历史版本（#95）：截止后 403 → 校验版本归属 → 生成新版本（不回写旧记录）→ 审计 `profile:restore` |
| `/api/shared/group` | GET | 学生读本组名单（#101）：只返回**本人所在组**的成员（姓名/学号/头像引用/标签），不提供遍历班级的接口；未分组返回 `grouped:false` |
| `/api/shared/storage-sign` | GET | 文件访问地址签发（#111）：本地后端回显代理路径；云后端按归属记录的 `storage_id` 签发 30 分钟签名 URL；权限校验：学生仅本人与**同组同学的头像**（#101，存量词云图片不放行、非同组 403）、教师仅管辖班级、管理员全量 |
| `/api/shared/assessment/start` | GET | 进入答题页（#223）：按 `?code=` 取量表（缺省 `riasec`）并**派生本轮抽题**（#282，`draw = f(uid, assessmentId, 题库指纹, attemptNo)`）后下发题面（不含维度，避免暗示答案）+ 量表元信息（`scoringMode`、`anchors`、署名/授权/免责）+ 草稿进度与续答落点；响应 `questionCount` = 本轮题数、`poolSize` = 题库总量；**只读，不建草稿行** |
| `/api/shared/assessment/answer` | POST | 保存一次作答（#223）：题号必须属于**本轮卷子**（在题库里但不在本轮 → 400 + 失败审计），服务端**合并**进 `status=in_progress` 草稿并回进度 + 下一个未答题；首次作答把抽题快照一起写进草稿 `items_json`（#282）；非法题号/取值 400，停用量表 403 |
| `/api/shared/assessment/submit` | POST | 提交作答（#223）：未答完 400（回带本轮 `missingIndexes`）→ 复用 #220 引擎按量表 `scoring_mode` 计分（只传本轮抽中题，标准分按各维实际已答数折算）→ 结果快照落库（含 `items_json`；`is_current` 唯一，重复提交生成新版本；**沿用草稿行**不新增记录）→ 响应 `result` 带 `scoringMode`（dimensional 的 `typeCode` 为 null，不能靠 null 反推模式）→ 审计 `assessment:submit`（带 `attemptNo` 与题库指纹，不带作答内容） |
| `/api/shared/assessment/results` | GET | 结果查询（#223）：当前有效结果 + 最近 10 个历史版本 + 进行中进度，**始终只回 `?code=` 指定的那一套量表**（缺省 `riasec`），供「我的档案」测评区（#224 + #292）逐套消费；`assessment.questionCount` = 每次作答题数、`poolSize` = 题库总量（#282），`inProgress` 按**本轮题号**算（不是整库 120）；每条记录带自己的 `questionCount`（快照缺失的旧数据回退作答条数）；量表元信息带 `enabled`（停用时测评中心收掉作答入口，历史结果仍可读）与 `scoringMode`（#292 档案页据此分流结果卡）；「有哪些启用量表」的清单**不在本接口**（唯一来源是下面的 `/list`，#291/#292）；只按会话 uid 读取，**无 userId 参数**，因此没有越权读他人结果的路径 |
| `/api/shared/assessment/list` | GET | 测评中心多量表列表（#291）：**只返回 `enabled=1` 的量表**，每套带 `code / name / questionCount / poolSize / scoringMode / scaleVersion / dimensions / status / typeCode / completedAt / historyCount / inProgress{answered,total,updatedAt}` 与署名/授权/免责；`historyCount` 与 `/results` 同口径（至多 `MAX_RESULT_VERSIONS`，页面显示「10+」）；逐套用 `loadAttemptContext` + `buildAssessmentListItem` 归一（三态口径与 `/results` 同一处），鉴权同 `/results`（只认会话 uid，未登录 401、非学生 403），每次读取记审计 `assessment:list`（只记条数与 code 列表）；「我的档案」测评区（#292）也用它拿清单，再逐套按 `?code=` 取结果 |
| `/api/shared/assessment/careers` | GET | 本人最新霍兰德结果 → Top-N 推荐职业（#226）：只认会话 uid（显式传别人的 `user_id` 直接 403，非学生 403），`?limit=1–20`（非法值 400），返回推荐列表 + O*NET 署名与快照版本；没完成测评 404、结果里既无六维分也无三字码 409、职业库为空 503 |

### 其他开放端点（proxy 之外）

| 路由 | 方法 | 说明 |
|---|---|---|
| `/api/tags` | GET | 预设标签 + 自定义标签上限（#94）+ 提交截止状态（#96）加载（学生面板与标签着色复用） |
| `/api/upload` | POST | 文件上传（头像 / **历史评价词云图片**；#111 起按默认后端路由 + 服务端压缩 + 大小上限 + SVG 拒绝；#162 起评价改为文字，evaluation 前缀仅兼容存量客户端）；失败审计只对有会话的调用者落库，匿名失败仅保留服务器 stdout 告警（#259） |
| `/api/uploads/[...path]` | GET | 静态文件服务（本地后端的代理路径，含路径穿越防护） |

## 数据库

<!-- 对账：`grep -oE "CREATE TABLE IF NOT EXISTS \`?[a-z_]+" src/lib/db-sqlite.ts src/lib/db-mysql.ts`；两适配器表集合必须一致（当前 17 张） -->

十七张表，SQLite / MySQL 双适配器实现同一 `DbAdapter` 接口（`src/lib/db.ts`）。权威定义在两适配器的 `CREATE TABLE`，本表为索引：

| 表 | 用途 | 引入 | 纳入备份 |
|---|---|---|---|
| `users` | 统一用户表（三角色）：`user_code`（学生 12 位 / 教师 8 位 / 管理员 5 位，兼登录标识）、`password_hash`（NULL = 未设置）、`role`、`name`、`class_id`（仅学生）、`tags`（#94 起为标签名称文本数组）、`avatar_url`、`evaluation_url`（**#162 起仅存量历史图片**）、`evaluation_text`（#162：三条他人评价的 JSON 数组，如 `["评价一","评价二","评价三"]`）、`submitted_at`、`storage_id`（#111 文件级路由） | v2.0.0 / #162 | ✅（含 `password_hash`） |
| `classes` | 班级：`name`、`invitation_code`（唯一） | v2.0.0 | ✅ |
| `teacher_classes` | 教师-班级多对多关联 | v2.0.0 | ✅ |
| `tags` | 预设二级标签：`type`（category/tag）、`parent_id` 层级、`class_id=0` 为全局；#94 起降级为表单预设项，物理删除（分类级联删子标签），`active` 列保留但不再操作 | v2.0.0 | ✅ |
| `configs_profile` | 档案功能配置键值表：`max_custom_tags`(#94)、`submission_deadline`(#96)、`max_avatar_size_mb` / `max_evaluation_size_mb`(#111；后者 #162 起仅历史兼容)、`max_profile_submissions`(#95)、`media_orphan_retention_days`(#117)、`tags_seeded` / `onet_seeded_version`（种子与快照版本标记，见 #226） | #94 | ✅ |
| `audit_logs` | 操作审计（#110）：只追加 + 查询，操作者字段快照冗余，敏感键脱敏剔除、metadata 截断 2000 字符；索引 `created_at` / `actor_id` / `(resource_type, resource_id)` | #110 | ✅ |
| `storage_backends` | 存储后端注册表（#111）：内置本地后端（不可删）+ 多个 S3 兼容实例；凭据不入库（走 `.env.local`）；`name` 唯一 | #111 | ✅（不含凭据） |
| `profile_submissions` | 档案提交历史版本（#95）：`user_id` + `version` + 快照字段（`tags`/`avatar_url`/`evaluation_url`/`evaluation_text`/`storage_id`/`submitted_at`）+ `is_current`；`evaluation_url` 仅存量历史图片，`evaluation_text` 为三条评价 JSON（#162）；索引 `(user_id, version)`、`(user_id, is_current)` | #95 / #162 | ✅ |
| `assessments` | 测评定义（#221）：`code`（唯一，如 `riasec`）、`name`、`question_count`（语义=**题库总量**，#281 起 120）、`items_per_attempt`（#282：每次作答题数，`INTEGER NOT NULL DEFAULT 0`，`0` = 全量作答即「题库即本轮」，`riasec` 为 30 走分层抽题）、`dimensions_json`（`[{key,label}]`，顺序即计分与展示顺序）、`scoring_mode`（`typological` 取类型码 / `dimensional` 多维高低分档）、`scale_version`、`attribution`（署名）/ `license_text`（授权与修改声明）/ `disclaimer`（免责声明）、`enabled` | #221 / #282 | ✅ |
| `assessment_questions` | 题库（#221）：`assessment_id` + `question_index`（量表内从 1 开始，`UNIQUE`）+ `prompt` + `dimension`（须是 `dimensions_json` 的 key）+ `origin`（#281：`onet-mini` / `onet-sf` / `cn-original`，`NOT NULL DEFAULT 'cn-original'`；分层抽样与分来源分析用）+ `reverse_scored` + `version`（题面版本，改动时自增） | #221 | ✅ |
| `assessment_results` | 作答与结果**快照**（#221）：`user_id` + `assessment_id` + `status`（`in_progress` 草稿 / `completed` 完成）+ `answers_json` + `items_json`（#282 抽题快照 `{"v":1,"pool":"<题库指纹>","indexes":[…呈现顺序]}`，默认 `'[]'` 读作「整库即本轮」的旧数据；随草稿写入、提交时沿用同一行带到完成记录）+ `scores_json` + `type_code`（三字码，dimensional 量表为 NULL）+ `is_current` + `draft_slot`（草稿位：草稿为 1、完成为 NULL，`UNIQUE(user_id, assessment_id, draft_slot)`）+ `started_at` / `updated_at` / `completed_at` | #221 / #282 | ✅（学生个人数据） |
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

> **统计分组身份（#260）**：趋势 / 对比 / 名册统一按 `classes.id` 分组，`class_id IS NULL`（含悬空引用）映射为内部哨兵键 `__unassigned__`、展示标签「未分班」；真实班级的 `key` 仍是班名、`label` 为班名。`key` 用于取数 / 排序 / 下钻，`label` 只用于展示。禁止再写 `COALESCE(c.name, '未分班')` 当分组键。班级新建 / 改名拒绝 `未分班`、`还没分班`、`__unassigned__` 三个保留名（只拦未来写入，不迁移存量、不自动改名）。

备份格式 `BackupData`（**version 7**，定义在 `src/lib/db.ts`；#162 增加评价文字列）：十六表全量（`onet_occupations` 是唯一不纳入备份的表），其中 `audit_logs` / `configs_profile` / `storage_backends` / `profile_submissions` / 分组五表 / 测评三表为可选字段（旧备份缺失时读取方容忍 `undefined`；v6 及更早备份的 `evaluation_text` 按 `null` 恢复）；含 `password_hash`，不含上传文件。

> `onet_occupations`（#226）**不纳入备份**：它是离线快照导出的只读参考数据，重新部署/清表后由 `init()` 按快照重灌即可，没必要让每份备份多背 923 行；它不引用 `users` / `classes`，与下面 #211 的「按 id 引用就整表清空」口径无关。

> **恢复期间的「缺字段」口径（#211 统一）**：`users` / `classes` 是**整表替换并按备份里的原始 `id` 重插**，恢复全程外键检查又是关闭的（SQLite `PRAGMA foreign_keys = OFF` / MySQL `SET FOREIGN_KEY_CHECKS = 0`，事后开启**不回溯校验**已存在的行）。所以规则是：**凡按 `user_id` / `class_id` 引用这两张表的持久表，一律无条件先清空，只有备份带该字段才回填**——「缺字段 = 恢复后该功能无数据」，不是「保留现状」。分组五表（#101）、`profile_submissions`（#95）与 `assessment_results`（#221）都走这条；留着旧行等于把上一个占这个 id 的人的数据交给新的人，而 `GET /api/shared/profile/submissions` 是学生本人可读的。
>
> 两条已接受的副作用：① 清空后历史版本表为空，但**下一次冷启动 `init()` 里的迁移会按恢复后的 `users` 给已提交学生补一条 `version=1 / is_current=1`**，归属取自那条 `users` 行、不会复活别人的数据，所以「无历史版本」只维持到下次启动为止；② 只存在于历史快照里的文件（`avatar_url` / `evaluation_url` 未被当前 `users` 引用的那些）失去最后一条 DB 引用，会进入 #117 孤儿清单——恢复不碰上传文件，孤儿也不自动删，留给人工确认。
>
> 仍保留现状的表：`configs_profile`（键值配置，与身份无关）、`assessments` / `assessment_questions`（参考数据，见下）、`onet_occupations`（#226 只读职业库，离线可重灌，且不引用 `users` / `classes`）、`storage_backends`（缺字段即 #111 之前的备份，其 `users` 行没有可用的 `storage_id`，恢复时回落到内置本地后端；该后端是 `storage_backends` 首行且管理端禁删，编号恒为 1）。`audit_logs` 是唯一**引用了 `users` 却仍保留**的表：**审计记录不可丢**优先于归属洁净，行内已冗余存了操作者编号/姓名/角色，`actor_id` 错配只影响展示归属与教师「只看本人」的过滤范围（该项为后续议题，见 #211）。

> **测评三表的两种处理**：`assessments` + `assessment_questions` 是参考数据，**两字段齐备才整体替换**，缺字段保留现状（可被种子自愈，不会出现「换了定义没换题库」）。`assessment_results` 则**一律先清空**、备份带字段才回填（#281 新增的 `assessment_questions.origin` 在旧备份里缺失时按 `cn-original` 恢复，#282 新增的 `assessments.items_per_attempt` / `assessment_results.items_json` 缺失时按列默认值 `0` / `'[]'` 恢复，沿用「缺字段一律容忍」口径——补默认值后 `upgradeAssessmentBank()` 会把 `items_per_attempt` 补成种子口径，不留「从未存在过的卷量」）：它只靠数值 `user_id` 关联，而 `users` 恢复时已整表替换，保留旧结果会把甲的结果挂到乙名下（恢复到另一套库的旧备份时尤其明显）——与分组五表的「旧备份恢复后即为未分组」同口径。

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
- **界面**：管理面板「用户管理 → 课堂分组」与教师面板「数据管理 → 课堂分组」为同一组件；班级选择器列全校，非本人创建的班级标注「只读」（列表没加载成功时不下这个判断，避免误标自建班）；「当前分组 / 历史批次」分段，历史是只读快照（成员取归档时的姓名与学号，账号删除后仍可读）；头像取不到图时回落为姓名首字（`TextAvatar`）
- **手工调整**：触发自动分组要**二次确认 + 亲手输入预期组数**（组数由 `computeGroupSizes` 现算，与算法同一口径）；换人用底部抽屉（移动端）/ 居中弹窗（桌面），抽屉里显示该生标签与各目标组的人数、内聚度、标签概览，当前组置灰、已满组标注但仍可移入；只允许删空组；界面按 `GROUP_SIZE_CAP` 标「超员」，规则破坏可见而不阻断
- **未进组名单**：视图返回 `ungrouped`（全班减去所有组里的学生）。自动分组之后转入、或导入漏填组号都会停在这里，不列出来就只能靠重新分组覆盖掉手工调整
- **指标分母**：覆盖率与「有共同特征的学生对」按**全班**算，`overall` 与内聚度只含**已进组**的人——界面对外分列标注，不混用
- **学生侧可见性**：`/api/shared/group` 只返回请求者所在组的名单；`/api/shared/storage-sign` 为学生放行**同组同学的头像**（仅此一项，词云不放行），同组判定用单条查询按 `group_id` 比对，避免两次读之间被原子重分组复用组号

## 职业测评数据层（#221）

<!-- 对账：表结构见上「数据库」；题库种子在 `src/lib/assessment-data.ts`，行为测试在 `src/__tests__/assessment-db.test.ts` -->

- **量表进库、不写死代码**：`assessments` 存定义（维度 JSON / 计分类型 / 量表版本 / 署名授权），`assessment_questions` 存题面；首套量表为 **120 题 RIASEC 题库**（#281：现有 Mini-IP 30 题一字不改 + O*NET Interest Profiler Short Form 其余 30 题中译 + 本项目原创 60 题，6 维各 20 题，无反向题；`scale_version = RIASEC-CN 2.0`）。种子由两适配器 `init()` 写入，判定口径是「`code` 不存在 **或** 该量表题库为空」——**非空题库一律不碰**（后台维护过的题面不会被覆盖），空题库（如恢复了一份 `assessment_questions: []` 的备份）会补种并校正 `question_count`，避免留下「可用但 0 题」的量表
- **题库只增不改升级（#281）**：生产库已有 30 题时由 `upgradeAssessmentBank()`（两适配器同构、单事务）扩库，**只允许五种写动作**——① 缺失题号 INSERT；② 已存在题号**只回填 `origin`**（`prompt` / `dimension` / `version` 一个字节都不动）；③ 量表定义字段（`name` / `question_count` / `scale_version` / 署名 / 授权 / 免责）仅在 `scale_version` 与种子不一致时整体更新；④ `items_per_attempt`（#282）单独补齐——它与版本号无关，生产库在 #281 时已是 `RIASEC-CN 2.0`，不回填就永远停在补列默认值 0（= 整库作答），进不了抽题口径；⑤ 同版本库的 `license_text` 与种子不一致时只刷新这一列（#284 的放行状态文案与版本号无关，不连带覆盖后台维护的 name / attribution）。重复执行幂等，第二次不改任何字段。`init()` 在 `seedAssessments()` 之后调用
- **种子校验（#281 起）**：`validateAssessmentSeed` 拦「题数一致、题号 1..n 连续、维度归属、题干与英文原文非空」+ 新增——每维题数相等、每维 `origin` 分布（官方 ≥3 且原创 ≥3）、题干归一化后全局唯一、题干 4–24 汉字且不含收入/学历/地位线索、原创题必须带 `anchor` 且锚定职业在 O*NET 快照中存在（维度须在其官方兴趣高码前两位，查询函数由服务端注入，避免 92KB 快照进客户端 bundle）、同维度相似度 ≥ 0.45 的题对必须被 `NEAR_DUPLICATE_GROUPS` 覆盖、`items_per_attempt`（#282）为 0（全量作答）或正值且能被维度数整除且不超过题库总量。坏种子在安装/升级时直接报错，不留半截题库
- **题号即作答键**：`question_index` 从 1 连续到 n，作答 JSON 以它为键，故跳号会让「已答 n 题 / 总 n 题」的进度口径失真；`dimension` 必须是 `dimensions_json` 里的 key，且每个维度至少一题（零题维度恒 0 分，会与真实低分混淆）
- **草稿与结果同表**：`in_progress` 草稿在同一 `user_id + assessment_id` 下至多一条，靠 **可空 `draft_slot` + 唯一约束**兜住（草稿恒填 1、完成记录置 NULL，两库都允许多个 NULL，正好当「部分唯一索引」的可移植替代；MySQL 无部分唯一索引）。写入用单条 upsert（`ON CONFLICT` / `ON DUPLICATE KEY UPDATE`），并发自动保存不会插出第二条草稿。完成时**沿用草稿行**翻状态（保留 `started_at`、把 `draft_slot` 置 NULL 释放草稿位），同事务内把该用户该量表其他完成版本 `is_current` 置 0，保证当前版本唯一；历史版本用 `getAssessmentResults`（完成时间新→旧）
- **每次 30 题的分层抽题（#282）**：120 题全答超过 16 分钟会掉完成率，故 `items_per_attempt = 30` 走抽题，核心是**确定性派生而不是每次随机**——`draw = f(userId, assessmentId, 题库指纹, attemptNo)`（纯函数在 `src/lib/assessment-sampling.ts`，rng 可注入、无 I/O），因此任何路由各自重算都得同一张卷子，`GET /start` 才能保持只读（#223 不变量：只点开页面不留空草稿）。卷面形状：每维 `30 / 6 = 5` 题、来源配比每维官方题（`onet-mini` + `onet-sf`）2 或 3 + 原创补足（仅原创题放行后生效）、`NEAR_DUPLICATE_GROUPS` 同卷至多一题、整卷洗牌后按维度交错修整顺序（避免 3 题及以上连续同维度泄露题目归属）。`attemptNo` **不新增列**，由该用户该量表 `completed` 行数 + 1 派生（结果行不删除，草稿进行中不推进，故稳定）；排除集取上一条完成结果的 `items_json`，所以重测不复用上一轮的题，而第 3 轮允许回到第 1 轮的题（未启用放行门时 120 题只够两轮完全互斥，这是设计口径，单测锁住防止被当 bug 改掉；放行门启用后的口径见下条）。池子不足时按「来源配比 → 排除集 → 近重复组」降级并 `console.warn`，**绝不因后台删题而 500**。四个路由共用 `src/lib/assessment-attempt.ts` 的 `loadAttemptContext()` 一次算完本轮题号、题目与快照，避免各处口径分叉。演示播种（#253）也走同一个 `drawItems` 出题并写快照，所以演示班级不会留下「整库 120 题」的历史形态。第二套量表 IPIP NEO-FFI（#290）`items_per_attempt = 0` = 整库 50 题一轮，抽题逻辑天然不介入（`planAttempt` 在算 `perDimension` 之前就返回）
- **放行门（#284）**：`SAMPLING_EXCLUDED_ORIGINS`（`assessment-data.ts`）把未通过专家评审与班级试测的来源整批排除在抽题池外，当前为 `cn-original`——题库仍是 120 题（历史结果与种子校验不受影响），线上只抽 60 道 O\*NET 官方题（每维 10 道，每轮 5 道），`items_per_attempt = 0` 的全量口径也只含官方题。排除来源计入 `poolFingerprint`，放行门一变旧快照自动作废重派；在途草稿保留官方题作答、丢弃原创题作答并由官方题补齐。重测换卷时 C / E 两维因近重复组挤占会放宽排除集出现个别重题，其余四维完全换新（单测锁定）。回退原因、四项判据与复核日期见 `docs/assessment-validation.md`
- **题目质量回收（#285）**：`scripts/assessment-item-stats.mjs` 只读统计完成记录的抽题快照，按题输出 `n / mean / sd / r_it` 与卷面组合 α、官方 vs 原创同维均值差，CSV 不含任何学生标识；SQLite 以 `readonly: true` 打开，不改 `updated_at`，MySQL 走匿名 JSON 导出。含反向计分题的量表（IPIP 25 道）先按 `6 − 原始值` 转成计分方向，CSV 的 `reverse_scored` 列保留原始方向。判定线：单题 `n ≥ 50` 才纳入，均值 `< 1.6` / `> 4.4`、`r_it < 0.30` 淘汰，组合 α `< 0.55` 复查题池，来源差 `> 0.5` 整批复评（统计实现在 `src/lib/assessment-item-stats.ts`）。换题不删题、不改旧题面：新增候补题号并登记 `RETIRED_QUESTIONS`（旧题号 / 候补题号 / 依据 / 日期），`validateRetirementLedger` 强制同维、候补为原创题、题号更大、与旧题同近重复组；`planAttempt` / `drawItems` 按 `SAMPLING_RETIRED_INDEXES` 排除旧题，退役集非空时计入 `poolFingerprint` 使旧快照重派，种子校验按**在用题目**校验每维题数与来源分布。「近 N 轮」排除本期不实现（当前每维仅 10 道可抽题，N=2 需要 15 道），评估与恢复条件见 `docs/assessment-validation.md` §7
- **结果是快照**：`answers_json` / `scores_json` / `type_code` 落库，学生回看是当时的结论，不随改题或重算漂移。计分由计分引擎（#220）在写入前算好，数据层不重复实现算法，`dimensional` 量表不产出三字码（该列为 NULL）。注意作答明细以**题号**为键、不含题面文本：#282 的 `items_json` 已记下本轮题号与题库指纹，逐题回看能定位到「当时答的是哪 30 题、对应哪一版题库」，但题面**文本**仍未快照，改题后文字会变（当前结果页只呈现得分快照，不受影响）
- **两库一致性靠三条硬约束**（都在 `assessment-db.test.ts` 的 Schema 对账里锁住）：① 列名/可空性逐列相同；② 外键相同——SQLite 的 `REFERENCES`（本机 `foreign_keys=ON`，真实生效）与 MySQL 的 `FOREIGN KEY` 必须成对存在；③ `code` 的唯一比较语义相同——MySQL 显式 `COLLATE utf8mb4_bin`，否则默认 collation 不区分大小写，`riasec` / `RIASEC` 在 MySQL 里撞唯一键、在 SQLite 里共存，跨库迁移直接失败
- **完成动作串行化**：MySQL 侧事务开头 `SELECT ... FOR UPDATE` 锁学生行（与档案归档提交同款做法），否则两个「首次完成」并发时都 UPDATE 到 0 行、再各自插入 `is_current = 1`，当前版本就不唯一了；SQLite 由单写者事务天然串行
- **个人数据随账号删除**：`deleteStudents` 一并清 `assessment_results`；历史档案快照 `profile_submissions` 仍按 #95 口径保留
- **授权合规**：`attribution`（署名）/ `license_text`（授权与修改声明）/ `disclaimer`（免责声明）三列随量表下发，作答页与结果页必须展示。O*NET Tools Developer License 要求署名并声明「修改未经 USDOL/ETA 审核、认可或测试」（https://www.onetcenter.org/license_tools.html ）
- **信效度验证（#227）**：同一授权还要求「对整合了 Tools 内容的产品做验证」。验证方案、判定线（α / CITC / 重测 / 样本量）、施测 SOP 与常模实施预案见 `docs/assessment-validation-plan.md`；统计口径在 `src/lib/assessment-validation.ts`（单测锁定），一键报告用 `npm run validate:assessment -- --db ./data/career.db`（只用聚合值，不含个人数据）。**与 #282 抽题的冲突点**：α 与 CITC 要求同一套题目在被试间可比，抽样口径下没人答满某一维，报告会在「内部一致性」一节直接说明**不可计算**（不是题库缺陷）；维度间相关、重测信度与常模用的是各人折算后的标准分，抽样口径下仍能算，只是重测两轮换的是不同题，相关里含一部分抽样误差——题目质量回收要用**全量作答**的试测数据（临时置 `items_per_attempt = 0` **并放行对应来源**后施测；放行门未解除时全量口径也只含官方题）。120 题库新增题的放行判据（专家评审 + 一个班级的平行卷试测）与执行状态见 `docs/assessment-validation.md`（#284）：当前评审与试测均未开展，原创题按回退路径不参与抽题。

## 职业测评作答流程（#223）

<!-- 对账：纯函数在 `src/lib/assessment-flow.ts`（测试 `assessment-flow.test.ts`）+ 抽题在 `src/lib/assessment-sampling.ts` / `src/lib/assessment-attempt.ts`（测试 `assessment-sampling.test.ts`）；4 个端点见上「共享域」；接口测试 `assessment-api.test.ts` 跑的是真实 SQLite + 真实计分引擎 + 真实抽题 -->

- **进度以服务端草稿为唯一真相**：答题页每答一题就 `POST /answer` 落 `status=in_progress` 草稿，**不用 localStorage**；退出再进由 `GET /start` 的 `resumeIndex`（本轮第一个未答题，全答完则末题）续答。只打开页面不建草稿行，避免留下空记录
- **合并式保存而不是整份覆盖**：客户端每次只提交「题号 + 取值」，服务端读出现有草稿、按**本轮卷子**（#282 抽题集合）过滤后合并再 upsert——整份回写不会把别的题冲掉，不在本轮的题号也不会带进这一轮。**边界**：合并是「读草稿 → 合并 → 整份写」的读-改-写，跨标签页**并发**请求在极端重叠时仍是最后写入为准（单标签页由前端「保存中禁用」串行）；丢的一题会显示为未答、重进补答即可，不会产生半份脏结果。要彻底消除需把合并下沉成适配器事务（SQLite 事务 / MySQL `FOR UPDATE` 锁草稿行），当前单实例部署按前者取舍
- **题号口径只在派生，不在传递**：客户端传来的题号一律对照服务端派生出的本轮卷子校验（在题库里但不在本轮 → 400 + 失败审计），所以「答不该答的题」在服务端就被挡住，而不依赖前端只渲染抽中的题；`items_json` 的解析与序列化各有**唯一一处**（`assessment-sampling.ts`），路由不自己 `JSON.parse`
- **提交必须完整**：缺答一律 400 并回带**本轮** `missingIndexes`（答题页据此跳回漏题）；计分复用 #220 的引擎（`src/lib/assessment-scoring.ts`），只传本轮抽中题——`standardizeLinear` 按「该维已答题数 × 1..5」折算，与题库大小无关，所以每维 5 题与每维 20 题的标准分同一量程（全 4 分恒为 75）；数据层不重复实现算法，作答内容**只认服务端草稿**，不接受客户端传来的答案或 userId，改分无从下手
- **结果与审计**：得分 JSON + 三字码 + 本轮抽题快照（`items_json`，#282）作为快照写入 `assessment_results`，重复提交生成新版本（旧版本保留、`is_current` 唯一）。审计动作为 `assessment:answer`（**只记进度与本轮口径（`attemptNo` / 题库指纹），不记选了哪一项**——选项是个人数据不重复落审计表）、`assessment:submit`（成功/失败）、`assessment:results`（读取也记）、`assessment:list`（读取也记，只记条数与量表 code）；**被拒的写同样落审计**——参数非法 400、量表不存在 404、量表停用 403 各记一条 failed（带 `reason` / 题号，「题号在题库里但不在本轮」也记 `question-not-in-round`，同样不落选项值），停用后仍有人刷题或刷错 `code` 在审计里看得到
- **停用与越权**：停用的量表拒绝 start / answer / submit（403），但**历史结果仍可读**（结果不随量表下线消失）；所有端点只按会话 uid 读写，无 userId 入参，因此不存在越权读他人结果的路径（教师/管理员访问同样 403）
- **作答锚点随量表下发（#289）**：1-5 量程统一但语义按量表区分——霍兰德问「愿不愿意」（非常不愿意 → 非常愿意），IPIP 问「同不同意」（非常不同意 → 非常同意）。锚点表 `ASSESSMENT_ANCHORS` 与取值入口 `getAssessmentAnchors()` 在 `assessment-data.ts`，由 `GET /start` 随 `scoringMode` 一起下发，答题页不再写死某一套量表的锚点（两套量表都是 1–5，与计分引擎量程同一口径）

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

- **两个端点、两种数据敏感度**：`/api/manage/stats/assessment` 是**纯聚合**（班级完成度 / 六型计数 / 三字码 Top-10 / 总数），响应里没有姓名学号，可直接投屏；`/api/manage/assessment/roster` 才返回个人明细，因此它是唯一**专用的**「测评结果 + 姓名学号」下钻端点，边界单独收紧（见下）。档案数据列表 `/api/manage/profiles` GET（#234）也带测评字段，但走档案列表既有权限，不受本条收窄约束（详见「教师端数据列表测评列（#234）」）
- **关联口径**（表关系）：`assessment_results.user_id → users.id`（只取 `role='student'` 且在册）→ `users.class_id → classes.id`。三个条件缺一不可：`status='completed'`（草稿不算）、`is_current=1`（旧版本不算）、学生账号（教师/管理员本人作答不算）。未分班学生（`class_id IS NULL`）进**总分母**但不进任何班级分母，所以各班级完成率之和不等于全校完成率（有意为之，否则未分班学生凭空消失）
- **完成率**：`assessed / enrolled` 乘 100 保留一位小数，分母是**在册学生数**（未测评也计入），并在纯函数里钳到 100% 以内——脏数据（重复当前结果、跨班归属不一致）不会把完成度刷成 150%。`enrolled`/`assessed` 都数学生而不是行数，`assessed` 用 `COUNT(DISTINCT user_id)`
- **六型归型依据是结果快照的三字码首位**（`type_code[0]`）：计分引擎（#220）产码时已按「标准分降序 + RIASEC 破平序」选维度，统计层**不重算分数**，因此聚合计数与学生端逐人展示必然一致（单测逐人核对）。六型输出以量表 `dimensions_json` 的顺序为准、计数为 0 也返回，前端画图不用自己补零
- **班级六型构成**（#311）：`byClass` 复用同一批原始计数组装，班级按名称 `zh-CN` 排序、同名按 `classId` 破平；每班六型按量表维度顺序补齐 0，无人完成的班仍返回六项 0。未分班学生只进总计，不生成虚构班级
- **量表与范围参数**（#311）：`code` 默认 `riasec` 并做小写归一化；不存在量表返回 404，`dimensional` 量表返回 400，避免被误读为「没有六型结果」。聚合沿用 `/stats/*` 的全校口径（`scope=all` 默认，教师与管理员同数据，#165 的决策），`scope=mine` 才按 `teacher_classes` 收窄到本人班级；`classId` 可把整个聚合再收窄到单班。教师 `scope=all` 可看任意班聚合，`scope=mine` 传非本人班则 403；管理员没有班级归属，`scope=mine` 等同全校。**明细接口例外：教师恒为本人归属班级**（`scope=all/mine` 都不放大范围，显式传别的班 `classId` 直接 403）；管理员不受限
- **审计**：名册接口每次读取都记 `assessment:roster`（成功/失败都记：被拒的越权请求、非法参数、量表未配置各记一条 failed，含 `classId` / `lead` / `code` / 教师可查班级集合；#313 起另记 `scale` / `status`，`resource_id` 随量表变化），便于回答「谁查过谁」；聚合接口不记（无个人信息，与既有 stats 同口径）
- **多量表与未完成名单**（#313）：`scale` 白名单 = **启用量表**的完整 `code`（`ipip` 这类缩写一律 400，不让调用方以为查了另一套量表；默认不传时仍按 `riasec`、保持旧响应）；`status=done|missing`。`missing` 的基准是 `users`（`role='student'` + 班级收窄）配 `NOT EXISTS` 子查询匹配 `completed + is_current`——因此**含只有草稿的学生**、排除教师/管理员账号，且不能改写成 LEFT JOIN 结果表判 NULL（草稿会被误当成已完成）；响应只有姓名 / 学号 / 班级。`lead` / `code` 只对 `riasec + done` 成立，其余组合明确 400，不静默忽略。dimensional 量表（大五）的已测名册以 `bands: [{key,label,band}]` 取代三字码，**不下发 raw / standard**，`band` 缺失时按 `bandOf` 兜底（纯函数 `rosterBands`，`assessment-dashboard.ts`）
- **双适配器一致性**：适配器只做 SQL 计数（同一套 SQL 语义，表 `idx_assessment_results_assessment` 支撑），完成率、排序破平、Top-N 截断与中文标签统一在 `assessment-stats.ts` 的纯函数里算——口径不落在两个适配器上，避免 SQLite / MySQL 慢慢分叉；班级排序也在纯函数里做，不依赖两库的排序规则
- **性能**：按全表聚合（一所学校几百到几千行结果），走 `assessment_id` 索引即可，不额外建索引；逐班六型构成用一次 `GROUP BY class_id, key` 查询，不逐班循环查询；高频轮询投屏时才需要考虑缓存，当前不做

## 班级完成矩阵（#310）

<!-- 对账：纯函数 `src/lib/completion-stats.ts`（测试 `completion-stats.test.ts`）；SQL 由 `src/lib/completion-query.ts` 的 `buildCompletionStatsSql` 生成、两适配器共用（测试 `completion-query.test.ts` / `stats-db-parity.test.ts`）；行为测试 `completion-stats-api.test.ts` / `assessment-stats-db.test.ts` -->

- **端点与列**：`GET /api/manage/stats/completion` 是「一个班 × 一件事」的唯一数据源；`columns[0]` 恒为档案提交，其后按启用量表顺序追加 `assessment:<完整 code>`，停用量表不出列；列携带 `scaleName` / `scoringMode`，短名（兴趣测评 / 人格测评）按 `scoringMode` 派生，前端仍可按 code 覆盖。
- **SQL 单一来源**：两适配器只执行 `buildCompletionStatsSql` 生成的同一份 `UNION ALL` SQL，并用 `mapCompletionStatsRows` 归一原始行；参数顺序（档案段 classIds → 量表段 ids → 量表段 classIds）由共享构造器与单测锁定，避免 MySQL / SQLite 分叉。
- **分组口径**：两适配器只按 `class_id` 分组数数（`null` = 未分班），班名只用于展示；**不得复用 `getCompareByClass` 的班名 COALESCE 当键**（改名/重名会串数据）。档案 `submitted` 与 `isSubmitted()` 的主要口径一致（空串/纯空格不算提交）。
- **完成口径**：只认 `assessment_results.status='completed' AND is_current=1 AND users.role='student'`；未分班学生进 `unassigned` 与 `total`，不进任何班级行；`enrolled=0` 的空班不出行。
- **展示口径**：行按档案提交率升序（最该催的在前），同率按班名 `zh-CN`、再按 `classId` 破平；完成率复用 #229 的 `completionRate`（一位小数、钳到 100%）；`total` 用同一分母重算，不平均行完成率。
- **范围与下钻**：`scope=all` 默认看所有班级；教师 `scope=mine` 收窄到 `teacher_classes`，管理员 `scope=mine` 等同所有班级。教师看「所有班级」时响应行 `canDrilldown=false`（只读聚合），教师「我带的班」与管理员为 true；未分班不提供下钻。
- **降级与审计**：量表读取失败退化为只有档案列；未安装返回空矩阵，均不 500。响应无个人信息，与 `/stats/assessment` 同口径**不记审计**；个人明细仍走 `/assessment/roster`（单独记审计）。

## 人格轮廓统计（#312）

<!-- 对账：纯函数 `src/lib/big-five-stats.ts`（测试 `big-five-stats.test.ts`）；SQL 在两适配器的 getDimensionalResultScores（`stats-db-parity.test.ts` 锁同构，真实 SQLite 行为在 `assessment-stats-db.test.ts`）；接口行为测试 `big-five-stats-api.test.ts` -->

- **端点与响应**：`GET /api/manage/stats/big-five` 是「人格轮廓」卡的唯一数据源；`assessment` 带量表 `code` / `name` / `scaleVersion` / `enabled` / `scoringMode` / `dimensions`，**只从 `assessments` 表读、不返回任何题目内容**；`total` 复用 #310 完成矩阵的 `enrolled / assessed / rate` 分母口径，另带 `invalidCount` 与 `lastSubmittedAt`；`dimensions` 为五维三档计数，维度顺序恒为量表定义顺序（N/E/O/A/C），**不按分值排序**。
- **三档口径**：只读结果快照里已落库的 `band`（`completed + is_current=1 + role='student'`），**不重算分数**；旧快照缺 `band` 时用 `bandOf(standard)` 兜底（阈值 66.7 / 33.3，与计分引擎同一口径）。整条 JSON 解析失败、缺维度或 `standard` 非有限数值都整行计入 `invalidCount`、不进分布，因此**启用态**下 `low + medium + high` 恒等于 `assessed - invalidCount`，响应不会出现 `NaN`；没有可用维度定义时所有行都计为 invalid，不掩盖配置错误。
- **数据层**：`getDimensionalResultScores(assessmentId, classIds)` 只返回 `{ user_id, scores_json, completed_at }` 三列（不取姓名学号/作答内容）；两个适配器各执行一份同构 SQL（`stats-db-parity` 锁结构、过滤条件与参数顺序），班级范围 `classIds=null` 为全校、空集合直接空数组。
- **范围与权限**：`scope=all`（默认，全校）或 `scope=mine`（教师收窄到 `teacher_classes`）；`classId` 再收窄单班。教师**任何** `classId` 都先过归属判定（非本人班级 403，不因 `scope=all` 放宽），管理员可查任意范围且 `scope=mine` 等同全校；非法 `scope` / `classId` → 400。
- **停用与缺失**：量表停用返回 `enabled:false`，`total` 与五维计数**全部归零**、不读取完成度/逐人快照（界面渲染「未开放」而非 0%）；未安装或量表未种子化返回 `assessment:null` 的空态，均不 500。
- **已知边界**：`enrolled / assessed / rate` 来自完成矩阵聚合，三档分布来自另一条只读查询，两者不在同一事务；稳定数据下守恒，极端并发（学生恰好在两次查询之间提交）可能相差 1 人。
- **隐私边界**：响应只有聚合计数与维度标签，没有 `raw` / `standard` / 逐人明细 / 平均分 / 排名；与 `/stats/assessment`、`/stats/completion` 同口径**不记审计**，个人明细仍走 `/assessment/roster`（那里单独记审计）。

## 数据大屏测评栏（#232）

<!-- 对账：视图口径纯函数 `src/lib/assessment-dashboard.ts`（测试 `assessment-dashboard.test.ts`）；组件 `TeacherAssessmentCard` + `AssessmentRosterDialog`；文案 `ASSESSMENT_DASHBOARD_COPY`（`dashboard-copy.test.ts` 锁词表与对比度） -->

- **一栏三视图 + 点击下钻**：教师端大屏全宽栏（`lg:col-span-12`）替换原占位卡。三个视图（完成进度 / 类型分布 / 热门三字码）共用**一次**聚合请求——切换视图不重取、不影响同屏其他图表；只有切换「全校 / 只看我的班」才重取聚合。点班级行 / 类型条 / 三字码胶囊才去取名册（个人明细，服务端记审计）
- **完成进度**：按交齐比例**升序**（最该催的在前），同比例按班名排序，「还没分班」恒置末（它不是一个可催的班，且不是可下钻对象）；每行是 `班名 · 已交/共 N 人 · 内联进度条`
- **类型分布**：六型**横向条**（不用雷达图——投屏读不出绝对量），宽度按最大值归一、右侧标人数；悬停/聚焦时读数固定显示在栏中心（不给每段挂 tooltip，同标签分布卡的理由）；点条按 `lead` 下钻
- **热门三字码**：Top-10 胶囊，底色取首位类型色；点胶囊按**完整 `code`** 下钻（为此名册接口新增 `code` 过滤，与 `lead` 是「且」关系）
- **配色与对比度**：六型色由数据决定（不走语义 token），每型给浅色/深色两档类型条、一档胶囊底色 + 文字色；单测按 WCAG 校验类型条与轨道 ≥ 3:1、胶囊文字 ≥ 4.5:1。issue 写的 E 型 `#f59e0b` 对浅色底只有 2.15:1，改用同色相深一档 `#b45309`（理由写进配色表注释）
- **下钻弹窗**：复用班级名册弹窗的范式（`dialog` 语义 + Escape + Tab 焦点捕获 + 关闭后焦点还原；窄屏全屏抽屉、桌面 `max-h-[85vh] max-w-2xl`），标题下与页脚**常驻**「投屏提醒」；列只展示姓名 / 学号（首 4 末 4 脱敏）/ 三字码 / 完成时间，支持关键字搜索与「只看某一型」二级筛选，弹窗内还会按 `lead` 再向服务端收窄一次
- **降级**：本栏自管加载 / 失败 / 未开放 / 无人完成四种状态——失败态只坏这一栏且带重试；量表停用（`assessment.enabled=false`）或量表未配置（404）显示「还没开放」的行动邀请，**不写「暂无数据」**；无人完成时提示去哪儿做测评

## 教师端数据列表测评列（#234 / #330）

<!-- 对账：配色 `src/lib/assessment-colors.ts`；筛选/徽章口径 `src/lib/profile-assessment.ts`；SQL 在 `src/lib/profile-query.ts`（两适配器共用）与适配器的 getCurrentAssessmentResultsByUserCodes（与 #233 导出共用同一个数据层方法）；测试 `assessment-colors` / `profile-assessment` / `profile-query` / `profiles-query-db` / `profiles-api` / `assessment-db` -->

- **双测评列（#330）**：9 列 → 10 列——「兴趣测评」（霍兰德三字码徽章）与「人格特质」（五大人格 Top2 画像，如「高外向性 · 高尽责性」，带 `IPIP` 小标、hover 显示完成时间）并排插在「标签」与「提交时间」之间，空态 `colSpan` 同步改 10。**两列都不提供排序**（三字码/画像非数值），未测统一灰态「未测」胶囊；窄屏仍靠既有横向滚动
- **数据来源**：`/api/manage/profiles` 响应根新增 `assessmentScales`（**启用中的量表清单**：`code` / `name` / `scoringMode` / `dimensions[{key,label}]`，列定义与维度标签的唯一来源，前端不写死量表），每行新增 `assessmentResults: { [code]: { status, typeCode, completedAt, scores[{key,standard}] } }`；依旧按**当页学号集合**逐量表各批查一次（`IN` 分片 500），不做全校扫表。某套量表查询失败**只让该列降级为「未测」**，其它列与档案列表不受影响；旧字段 `assessmentCode` / `assessmentStatus` / `assessmentAt` / `assessmentScores` 过渡期保留（取自霍兰德结果），旧前端与 #233 导出继续可用
- **两列口径**：只认「当前有效结果」（`completed + is_current=1`）；`typological` 量表要求三字码合法才算已测（脏值按未测），`dimensional` 量表有当前结果即已测、快照缺失时 `scores=null`（界面显示「已测（分数快照缺失）」，**不画假的 0 分画像**）
- **配色单一来源**：六型固定色值定义在 `assessment-colors.ts`，数据列表徽章、数据大屏测评栏（#232）、导出列（#233）都应 import 这里，避免三处各异；`C` 的底色偏亮，文字色用深色以保证 WCAG AA（白字只有 3.68:1），单测锁每对文本/底色对比度 ≥ 4.5:1
- **测评筛选（#330）**：工具条只保留**一个**「测评筛选」按钮 + 弹层（有值时带计数徽章与已应用 chip），弹层内两个 tab，**同一时间只按一种测评筛选**——互斥三处保证：① 前端 `AssessmentFilter` 联合类型（`none` / `interest` / `personality`）从类型层面禁止并存；② 服务端同时收到 `interest` 与 `personality` 直接 400（与旧 `lead` 也不能混用）；③ SQL 生成器只走一个分支
  - **兴趣**：状态「全部 / 未测」+ 六型字母多选（**AND 语义 = 三字码同时包含所选字母**，最多 3 个，`interest=S,A,I` / `interest=none`），如 `S+A+I` 即「三字码含 SAI 的同学」
  - **人格**：「全部 / 已测 / 未测」+ 单一维度 + 偏高/偏低（`personality=C:high` / `personality=any` / `personality=none`）；阈值 50 与结果页同一口径；不做多维叠加
  - **维度下标由路由解析**：`personality` 只传维度 key，路由按该量表 `dimensions_json` 的顺序算出 `scores_json` 数组下标（客户端传下标 = 把注入点交给客户端）；维度不属于任何启用量表 → 400，不返回空列表
  - **量表清单读取失败时**：无测评筛选的列表照常降级（双列显示未测）；带 `personality` 筛选返回 **503**（服务端故障，不误报成 400 参数错误），由客户端稍后重试
  - **量表来源边界**：筛选弹层的 `R I A S E C` 与兴趣列选表仍固定 RIASEC（当前唯一 `typological` 量表）；`assessmentScales` 是列定义与维度标签的唯一来源，将来启用第二套 typological 量表时需同步扩展筛选字母与兴趣列选表口径
  - **筛选下推服务端**：`interest` / `personality` 与搜索、标签一起进 `buildSubmittedProfilesSql`，**分页在过滤后执行**，`total` 为过滤后的命中数（跨页可筛，沿用 #295 口径）；不传新参数时行为与改造前完全一致，旧 `lead` 参数继续可用
  - **人格取分 SQL**：`scores_json` 是数组快照，按下标同时校验 `key` 与 `standard`（SQLite `json_valid` + `json_extract`，MySQL `JSON_VALID` + `JSON_UNQUOTE(JSON_EXTRACT)` / `CAST(... AS DECIMAL(10,2))`）——**旧快照顺序与当前维度定义不一致时不命中**，不按位置误筛；人格阈值必须是数值参数（SQLite 里 number < text，传字符串会恒不命中）
- **排序（#295）**：学号 / 姓名 / 提交时间可排序，两列测评列不参与排序；SQL 由 `src/lib/profile-query.ts` 的 `buildSubmittedProfilesSql` 统一生成（两适配器共用，`q` 的通配符按字面量、标签按 JSON 元素精确匹配、MySQL 姓名排序显式 `COLLATE utf8mb4_bin`、同值按学号破平）
- **详情弹窗**：新增「职业兴趣测评」区块——三字码徽章 + 六型横向条（顺序/百分比/前三型标记复用结果页 `buildRiasecBars`，与学生端报告必然一致）+ 完成时间 + 「该生重测」指引文案；未测时整块不渲染，**快照缺失/损坏（解析为空）时只显示徽章与时间、不画六条 0**。下发的快照只含 `{ key, standard }`（不带 raw / band / 作答计数），`buildRiasecBars` 对缺 `label` 的轻量快照回退中文型名。弹窗宽度仍 `max-w-md`，不放雷达图；人格的详情区块留给后续 issue（本 issue 只做列表双列与筛选）
- **数据敏感度与权限边界**：列表 GET 沿用档案列表既有权限（`proxy.ts` 放行教师 GET，路由内不做班级收窄——教师能看全校已提交档案的学生），本列只是把「测没测 / 什么型」补进同一行，因此**不新增审计**（与 `/stats/assessment` 等只读 GET 同口径）。它与 #229 的 `/assessment/roster` 不同：后者是**专用的**测评下钻端点、教师恒收窄本人归属班级且每次读取记审计。#229 段落里「全仓唯一」的旧表述已按本节对齐



## 文件存储（#111 对象存储）

- **统一抽象**：`src/lib/storage.ts` 定义 `StorageAdapter`（上传 / 读取 / 删除 / 存在性 / 访问地址签发），文件类型中立；本地实现 `storage-local.ts`（uploads/ 目录）+ S3 兼容实现 `storage-s3.ts`（`@aws-sdk/client-s3`，覆盖腾讯云 COS / 阿里云 OSS / MinIO / AWS S3）
- **多后端注册表**：`storage_backends` 表 + `users.storage_id` 文件级路由；切换默认后端只影响新上传，存量文件按归属后端照常读写；迁移端点幂等（已存在对象跳过）
- **私有读写**：云对象访问一律经 `/api/shared/storage-sign` 签发 30 分钟签名 URL（按角色 + 班级权限校验）；本地后端保持代理路径行为不变；前端经 `useFileUrl` / `StorageImage` 统一解析并缓存签名结果（28 分钟）
- **双端点**：服务端读写（上传/迁移/导出读图）优先内网端点，签名 URL 强制公网端点；对象路径 = `{bucket}/{path_prefix}/{key}`
- **上传约束**：服务端压缩（头像 ≤512×512、历史评价词云图片长边 ≤1024，JPEG 质量 85）、可配置大小上限（默认头像 5MB / 历史词云图片 10MB）、唯一命名不覆盖、SVG 显式拒绝（防存储型 XSS）；#162 起新评价只存文字，评价上传仅兼容存量客户端

## 媒体资源治理（#117 孤儿检测 / #118 缩略图）

- **扫描口径**：`src/lib/media-scan.ts` 枚举全部后端的对象，与 `users`（当前档案）+ `profile_submissions`（历史快照）的引用比对，得出「被引用 / 孤儿」状态与关联学生
- **孤儿保留期**：`configs_profile.media_orphan_retention_days`（1–365 天，默认见代码），仅超期孤儿可删；**不做自动删除**，一律人工在管理面板「系统设置 → 媒体管理」确认后清理
- **清理安全链**：按清单（≤500 条）或 `mode:"all"`；服务端重新扫描自证（引用重查 + 保留期校验），不信任前端；删除源图连带 `_thumb` 缩略图，幂等静默；审计记统计与明细（key 条数受限，超出打 `truncated` 标记）
- **缩略图**：key 派生规则 `{base}.jpg` → `{base}_thumb.jpg`（仅 `.jpg` 派生，常量在 `src/lib/thumbnail-utils.ts`，生成逻辑 `src/lib/thumbnail.ts` 仅服务端）；`generate-thumbnails/status` 只读检测缺失，`generate-thumbnails` 补生成（单文件失败不中断，返回统计）
- **权限**：媒体治理不开放教师，路由内二次校验仅 admin

## 职业测评结果展示（#224 + #292 + #344）

<!-- 对账：视图模型纯函数在 `src/lib/assessment-view.ts`（测试 `assessment-view.test.ts`，含渲染范围判定 `shouldRenderAssessmentResults`）；组件在 `src/components/student/`；数据来自 `/api/shared/assessment/list`（#291，量表清单）+ `/api/shared/assessment/results`（#223，逐套结果）与 `/careers`（#226） -->

- **位置与渲染范围（#344）**：学生面板「我的档案」内容区（hero 之下、Tab/资料区之上）**只在「我的档案」视图、且不在编辑态**渲染测评结果区与页尾授权卡（判定为纯函数 `shouldRenderAssessmentResults(activeView, editing)`）；「我的小组」「历史提交」视图与编辑态不挂载，因而也不会发起 `assessment/list` + 逐套 `results` 请求。范围卡在组装档案资料时隐藏，与「先保存 / 取消，再回来看结果」的交互一致；保存或切回档案视图即恢复
- **与档案提交流程完全解耦**：结果区自己读 `/api/shared/assessment/list` + `/api/shared/assessment/results`，**不看 `submissionClosed` / 截止日期**（档案截止后仍可查看与重测）、不进档案版本快照、不显示「已归档 / 未提交」状态。测评的截止/停用规则只由测评自身（量表 `enabled`）决定；「是否渲染」只看视图与编辑态，与提交截止无关
- **多量表清单（#292）**：**「有哪些启用的量表」只有一个家**——`AssessmentResultsSection` 先取 #291 的 `/api/shared/assessment/list`（只列 `enabled=1` 的量表），再逐套按 `?code=` 并行取本人结果；`/results` 本身不附带清单，避免同一信息两处维护。清单为空（全部量表停用）时整个结果区不占位，停用量表的历史结果仍可按 `?code=` 直读。每套量表一张卡（`AssessmentResultCard`），全部数据由结果区持有，卡片只负责渲染；单套补拉失败只让那一张卡显示重试，不拖垮整个结果区
- **入口分流（红线）**：卡片在入口按 `assessment.scoringMode` 分流（`resultCardMode` 纯函数）——`dimensional` 走大五卡 `FiveFactorResultCard`，其余走霍兰德卡。大五的 E/A/C 与霍兰德同名不同义（外向性 ≠ 企业型、宜人性 ≠ 艺术型、尽责性 ≠ 常规型），所以大五分数**绝不进入** `buildRiasec*` / `parseTypeCodeParts` / 职业推荐；分流看模式而不是「三字码是不是 null」
- **霍兰德卡（#224）**：三字码徽章（`bg-brand` 深绿块 + 每枚字母的中文型名）→ 六型雷达图（recharts `RadarChart`，量程固定 0–100、不画半径刻度）与条状排名并列（排名标出三字码里的「主要兴趣」）→ 六型逐条通俗解读（按排名顺序，不出现「维度 / 标准分 / 口径」等术语）→ 推荐职业（#226，渐进增强）→ 页尾合规指针（#322：署名与免责全文只在页尾出现一次）
- **大五卡（#292）**：头部画像标签取最高两维（如「高开放性 · 高尽责性」；两维都没过 50 分中线时写「偏低开放性 · 偏低尽责性」，与逐维解读同口径，避免同一张卡自相矛盾）→ 五维雷达（N-E-O-A-C 顺序）+ 条状排名（前两维标「主要特质」）→ 逐维解读按 50 分中线取高分 / 低分文案（5 维 × 2 = 10 段，`BIG_FIVE_INTERPRETATIONS`）→ 页尾合规指针。**无三字码、无职业推荐**
- **折叠层级（#322）**：每套启用中的量表一张折叠卡（`CollapsibleCard`：`button + aria-expanded + aria-controls`，默认收起、键盘可达、焦点可见）；折叠态只显示「量表名 + 已测 / 进行中 / 未测 + 本次题量 · 完成时间 · 第 N 次」，未测在标题右侧给「去测评」；展开态完整保留雷达、条形、逐条解读与全部推荐职业。内容用**条件挂载**而非 CSS 隐藏，避免雷达图在 0 宽容器里初始化
- **「人格与兴趣一起看」提示卡（#292 / #322）**：霍兰德与大五**各有一份当前结果**时出现在卡片下方（按计分模式判定，不是「完成数 ≥ 2」），同样是默认收起的折叠卡；用学生语言解释三组常见对应（S↔宜人性、E↔外向性、C↔尽责性，`CROSS_SCALE_LINKS`），文案是条件句、不对具体结果下判断，并说明两边不一致也正常
- **合规位置（#322）**：署名、授权与免责全文收编到页尾一张「关于这些测评 · 授权与免责」折叠卡（`AssessmentAttributionCard(collapsible)`），按量表分组展示 `attribution` / `licenseText`，免责声明按文本去重、不同文案各带量表归属，职业推荐的 **CC BY 4.0 署名**也在同一张卡；结果卡内只留一行「授权信息见页尾」指针。**合规卡默认展开**（结果卡才是需要折叠的主体）：声明正文无需展开即可见、可 Ctrl+F、可被屏幕阅读器读到，指针锚点也落在正文上；仍可手动收起，收起后由 `keepMounted` 保留 DOM 文本。分组 / 去重 / O*NET 兜底判定在 `assessment-view.ts#buildAttributionGroups`（纯函数，有单测）
- **页尾数据来源（#322）**：`AssessmentResultsSection` 仍是唯一数据源（list + 逐套 results + 一次 `/careers`），通过 `onData` 把量表声明回传页面渲染页尾卡，**不重复请求**；结果卡只消费父级数据
- **卡片口径行（#283 + #292 + #322）**：折叠态标题下统一显示「本次 N 题 · 完成于 … · 第 N 次」，题量取自该条结果快照，版本数取自 `history`（撞上接口上限显示 `10+`，由 `buildResultTrailing` 统一拼装）；状态由 `resultCardStatus` 纯函数判定（有当前结果 > 有草稿 > 未开始）
- **视图模型先行**：`assessment-view.ts` 是纯函数层（补齐缺失维度、排序破平、三字码规范化、大五画像 / 条形 / 高低分解读、雷达点泛化、职业卡清洗与命名兜底、结果卡状态、页尾授权分组与去重），组件只负责画。雷达图由 `ScoreRadarChart` 传维度点渲染，霍兰德卡复用
- **雷达图兜底（#322）**：不再用 `ResponsiveContainer` 百分比宽度（grid/flex 下可能量到 0，只剩空边框）；改为先量容器宽度、再用显式宽高画图——无顶点 / 宽度 0 不渲染图表框，渲染异常由错误边界降级为一行说明，条形排名始终可用
- **推荐职业渐进增强（#226 / #322）**：只在霍兰德有当前结果时由结果区补拉一次 `/careers`；接口失败 / 为空 / 无中文数据时**整块静默不渲染**（`console.error` 留痕，不打断学生）。命名兜底：有中文名 → 中文名为主 +「职业群 · 学历」meta；缺中文名 → 「职业群 · 学历」为主、英文原名只作 11px 小字，避免长英文名挤占卡片；两样都缺退回「职业方向」
- **无结果空态**：每套量表自己的空态——折叠卡标题用该量表名，题量与预计耗时复用 `assessment-center.ts` 的统一口径（不写死数字），标题右侧 CTA 带 `?code=` 直达答题页；有未完成草稿时提示「上次答到 N/M」并把 CTA 改成「继续作答」
- **容错**：首屏清单接口（`/list`）失败时整区显示「暂时读不到」+ 重试，不会把失败说成「没做过测评」；单套结果补拉失败只影响那一张卡；得分缺 `standard` 等脏数据在 `parseScores`（#223）与视图模型两层过滤，不用坏数据渲染

## 数据导出（#233 / #331）

<!-- 对账：列定义与格式化纯函数在 `src/lib/export-columns.ts`（测试 `export-columns.test.ts`）；导出请求共享层在 `src/lib/export-request.ts`；路由 `src/app/api/manage/export/route.ts`；界面 `src/components/admin/ExportTab.tsx` / `ExportProfilesDialog.tsx` -->

- **两个入口共用一套列定义**：管理/教师面板「数据导出」页负责范围 / 日期 / 学号 / 图片放置；「数据列表」卡头右侧「导出名单」（#331）固定导出**当前筛选结果（含所有页）**，两者都消费 `EXPORT_COLUMNS` 与 `export-request.ts` 的请求参数拼装，避免两套列定义分叉
- **列分两组**：基础信息（班级 / 学号 / 姓名 / 标签 / 学生头像 / 历史评价词云图片 / 他人评价1–3 / 头像 URL / 历史评价词云图片 URL / 提交时间）与职业测评（测评状态 / 测评完成时间 / 霍兰德三字码 / 六型得分 / 推荐职业 Top3 / 人格特质 / 大五得分）。**默认列集合在 #233 基线上追加他人评价1–3**（#162；历史图片列保留以兼容存量），其余新增列（含 #331 的人格列）一律增量勾选
- **列顺序以 `EXPORT_COLUMNS` 为准**（与前端勾选顺序无关）：#331 的 `personality_traits` / `big_five_scores` **追加在末尾**，既有列顺序与 xlsx 图片锚点（`columnLetter` / `imageColumnIndex`）完全不变；评价文字列在 CSV 中单行化并对 `= + - @` 开头做公式注入防护，在 XLSX 中自动换行
- **六型得分两种形态**：合成一列 `R42 I38 A20 S74 E31 C25`，或拆成 R/I/A/S/E/C 六列；取结果快照的 0–100 标准分并取整，两种形态共用同一口径
- **大五列（#331）**：读取启用中的 `dimensional` 量表当前有效结果（`completed + is_current=1`），按学号集合一次批查；`personality_traits` 复用结果页 `buildBigFiveHeadline`（Top2 画像，如「高开放性 · 高尽责性」），`big_five_scores` 按 `dimensions_json` 顺序输出 `N42 E58 O71 A44 C66`；未测 / 快照缺失整格留空，不补 0
- **班级名**：学生行自带 `class_id`，内存关联班级表得到班名（不新增 SQL 联表）；未分班为空串
- **测评列取值**：只认 `assessment_results` 的当前有效完成结果（`status=completed` + `is_current=1`），按学号集合**一次批查**（`getCurrentAssessmentResultsByUserCodes`，适配器内 500 分片）；未测评学生整格留空（不填 0 / undefined），状态列为「未测」
- **筛选下推（#331）**：`GET /api/manage/export` 接受与列表一致的 `q` / `tag` / `interest` / `personality`，解析与人格维度下标解析复用 `profile-query.ts`；带筛选时按 `buildSubmittedProfilesSql` 同一份 SQL **全量取行（不分页）**，`scope` / `ids` / `dateFrom` / `dateTo` 语义保留；无筛选时仍走原 `getAllSubmitted`，行为不变
- **推荐职业 Top3**：复用 #226 的匹配纯函数（画像取结果快照六维分、候选由 `toCareerCandidates` 从 `onet_occupations` 转），输出中文名（无译名回退英文名）分号分隔；职业库为空时该列不输出内容，界面按钮置灰并悬停说明（`?capabilities=1` 探测），**不隐藏**
- **审计沿用**：导出动作仍记 `export:excel`（只记范围 / 列数 / 格式 / 是否筛选，明细不入库）；本 Issue 不做脱敏（教师本地留存）

## 他人评价与词云（#162）

- **采集**：学生代三位不同的人提交三条匿名自由评价，每条 1–300 字，固定三条且必填；系统无法验证评价人身份，只校验三条非空。存量仅历史图片账户在编辑时三条留空可保留旧图，部分填写仍 400。
- **落库**：`users.evaluation_text` / `profile_submissions.evaluation_text` 存 JSON 数组；`evaluation_url` 仅历史图片。保存三条文字时清空当前 `evaluation_url`，旧图仍由历史快照引用；历史被裁剪后进入 #117 孤儿清单，不自动删除。
- **词表**：服务端用 `Intl.Segmenter` 分词，过滤停用词、单字、纯数字与泛称；同一条评价内去重，权重 = 提及人数（1–3），同权重按总频次、再按文本排序，取前 30 词。词表不落库，按当前算法实时推导。
- **渲染**：前端 `EvaluationWordCloud` 用确定性螺旋布局（无随机数、无旋转、明暗配色），学生/教师/管理员/历史版本共用；数据列表主行只显示评价摘要，不塞微型词云，详情与版本历史可渲染紧凑词云。
- **媒体**：新评价不产生图片；`/api/upload` 的 evaluation 前缀、评价缩略图、媒体扫描/孤儿清理、存储签名与迁移保留为存量兼容。
- **#164 例外**：新增 `evaluation_text` 是替换既有评价维度（不是新增采集维度）；未来全新维度仍走自定义字段表。

## 数据流

```
学生端（档案提交，#168 / #208 / #162）：登录 → 学生面板「我的档案」→ 未提交学生直接就地填写（标签与三条他人评价为必填项、虚拟形象可选填；空标签或未填满三条评价由服务端 400 拦截）→ 二次确认后提交；已提交学生走「修改数据」就地修改；每次保存生成新版本（#95）。仅历史图片账户在编辑时三条留空可保留旧图，填写三条后替换为自动生成的词云
学生端（登录态）：学生面板「我的档案」通览本人档案；「历史提交」Tab 查看/恢复旧版本（#95）；档案内容上方的测评结果区（#224 + #292）按量表清单独立读取本人结果快照，每套量表一张卡——霍兰德卡含三字码、六型雷达图/排名/解读与推荐职业，大五卡含画像标签、五维雷达/排名/高低分解读（推荐为渐进增强），两套都完成时附「人格与兴趣一起看」提示卡；「我的小组」看本组成员的姓名、学号与标签（#101，未分组给空态）
学生端（激活）：/activate 第一步 verify 三要素核验（#93）→ 第二步设置密码并自动登录
学生端（职业测评，#222/#223/#225）：侧边栏「职业测评」→ 测评中心（三态状态卡：未开始 / 进行中 / 已完成 + 测验清单 / 六型科普 / 学职平台外链 / 授权与免责四张内容卡）→「开始 / 继续作答」进答题页单题单屏（每题自动存草稿，可退出续答）→ 全部答完后二次确认提交 → 服务端计分并按快照落库 → 答题页展示三字码与六维分；完整解读在「我的档案」测评区（#224）
教师端：登录 → 主页（问候 + 分组快捷入口，**不含统计数字**）→ 数据中心（概览/大屏/导出）→ 数据管理（数据列表/学生/班级/课堂分组/标签）→ 系统设置（功能设置/操作审计）
管理端：登录 → 数据中心（概览/大屏/导出/提交历史）→ 用户管理（学生/教师/班级/课堂分组/标签）→ 系统设置（数据源/功能设置/存储管理/媒体管理/操作审计/演示环境）
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
