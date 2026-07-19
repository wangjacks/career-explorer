---
kind: dependency_management
name: npm 依赖管理与自动更新机制
category: dependency_management
scope:
    - '**'
source_files:
    - package.json
    - package-lock.json
    - .github/dependabot.yml
---

本仓库采用 npm 作为包管理器，通过 `package.json` 声明运行时与开发时依赖，配合 `package-lock.json`（lockfileVersion 3）锁定精确版本，确保构建可重复。关键要点如下：

1. **依赖声明与版本策略**
   - 运行时代码集中在 `dependencies`，包括 Next.js 16、React 19、mysql2、bcrypt、jose、sharp、exceljs、jszip、sonner 等。
   - 开发工具集中在 `devDependencies`，包含 TypeScript、eslint、husky、lint-staged、tailwindcss v4 及对应类型定义。
   - 大部分依赖使用 `^` 前缀的语义化版本范围，允许小版本/补丁升级；Next.js 与 react/react-dom 使用固定版本号以保证框架一致性。

2. **锁文件与安装源**
   - 根目录存在 `package-lock.json`，记录完整依赖树与每个包的 `resolved` URL 和 `integrity` 校验值，所有解析地址指向 `https://registry.npmmirror.com`，说明团队已配置国内镜像源。
   - 未使用 vendoring（无 `node_modules` 提交），依赖通过 npm 在 CI/本地安装。

3. **自动化更新**
   - `.github/dependabot.yml` 启用 Dependabot，针对 npm 生态每周扫描一次，目标分支为 `dev`，自动生成 PR 提示升级。

4. **脚本与钩子集成**
   - `scripts.prepare = "husky"` 在安装后自动初始化 husky，结合 `.husky/pre-commit` 与 `lint-staged` 对 `*.ts, *.tsx` 执行 `eslint --fix`，将代码质量检查嵌入依赖安装流程。

开发者应遵循的规则：
- 新增依赖统一写入 `package.json` 对应字段，避免手动编辑 `package-lock.json`。
- 优先使用 `^` 语义化版本，仅对框架核心包（如 next、react）使用固定版本。
- 升级依赖后提交变更后的 `package-lock.json`，由 Dependabot 或人工触发更新。
- 如需私有源或代理，应在项目级 `.npmrc` 中配置，而非全局环境变量。