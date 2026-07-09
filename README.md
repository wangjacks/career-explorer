# Career Explorer

学生职业探索工具 —— 通过标签选择、词云可视化和档案生成，帮助学生发现职业兴趣方向。

## 功能特性

- **标签选择** — 兴趣/技能/性格三维度职业标签，支持自定义标签
- **词云展示** — 基于所选标签实时生成可视化词云
- **评价词云上传** — 上传评价词云图片
- **虚拟形象** — 头像上传与预览
- **学号验证** — 12 位学号验证，支持恢复上次填写记录
- **管理员面板** — 数据查看/删除/统计/批量操作
- **数据导出** — Excel/CSV 导出，支持筛选、列选择、图片打包
- **批量导入** — 学生名单批量导入，自动识别标题行
- **安装引导** — 首次部署自动引导数据库配置

## 技术栈

- Next.js 16 (App Router)
- React 19
- TypeScript
- Tailwind CSS v4
- MySQL (via mysql2)
- ExcelJS / JSZip / Sharp

## 本地开发

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

访问 http://localhost:3000

首次访问会进入安装引导页面，配置 MySQL 数据库连接后即可使用。

## 部署

详见 [DEPLOY.md](./DEPLOY.md)

## 项目结构

```
src/
├── app/
│   ├── page.tsx              # 首页
│   ├── student/page.tsx      # 学号验证
│   ├── tags/page.tsx         # 标签选择
│   ├── wordcloud/page.tsx    # 词云展示
│   ├── evaluation/page.tsx   # 评价词云上传
│   ├── avatar/page.tsx       # 头像上传
│   ├── complete/page.tsx     # 提交完成
│   ├── admin/page.tsx        # 管理员面板
│   ├── setup/page.tsx        # 安装引导
│   └── api/                  # API 路由
├── components/               # 公共组件
├── lib/                      # 数据库、配置、标签数据
└── types/                    # TypeScript 类型定义
```
