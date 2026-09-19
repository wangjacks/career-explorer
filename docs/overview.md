# Career Explorer — 项目概况

## 项目简介

学生职业探索工具。通过标签选择、词云可视化和档案生成，帮助学生发现职业兴趣方向。原为微信小程序，重构为 Next.js Web 应用。v2.0.0 起采用三角色统一用户体系（管理员 / 教师 / 学生）。

> **文档分工**：本文是技术栈、目录结构与路线图的权威来源；对外门面见 `README.md`，路由与数据库 Schema 见 `docs/architecture.md`，开发与环境变量标准见 `docs/standards.md`，部署见 `DEPLOY.md`。同一信息只在一处维护，其他文件用指针引用。

## 技术栈

<!-- 对账：键集合以 package.json dependencies 为准，本清单只记用途，不逐包罗列 -->

- **框架：** Next.js 16 (App Router) + React 19 + TypeScript（严格模式）
- **UI：** Tailwind CSS v4（品牌色 token 见 `docs/ui-conventions.md`）+ lucide-react 图标
- **数据库：** MySQL (mysql2) / SQLite (better-sqlite3) 双适配器，统一 `DbAdapter` 接口
- **认证：** jose (JWT HS256) + bcrypt
- **导出：** ExcelJS / JSZip（XLSX 支持原生单元格图片，尺寸探测用 image-size）
- **图片：** Sharp（服务端压缩 + 缩略图生成 #118）
- **对象存储：** 本地目录 / S3 兼容协议（@aws-sdk/client-s3 + s3-request-presigner 签发限时 URL；覆盖腾讯云 COS、阿里云 OSS、MinIO、AWS S3）
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

首次访问进入 `/setup` 安装引导配置数据库与管理员密码。

## 部署

参见 `DEPLOY.md`。

## 目录结构

<!-- 对账：本树只到模块级，不下钻文件；文件级清单请现读（ls src/lib/、ls src/components/admin/、find src/app/api -name route.ts） -->

```
src/
├── app/
│   ├── page.tsx               # 首页
│   ├── about/                 # 关于页
│   ├── login/                 # 三角色统一登录
│   ├── activate/              # 学生账户激活（两步：核验 → 设密码）
│   ├── setup/                 # 安装引导
│   ├── form/create-profile/   # 学生档案表单（单路由多步）
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
└── __tests__/                 # Vitest 测试，与被测模块同名（改模块必须同步改同名测试）
```

`src/lib/` 分组约定（不列文件，按需 `ls src/lib/`）：

| 前缀 / 名称 | 职责 |
|---|---|
| `db*.ts` | `DbAdapter` 接口 + SQLite / MySQL 双适配器 + `db-config.json` 读写 |
| `storage*.ts` | 存储抽象 + 本地 / S3 兼容实现（#111） |
| `media-scan.ts`、`thumbnail*.ts` | 媒体扫描与孤儿检测（#117）、缩略图派生与生成（#118） |
| `profile-*.ts`、`draft-idb.ts` | 档案提交共享逻辑、表单纯逻辑、IndexedDB 草稿 |
| `auth.ts`、`token.ts`、`password.ts`、`activate.ts`、`sanitize.ts` | 密码校验、JWT、强密码生成、激活核验、URL 安全 |
| `audit.ts` | 操作审计（#110，失败静默降级） |
| `tag*.ts`、`invite-poster.ts`、`xlsx-cell-images.ts` | 标签工具与预设种子、邀请海报（#102）、Excel 单元格图片 |

完整页面路由、API 路由与数据库 Schema 见 `docs/architecture.md`。

## 开发路线图

- **当前状态**：`v2.0.0` 已于 2026-09-03 正式发布（tag `v2.0.0`），`dev` 上为发布后的依赖升级与小修
- **开放节奏（计划，非系统承诺）**：2026-09-16《大学生职业生涯规划》首堂课仅口头提及本系统、不开放使用；2026-09-30 正式向学生开放（开放与否靠是否发放访问地址与邀请码人工掌握，不设站点开关）
- **post-v2 已定方向（2026-09-04 复盘会，多数尚未落进代码）**：
  - 表单首页改为「项目列表」入口，现有分步表单是列表第一项，同级新增标准化测评（霍兰德职业兴趣、16 人格等），评分细则导入后由服务端自动计分判定类型（#104）
  - 词云采集方式反转：由「学生上传词云图片」改为「学生填文字评价、词云由服务端生成」，动因是图片不可量化、可分析维度少
  - `users` 表不再新增固定列（民族、政治面貌等课程不需要），扩展采集维度改走一张自定义字段表
  - 推荐算法不锁定 ItemCF，标签交集打分 / TF-IDF 等一并评估（#101）
- **明确不做 / 暂缓**：多实例与负载均衡（规模 400–500 学生 + ≤10 名教师）、孤儿媒体自动删除（维持保留期可配 + 人工确认清理）、炫技式大屏包装（大屏本身仍要扩展呈现维度）
- **历史规划存档**：`docs/plan-v2.0.0.md`、`docs/plan-v2.0.0-uiux.md`
