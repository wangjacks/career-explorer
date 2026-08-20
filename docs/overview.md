# Career Explorer — 项目概况

## 项目简介

学生职业探索工具。通过标签选择、词云可视化和档案生成，帮助学生发现职业兴趣方向。原为微信小程序，重构为 Next.js Web 应用。

## 技术栈

- **框架：** Next.js 16 (App Router)
- **UI：** React 19 + TypeScript + Tailwind CSS v4
- **数据库：** MySQL (via mysql2)
- **导出：** ExcelJS / JSZip
- **图片：** Sharp
- **通知：** Sonner

## 开发环境

- Node.js 24 LTS
- npm
- MySQL 5.7+ / MariaDB 10.3+

## 本地启动

```bash
npm install
npm run dev
```

访问 http://localhost:3000，首次进入安装引导页面配置数据库。

## 部署

参见 `DEPLOY.md`。

## 目录结构

```
src/
├── app/           # Next.js App Router 页面 + API
│   ├── page.tsx   # 首页
│   ├── student/   # 学号验证
│   ├── tags/      # 标签选择
│   ├── wordcloud/ # 词云展示
│   ├── evaluation/# 评价词云上传
│   ├── avatar/    # 头像上传
│   ├── complete/  # 提交完成
│   ├── admin/     # 教师管理面板
│   ├── setup/     # 安装引导
│   ├── dev/       # 🔜 开发者面板（规划中）
│   └── api/       # API 路由
├── components/    # 公共组件
├── lib/           # 工具库 (数据库、配置、标签数据)
└── types/         # TypeScript 类型定义
```

## 开发路线图（v2.0.0）

| 阶段 | 内容 | 关联 Issues | 状态 |
|---|---|---|---|
| Phase 1 | 安全漏洞修复（路径穿越防护 + CI 权限最小化） | #15 #26 | ✅ #15 已完成 |
| Phase 2 | 生产 Bug 修复（chunk 404、viewport、evaluationUrl、InstallGuard） | #8 #13 #14 #16 | ✅ PR #24 已提交 |
| Phase 3 | Admin 组件拆分（巨石页面 → 3 个 Tab 子组件 + 共享 hooks） | #17 | 🔜 待开始 |
| Phase 4 | 认证安全重构（bcrypt + httpOnly Cookie + middleware） | #18 | 🔜 待开始 |
| Phase 5 | 数据大屏（stats API 扩展 + recharts 图表） | #19 #20 | 🔜 待开始 |
| Phase 6 | 响应式适配 + 安全收尾（响应式 + 空 catch + XSS 修复） | #21 #22 #25 | 🔜 待开始 |

详见 `docs/plan-v2.0.0.md`。
