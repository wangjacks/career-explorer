# 重构计划：微信小程序 → Next.js Web 应用

## 1. 项目结构

```
career-miniapp-webver-demo/
├── package.json
├── next.config.js
├── tsconfig.json
├── tailwind.config.js
├── .env.local                    # 数据库路径、上传配置
├── public/
│   └── avatars/                  # 预设头像
├── src/
│   ├── app/
│   │   ├── layout.tsx            # 根布局（对应 app.ts）
│   │   ├── page.tsx              # 首页（对应 pages/index/）
│   │   ├── tags/page.tsx         # 标签选择（对应 pages/tags/）
│   │   ├── wordcloud/page.tsx    # 词云展示（对应 pages/wordcloud/）
│   │   ├── avatar/page.tsx       # 头像上传（对应 pages/avatar/）
│   │   ├── complete/page.tsx     # 完成页（对应 pages/complete/）
│   │   └── api/
│   │       ├── profile/route.ts  # 保存/查询用户档案
│   │       └── upload/route.ts   # 文件上传
│   ├── components/
│   │   ├── NavigationBar.tsx     # 导航栏组件
│   │   └── WordCloudCanvas.tsx   # wordcloud2.js 封装
│   ├── lib/
│   │   ├── db.ts                 # SQLite 数据库
│   │   └── tagData.ts            # 标签分类数据
│   └── types/
│       └── index.ts              # 类型定义
└── uploads/                      # 用户上传的头像文件
```

## 2. 小程序 → Next.js 对照表

| 小程序 | Next.js | 说明 |
|---|---|---|
| `app.ts` onLaunch | `layout.tsx` | 根布局、全局状态 |
| `app.json` 路由 | `app/` 文件路由 | App Router |
| `wx.setStorageSync` | API + SQLite | 后端持久化 |
| `wx.navigateTo` | `<Link>` / `useRouter()` | 页面跳转 |
| `wx.showToast` | toast 库 | sonner |
| `wx.chooseAvatar` | `<input type="file">` | 文件上传 |
| CSS 词云 | `wordcloud2.js` canvas | 专业词云库 |
| `navigation-bar` 组件 | `NavigationBar.tsx` | Web 版导航栏 |

## 3. 页面实现

### 首页（`/`）
- 标题 + "开始探索" 按钮
- `<Link href="/tags">` 跳转

### 标签页（`/tags`）
- 3 个分类（兴趣/技能/性格），点击切换选中状态
- 自定义标签输入框 + 添加按钮
- 状态：`selectedTags[]`、`customInput`
- "下一步" → 存 `localStorage` → 跳转 `/wordcloud`
- 校验：至少选 1 个标签

### 词云页（`/wordcloud`）
- 从 `localStorage` 读取标签
- `wordcloud2.js` 渲染 canvas 词云
- 配置：随机颜色、字号 20-60px、旋转 ±30°
- "下一步" → 跳转 `/avatar`

### 头像页（`/avatar`）
- `<input type="file" accept="image/*">` 选择文件
- `URL.createObjectURL()` 预览
- "上传并继续" → POST `/api/upload` 保存文件 → POST `/api/profile` 保存档案 → 跳转 `/complete`

### 完成页（`/complete`）
- 成功提示 + 摘要（标签数、头像）
- "返回首页" → `<Link href="/">`

## 4. 后端 API

### `POST /api/profile` — 保存用户档案
- 接收 `{ tags: string[], avatarUrl: string }`
- 写入 SQLite

### `GET /api/profile/:id` — 查询档案（预留）

### `POST /api/upload` — 处理头像上传
- 接收 `multipart/form-data`
- 保存到 `uploads/` 目录
- 返回 `{ url: string }`

## 5. 数据库（`better-sqlite3`）

```sql
CREATE TABLE profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tags TEXT NOT NULL,
  avatar_url TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## 6. 核心依赖

```json
{
  "next": "^14",
  "react": "^18",
  "better-sqlite3": "^11",
  "wordcloud": "^1.2",
  "tailwindcss": "^3",
  "sonner": "^1"
}
```

## 7. 关键设计决策

- **无登录认证**：原型演示，不需要用户系统
- **Tailwind CSS**：替代 Less，开发更快
- **App Router**：`app/` 目录文件路由
- **Server Components 优先**：仅在需要交互处使用 Client Components（词云 canvas、标签选择、文件上传）
- **标签数据集中管理**：`lib/tagData.ts`

## 8. 实施顺序

1. `npx create-next-app` 初始化 + 安装依赖
2. 定义类型 + 标签数据
3. 导航栏组件
4. 首页 → 标签页 → 词云页 → 头像页 → 完成页（按原流程顺序）
5. SQLite 数据库 + API 路由
6. 前端对接 API
7. 文件上传处理
8. 词云 canvas 集成
9. 收尾：响应式、错误处理、加载状态
