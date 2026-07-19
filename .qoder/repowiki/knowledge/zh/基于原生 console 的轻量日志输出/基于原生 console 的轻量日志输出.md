---
kind: logging_system
name: 基于原生 console 的轻量日志输出
category: logging_system
scope:
    - '**'
source_files:
    - src/app/api/admin/auth/route.ts
    - src/app/api/admin/export/route.ts
    - src/app/api/admin/profiles/route.ts
    - src/app/api/admin/settings/route.ts
    - src/app/api/admin/stats/route.ts
    - src/app/api/admin/students/route.ts
    - src/app/api/admin/test-db/route.ts
    - src/app/api/profile/route.ts
    - src/app/api/setup/route.ts
    - src/app/api/upload/route.ts
    - src/app/api/validate-student/route.ts
    - src/components/ErrorBoundary.tsx
    - src/hooks/useAdminAuth.ts
---

本仓库未引入任何专用日志框架（如 pino、winston、morgan、log4js 等），也未在 `src/lib` 或全局位置定义统一的 logger 模块。项目中的日志输出完全依赖 Node/浏览器原生的 `console.error` / `console.warn`，属于最轻量的调试式记录方式。

主要使用位置与模式：
- API Route 错误捕获：在各 `src/app/api/**/route.ts` 中，try/catch 块内统一以 `console.error("<操作名> error:", err)` 形式打印异常堆栈，便于 Next.js 开发服务器控制台直接查看。
- 可恢复警告：如 Excel 图片嵌入失败、Zip 打包图片拉取失败等场景使用 `console.warn` 记录非致命问题。
- 前端错误边界：`src/components/ErrorBoundary.tsx` 通过 `console.error` 输出 React 组件栈信息。
- 客户端 Hook：`src/hooks/useAdminAuth.ts` 在登出失败、数据加载失败等分支使用 `console.error` 提示。

约定与约束：
- 无结构化字段、无日志级别配置、无文件/远程 sink，所有输出仅进入运行时标准输出。
- 未区分环境（dev/prod）做不同处理，生产环境同样会输出到 stdout。
- 未对敏感信息做脱敏，错误对象整体透传。

由于缺乏集中化的日志基础设施，当前方案适合小型单仓应用快速定位问题，但不具备跨进程聚合、分级过滤、持久化归档等企业级能力。后续如需增强，可在 `src/lib/logger.ts` 引入 pino/winston 并封装统一入口，同时配合环境变量控制 level 与输出目标。