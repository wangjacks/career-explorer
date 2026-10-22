# Career Explorer — 项目概况

## 项目简介

学生职业探索工具。v3.0.0 起支持标签档案、职业测评、课堂分组与小组协作、教师数据看板与演示沙箱。原为微信小程序，重构为 Next.js Web 应用；v2.0.0 起采用三角色统一用户体系（管理员 / 教师 / 学生）。

> **文档分工**：本文是技术栈、目录结构与路线图的权威来源；对外门面见 `README.md`，路由与数据库 Schema 见 `docs/architecture.md`，开发与环境变量标准见 `docs/standards.md`，部署见 `DEPLOY.md`。同一信息只在一处维护，其他文件用指针引用。

## 技术栈

<!-- 对账：键集合以 package.json dependencies 为准，本清单只记用途，不逐包罗列 -->

- **框架：** Next.js 16 (App Router) + React 19 + TypeScript（严格模式）
- **UI：** Tailwind CSS v4（品牌色 token 见 `docs/ui-conventions.md`）+ lucide-react 图标
- **数据库：** MySQL (mysql2) / SQLite (better-sqlite3) 双适配器，统一 `DbAdapter` 接口
- **认证：** jose (JWT HS256) + bcrypt
- **导出：** ExcelJS / JSZip（XLSX 支持原生单元格图片，尺寸探测用 image-size）
- **图片：** Sharp（服务端压缩 + 缩略图生成 #118）
- **对象存储：** 本地目录 / S3 兼容协议（`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` 签发限时 URL；覆盖腾讯云 COS、阿里云 OSS、MinIO、AWS S3）
- **二维码：** qrcode（班级邀请海报 #102，SVG → Sharp 栅格化 PNG）
- **通知：** Sonner；**图表：** Recharts；**测试：** Vitest

## 开发环境

- Node.js 24 LTS
- npm
- MySQL 5.7+ / MariaDB 10.3+，或 SQLite（零配置）

```bash
npm install
npm test        # 单元测试
npm run dev     # 本地开发（由开发者自行启动）
```

首次使用需**手动打开 `/setup`** 完成安装引导（配置数据库 + 管理员密码）；InstallGuard 已移除，未安装时不会自动跳转。

## 部署

参见 `DEPLOY.md`。

## 目录结构

<!-- 对账：本树只到模块级，不下钻文件；文件级清单请现读（ls src/lib/、ls src/components/admin/、find src/app/api -name route.ts） -->

```
scripts/                       # 离线数据导入脚本（O*NET 职业库，#226）
src/
├── app/
│   ├── page.tsx               # 首页
│   ├── about/                 # 关于页
│   ├── login/                 # 三角色统一登录
│   ├── activate/              # 学生账户激活（两步：核验 → 设密码）
│   ├── setup/                 # 安装引导
│   ├── dashboard/
│   │   ├── admin/             # 管理面板
│   │   ├── teacher/           # 教师面板
│   │   └── student/           # 学生面板
│   └── api/
│       ├── auth/              # 登录 / 会话 / 激活（含 activate/verify）
│       ├── manage/            # 管理域 API（proxy 权限拦截）
│       ├── shared/            # 自鉴权共享 API（档案、提交历史、存储签名）
│       └── tags|upload|uploads|setup/
├── components/
│   ├── *.tsx                  # 全站公共组件（导航、用户菜单、页脚、错误边界、上传框、词云等）
│   ├── admin/                 # 管理/教师面板子组件，面板页一律命名 *Tab.tsx
│   ├── dashboard/             # 面板共用布局（管理/教师侧边栏 PanelSidebar）
│   └── student/               # 学生面板布局（侧边栏 StudentSidebar）
├── hooks/                     # 客户端自定义 hook，一律 use*.ts
├── lib/                       # 服务端数据层与工具，按前缀分组（见下）
├── proxy.ts                   # 角色权限中间件
├── types/                     # 类型定义
└── __tests__/                 # Vitest 测试，按被测模块或 API 路由命名（改代码必须同步改对应测试）
```

`src/lib/` 分组约定（只列前缀，具体文件名现读 `ls src/lib/`）：

| 分组 | 职责 |
|---|---|
| `db*` | `DbAdapter` 接口 + SQLite / MySQL 双适配器 + `db-config.json` 读写 |
| `storage*` | 存储抽象 + 本地 / S3 兼容实现（#111） |
| `media-*` / `thumbnail*` | 媒体扫描与孤儿检测（#117）、缩略图派生与生成（#118） |
| `profile-*` | 档案提交共享逻辑（表单/面板提交共用；`draft-*` 草稿暂存已于 #168 随分步向导移除） |
| `assessment-*` | 职业测评：量表定义与 120 题库种子（#221 / #281，题库只增不改升级与种子校验）+ 通用计分引擎（Likert → 维度原始分 → 标准分 → 类型码 / 高低分档，#220）+ 作答流程校验与续答（#223）+ 结果视图 / 教师端统计与大屏视图口径（#224/#229/#314/#315） |
| `onet*` | O*NET 职业库：数据快照（自动生成）+ 离线导入种子 + 中文译名与职业群/学历映射（#226）；匹配算法同属 `assessment-match.ts` |
| `grouping-*` / `group-workspace-*` | 课堂分组：特征源注册表、算法、预览与组长（#101/#345）；学生小组工作区访问与视图（#346） |
| `tag*` | 标签工具与预设种子 |
| `demo-*` | 演示沙箱：AsyncLocalStorage 请求级数据源作用域 + `withDemoScope` 路由包装器（#250/#274，演示 token 的 DB 访问物理隔离到独立演示库；proxy 按 `DEMO_ALLOWED` 收敛） |
| 认证与安全 | JWT 签发校验、密码校验与生成、激活核验、URL 安全 |
| 审计 | 操作审计（#110，失败静默降级） |
| 输出物 | 邀请海报（#102）、Excel 单元格图片 |

完整页面路由、API 路由与数据库 Schema 见 `docs/architecture.md`。

## 开发路线图

- **当前状态**：`v3.0.0` 已于 2026-10-23 发布（tag `v3.0.0`）；`dev` 进入 v3.1.0 打磨。
- **v3.0.0 已完成**：职业测评（120 题库、每轮 30 题、IPIP 大五、O\*NET 推荐）、课堂分组 v2 与学生小组工作区、演示沙箱、面板独立路由、档案信息架构与三条匿名评价、数据看板与自定义导出、版权与第三方许可文件。
- **v3.1.0 方向**：MySQL / 旧备份升级冒烟（#376）、分组与测评的遗留验收、文档与体验收尾；详见 v3.1.0 milestone。
- **明确不做 / 暂缓**：多实例与负载均衡（规模 400–500 学生 + ≤10 名教师）、孤儿媒体自动删除（维持保留期可配 + 人工确认清理）、炫技式大屏包装（大屏本身仍要扩展呈现维度）。
- **历史规划存档**：`docs/plan-v2.0.0.md`、`docs/plan-v2.0.0-uiux.md`
