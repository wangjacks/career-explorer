---
kind: configuration_system
name: Next.js 应用配置体系：环境变量 + 运行时 JSON 配置文件
category: configuration_system
scope:
    - '**'
source_files:
    - next.config.ts
    - src/lib/db-config.ts
    - src/middleware.ts
    - src/lib/db.ts
    - src/app/api/admin/auth/route.ts
---

本仓库采用“环境变量 + 运行时 JSON 文件”的双层配置模型，由 Next.js 构建期与运行期共同消费。

## 1. 配置来源与分层

- **构建/运行期环境变量**（`process.env.*`）
  - `ALLOWED_ORIGINS`：在 `next.config.ts` 中解析为逗号分隔的字符串数组，用于开发跨域白名单。
  - `JWT_SECRET`、`ADMIN_PASSWORD_HASH`：分别在中件间和登录路由中读取，作为认证凭据；若未设置则回退到硬编码默认值。
- **运行时持久化配置**（`db-config.json`）
  - 位于项目根目录，通过 `src/lib/db-config.ts` 以同步 `fs` 读写，提供 `getConfig()` / `setConfig()` / `isInstalled()` 三个 API。
  - 包含 MySQL 连接参数与 `installed` 安装标记，首次不存在时合并 `DEFAULT_CONFIG` 默认值。

## 2. 核心文件与职责

- `next.config.ts`：Next.js 构建配置入口，仅声明 serverExternalPackages、allowedDevOrigins 及根路径 Cache-Control 响应头。
- `src/lib/db-config.ts`：定义 `DbConfig` 类型、默认值、以及基于 `db-config.json` 的 CRUD 接口。
- `src/middleware.ts`：全局中间件，从环境变量加载 JWT 密钥并保护 `/admin/*` 与 `/api/admin/*`。
- `src/lib/db.ts`：数据库适配器工厂，调用 `getConfig()` 获取当前 DB 配置，按配置指纹缓存单例连接。
- `src/app/api/admin/auth/route.ts`：管理端登录 API，从环境变量读取密码哈希进行校验。

## 3. 架构约定与设计决策

- **无 `.env*` 文件**：所有敏感信息均通过部署环境注入，代码中以 `|| "默认值"` 形式提供本地开发兜底。
- **配置即数据**：MySQL 连接信息以普通 JSON 文件落地，便于通过 Setup 页面或 API 动态写入，无需重启服务。
- **配置变更热重载**：`db.ts` 对 `currentType = JSON.stringify(config.mysql)` 做快照比对，配置变化后自动关闭旧连接并重建。
- **最小化构建期配置**：除 Next.js 基础选项外，未引入外部配置库（如 dotenv、configstore），保持依赖精简。

## 4. 开发者应遵循的规则

1. 新增环境变量一律通过 `process.env.XXX || fallback` 读取，禁止直接写死在生产路径。
2. 需要持久化的运行时配置统一走 `src/lib/db-config.ts` 暴露的接口，不要自行读写 `db-config.json`。
3. 敏感字段（JWT_SECRET、ADMIN_PASSWORD_HASH）不得提交至版本库，应在部署平台注入。
4. 修改 `DbConfig` 结构时需同步更新 `DEFAULT_CONFIG`，确保向后兼容。
5. 如需新增构建期开关，优先在 `next.config.ts` 中集中处理，避免散落在业务模块。