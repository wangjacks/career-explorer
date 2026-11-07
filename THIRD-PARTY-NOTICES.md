# Third-Party Notices

本项目包含第三方软件、数据与服务。以下说明不改变各第三方组件的版权与许可证；本项目的 `LICENSE` 仅适用于原创代码、文档与设计。

## 测评数据与题库

- **O\*NET Career Exploration Tools / O\*NET Database 30.2**
  - 霍兰德兴趣题目改编自 O\*NET Career Exploration Tools，依据 O\*NET Tools Developer License 使用。
  - 职业信息参照 O\*NET Database 30.2，按 Creative Commons Attribution 4.0 International（CC BY 4.0）使用。
  - O\*NET® 是 U.S. Department of Labor, Employment and Training Administration 的商标。
  - https://www.onetcenter.org/license_tools.html
  - https://www.onetcenter.org/database.html
- **IPIP（International Personality Item Pool）**
  - 大五人格题目取自 IPIP；IPIP 条目属于公有领域。
  - https://ipip.ori.org/

## 第三方服务

- **GeeTest 极验**
  - 登录与激活的人机验证为可选集成；启用时受 GeeTest 服务条款约束。

## 运行时依赖

| 包 | 许可证 | 用途 |
|---|---|---|
| `next` | MIT | Web 框架 |
| `react` / `react-dom` | MIT | UI 运行时 |
| `better-sqlite3` | MIT | SQLite 适配器 |
| `mysql2` | MIT | MySQL 适配器 |
| `bcrypt` | MIT | 密码哈希 |
| `jose` | MIT | JWT |
| `exceljs` | MIT | Excel 导出 |
| `jszip` | MIT OR GPL-3.0-or-later | ZIP 打包；本项目选择 MIT |
| `image-size` | MIT | 图片尺寸探测 |
| `qrcode` | MIT | 邀请二维码 |
| `recharts` | MIT | 数据图表 |
| `sonner` | MIT | Toast 通知 |
| `lucide-react` | ISC | 图标 |
| `@aws-sdk/client-s3` / `@aws-sdk/s3-request-presigner` | Apache-2.0 | S3 兼容对象存储 |
| `sharp` | Apache-2.0 | 服务端图片处理 |

## 特别说明

- **sharp / libvips**：`sharp` 本身以 Apache-2.0 发布；其预编译的 `@img/sharp-*` / libvips 组件按 **LGPL-3.0-or-later** 发布。若分发包含这些二进制的应用、容器或安装包，需保留相应许可证文本，并遵守 LGPL 关于库可替换/可重链接等要求。仅以源码方式分发时，依赖由使用方通过 npm 安装。
- **caniuse-lite**：作为 Next.js 的传递依赖使用，数据按 **CC BY 4.0** 提供，需保留署名。
- 其余传递依赖保留各自许可证；完整许可证文本随对应 npm 包分发（`node_modules/<package>/LICENSE*`）。

## 分发提示

分发本项目的二进制、容器或安装包时，请同时附带本文件及各第三方依赖的许可证文本。仅提交源码时，请保留 `package-lock.json`，以便使用方安装相同依赖。
