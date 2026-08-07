# Career Explorer — 架构说明

## 认证体系

| 面板 | 路由 | 认证方式 | 密码来源 |
|---|---|---|---|
| 教师 | `/admin` | 密码 | `ADMIN_PASSWORD`（环境变量） |
| 开发者 | `/dev` 🔜 | 密码 + WebAuthn | `DEV_PASSWORD`（环境变量） |

密码验证通过环境变量比较，不依赖数据库。

## 页面路由

| 路由 | 类型 | 说明 |
|---|---|---|
| `/` | 静态 | 首页 |
| `/student` | 静态 | 学号验证 |
| `/tags` | 静态 | 标签选择 |
| `/wordcloud` | 静态 | 词云展示 |
| `/evaluation` | 静态 | 评价词云上传 |
| `/avatar` | 静态 | 头像上传 |
| `/complete` | 静态 | 提交完成 |
| `/admin` | 静态 | 教师管理面板 |
| `/setup` | 静态 | 安装引导页面 |
| `/dev` 🔜 | 静态 | 开发者维护面板 |

## API 路由

| 路由 | 方法 | 认证 | 说明 |
|---|---|---|---|
| `/api/profile` | POST | 无 | 保存学生档案 |
| `/api/upload` | POST | 无 | 文件上传 |
| `/api/validate-student` | POST | 无 | 学号验证 |
| `/api/setup/status` | GET | 无 | 安装状态检查 |
| `/api/setup` | POST | 无 | 安装配置 |
| `/api/setup/test` | POST | 无 | 测试数据库连接 |
| `/api/health` 🔜 | GET | 无 | 健康检查 |
| `/api/admin/auth` | POST | 无 | 教师登录 |
| `/api/admin/*` | 多种 | Bearer | 教师 API |
| `/api/dev/auth` 🔜 | POST | 无 | 开发者登录 |
| `/api/dev/settings` 🔜 | GET/PUT/POST | Bearer | 数据库配置 |
| `/api/dev/webauthn/*` 🔜 | 多种 | 部分需认证 | WebAuthn 管理 |

> 🔜 标记的功能为后续开发阶段规划，当前版本未实现。

## 数据库

### 表结构

```sql
-- 学生表
CREATE TABLE students (
  student_id VARCHAR(12) PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 档案表
CREATE TABLE profiles (
  student_id VARCHAR(12) PRIMARY KEY,
  tags TEXT NOT NULL,
  avatar_url VARCHAR(500),
  evaluation_url VARCHAR(500),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 数据流

```
学生端：学号验证 → 标签选择 → 词云展示 → 评价词云 → 头像上传 → 提交完成
管理端：登录 → 数据概览 → 学生管理 → 数据导出
开发端：🔜 登录 → 数据库配置 → 健康检查 → 安全设置
```

## 守护进程

PM2 管理。重启命令：

```bash
PORT=3621 pm2 restart career-app
pm2 save
```

## 配置文件

- `db-config.json` — 数据库连接信息（本地文件，gitignored）
- `webauthn-credentials.json` 🔜 — WebAuthn 凭据（本地文件，gitignored）
- `.env.local` — 环境变量（gitignored）

## 健康检查系统 🔜

健康检查默认禁用。启用后系统定期检测数据库连接，连续失败达到阈值时，普通用户页面显示故障遮罩。

- `/api/health` 公开端点，执行 `SELECT 1`
- HealthCheckProvider 组件在 layout 最外层，DB 挂时显示遮罩
- `/admin`、`/setup`、`/dev` 绕过遮罩
- 管理员可配置启用/禁用、检测间隔、失败阈值
