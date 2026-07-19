---
kind: error_handling
name: Next.js 应用中的错误处理模式
category: error_handling
scope:
    - '**'
source_files:
    - src/components/ErrorBoundary.tsx
    - src/middleware.ts
    - src/app/api/admin/auth/route.ts
    - src/lib/db.ts
---

该 Next.js 应用采用分层错误处理策略，涵盖前端组件、API 路由和中间件三个层面：

**1. 前端组件层 - ErrorBoundary 全局捕获**
- `src/components/ErrorBoundary.tsx` 实现了 React Class Component 形式的错误边界，通过 `getDerivedStateFromError` 和 `componentDidCatch` 捕获子树渲染错误
- 提供统一的错误 UI（红色警告图标 + 重试/返回首页按钮），防止页面白屏
- 支持自定义 fallback 组件注入

**2. API 路由层 - try/catch + NextResponse.json**
- 所有 API 路由统一使用 `try/catch` 包裹业务逻辑
- 成功响应：`NextResponse.json({ ok: true, ...data })`
- 客户端错误：返回 `{ error: '描述' }` + 400/401/404 状态码
- 服务器错误：返回 `{ ok: false, error: '服务器错误' }` + 500 状态码
- 未捕获异常通过 catch 块记录 `console.error` 后降级为 500 响应

**3. 中间件层 - JWT 验证错误处理**
- `src/middleware.ts` 对 `/admin/*` 和 `/api/admin/*` 路径进行认证拦截
- JWT 验证失败时删除过期 cookie 并重定向到登录页
- 允许 `/api/admin/auth` 端点免认证访问

**4. 数据库层 - Promise 错误传播**
- `src/lib/db.ts` 通过 `Promise.resolve()` 包装适配器调用，保持异步一致性
- 连接关闭时使用 `c.catch(() => {})` 忽略清理错误，避免影响主流程

**约定与约束：**
- API 响应体统一包含 `ok` 或 `error` 字段，便于前端判断
- 不定义自定义 Error 类，直接使用字符串消息描述错误
- 无全局错误日志上报机制，仅依赖 console.error
- 前端 hooks（如 `useAdminAuth.ts`）中 catch 块直接吞掉错误，由上层组件处理