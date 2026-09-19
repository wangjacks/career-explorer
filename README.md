# Career Explorer

> [!NOTE]
> 这是一个专对性较强的项目，泛用性不大，只是public了而已。后续会考虑继续改善这个项目，增加能够泛用的功能。

学生职业探索工具 —— 学生通过标签选择、词云可视化和档案生成探索职业兴趣方向；教师按班级管理名单与数据；管理员负责全局统计、导出与系统设置。

## 主要能力

- 三角色统一账户体系（管理员 / 教师 / 学生），学生凭学号 + 姓名 + 班级邀请码激活
- 学生档案：多步表单、草稿暂存、提交截止、历史版本查看与恢复
- 教师 / 管理员面板：数据概览与大屏、导出、学生与班级与标签管理、操作审计
- 文件存储：本地目录或 S3 兼容对象存储（私有读写 + 限时签名 URL）

## 技术栈

Next.js 16 (App Router) · React 19 · TypeScript strict · Tailwind CSS v4 · MySQL / SQLite 双适配器

## 本地开发

```bash
npm install
npm run dev
```

访问 http://localhost:3000 。首次使用需**手动打开 `/setup`** 完成安装引导（配置数据库 + 管理员密码），未安装时不会自动跳转。

## 文档

| 文档 | 内容 |
|---|---|
| [docs/overview.md](./docs/overview.md) | 项目概况、完整技术栈、目录结构、路线图 |
| [docs/architecture.md](./docs/architecture.md) | 页面 / API 路由、数据库表、权限模型、面板导航 |
| [docs/standards.md](./docs/standards.md) | 分支、提交、PR、发布流程与环境变量规范 |
| [DEPLOY.md](./DEPLOY.md) | 服务器部署、Nginx、HTTPS、对象存储与运维排障 |
