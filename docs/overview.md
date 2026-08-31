# Career Explorer — 项目概况

## 项目简介

学生职业探索工具。通过标签选择、词云可视化和档案生成，帮助学生发现职业兴趣方向。原为微信小程序，重构为 Next.js Web 应用。v2.0.0 起采用三角色统一用户体系（管理员 / 教师 / 学生）。

## 技术栈

- **框架：** Next.js 16 (App Router) + React 19 + TypeScript（严格模式）
- **UI：** Tailwind CSS v4（品牌色 token 见 `docs/ui-conventions.md`）
- **数据库：** MySQL (mysql2) / SQLite (better-sqlite3) 双适配器，统一 `DbAdapter` 接口
- **认证：** jose (JWT HS256) + bcrypt
- **导出：** ExcelJS / JSZip（XLSX 支持原生单元格图片）
- **图片：** Sharp（服务端压缩 + 缩略图生成）
- **对象存储：** 本地目录 / S3 兼容协议（腾讯云 COS、阿里云 OSS、MinIO 等）
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

```
src/
├── app/
│   ├── page.tsx               # 首页
│   ├── login/                 # 三角色统一登录
│   ├── activate/              # 学生账户激活（学号+姓名+邀请码）
│   ├── setup/                 # 安装引导
│   ├── form/create-profile/   # 学生档案表单（单路由多步）
│   ├── dashboard/
│   │   ├── admin/             # 管理面板
│   │   ├── teacher/           # 教师面板
│   │   └── student/           # 学生面板
│   └── api/
│       ├── auth/              # 登录 / 会话 / 激活
│       ├── manage/            # 管理域 API（proxy 权限拦截）
│       ├── shared/            # 自鉴权共享 API（档案、存储签名）
│       └── tags|upload|uploads|setup/
├── components/                # 公共组件（admin/ 为面板子组件）
├── hooks/                     # useSession / useTheme / useProfileDraft 等
├── lib/                       # db 双适配器、storage 存储抽象、audit 等
├── proxy.ts                   # 角色权限中间件
├── types/                     # 类型定义
└── __tests__/                 # Vitest 单元测试
```

完整页面路由、API 路由与数据库 Schema 见 `docs/architecture.md`。

## 开发路线图

- 当前 Milestone：`v2.0.0` 正式发布收官，进度见 GitHub Milestone 与 Issue #81
- 历史规划存档：`docs/plan-v2.0.0.md`、`docs/plan-v2.0.0-uiux.md`
