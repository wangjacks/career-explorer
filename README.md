# Career Explorer

学生职业探索工具。面向学校课堂，帮助学生完成职业兴趣探索、职业测评与课堂分组协作；教师按班级管理名单、组织分组并查看数据看板；管理员负责账户、权限与数据治理。

## 主要能力

- 三角色统一账户体系（管理员 / 教师 / 学生），学生凭学号 + 姓名 + 班级邀请码激活
- 学生档案：标签、三条匿名他人评价、本地词云、头像、提交截止与历史版本查看/恢复
- 职业测评：霍兰德兴趣（120 题库，每轮 30 题）与大五人格（IPIP 50 题），草稿续答、结果雷达与 O\*NET 推荐职业
- 课堂分组：标签 / 兴趣 / 性格三特征源、三种策略、预览调组、组长；学生小组工作区（公告、任务、认领、已读）
- 教师 / 管理员：测评看板、班级完成矩阵、双测评列、服务端筛选/排序、自定义列导出、操作审计、账户 / 班级 / 标签 / 存储管理
- 演示沙箱：独立演示库与上传目录，访客三身份、角色切换与 `/login?demo=1` 登录
- 文件存储：本地目录或 S3 兼容对象存储（私有读写 + 限时签名 URL）

## 技术栈

Next.js 16 (App Router) · React 19 · TypeScript strict · Tailwind CSS v4 · MySQL / SQLite 双适配器 · Node.js 24

## 本地开发

```bash
npm ci
npm run dev
```

访问 http://localhost:3000 。首次使用需**手动打开 `/setup`** 完成安装引导（配置数据库 + 管理员密码），未安装时不会自动跳转。

```bash
npm test
npm run lint
npm run build
```

## 演示模式

```env
DEMO_ENABLED=true
#DEMO_DB_PATH=./data/career-demo.db
```

演示库与 `uploads/demo/` 和生产物理隔离。启用后由生产管理员在「演示环境」发放访客账户，通过 `/login?demo=1` 登录；演示入口不在普通登录页暴露。

## 版权与许可

原创代码、文档与设计的版权，以及第三方组件与数据的许可，见 [LICENSE](./LICENSE)、[NOTICE](./NOTICE) 与 [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md)。

## 文档

| 文档 | 内容 |
|---|---|
| [docs/overview.md](./docs/overview.md) | 项目概况、完整技术栈、目录结构、路线图 |
| [docs/architecture.md](./docs/architecture.md) | 页面 / API 路由、数据库表、权限模型、面板导航 |
| [docs/standards.md](./docs/standards.md) | 分支、提交、PR、发布流程与环境变量规范 |
| [DEPLOY.md](./DEPLOY.md) | 服务器部署、Nginx、HTTPS、对象存储与运维排障 |
