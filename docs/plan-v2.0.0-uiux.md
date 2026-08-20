# 视觉升级：方向 B 全站品牌色（Issue #84 视觉升级阶段）

分支 `feat/v2-uiux`（继续累积）。字体 MiSans 锁定不变，个性通过色彩/版面/形状/动效表达。

**全站大胆统一，不为管理端保留克制**：一套「深翡翠绿 + 琥珀能量色」品牌色系统贯穿所有角色界面（学生/教师/管理员一致）。核心 aesthetic risk：**整站顶栏改品牌深绿**——管理端不再是白底 SaaS，而是品牌化深绿顶栏 + 琥珀指南针 logo。只守数据可用底线（表格/表单内容区保对比度与留白），其余全部大胆。

## 色彩 token v2（globals.css @theme）

| Token | 色值 | 用途 |
|---|---|---|
| `--color-brand` | `#065f46` emerald-800 | 品牌深绿：hero 底、导航强调、主标题 |
| `--color-primary` | `#059669` emerald-600 | 主按钮/激活态（保留现有） |
| `--color-primary-strong` | `#047857` emerald-700 | hover |
| `--color-accent` | `#f59e0b` amber-500 | 能量色：指南针、CTA、点缀 |
| `--color-surface` | `#fafaf9` stone-50 | 暖底替代 gray-50 |
| `--color-ink` | `#1c1917` stone-900 | 标题墨色 |

标签三色（三维度色彩编码，>3 类循环取色）：兴趣=`#059669` / 技能=`#0284c7` / 性格=`#f59e0b`

## 阶段一：品牌门面（已完成 ✅）

已交付：深绿顶栏（NavigationBar/UserMenu 深底适配）、首页大字报 hero、登录/注册深绿 hero、标签三色系统、暗色主题三态切换（useTheme + 防闪烁内联脚本）、SiteFooter 暗色适配、关于页品牌化、InstallGuard 移除、form 页 localStorage 挂载后读取。

### 1A. token 层 v2 + 暗色变量基础（globals.css）
- `@theme inline` 增加：`--color-brand #065f46`、`--color-primary-strong #047857`、`--color-accent #f59e0b`、`--color-surface #fafaf9`、`--color-ink #1c1917`；标签三色变量 `--tag-interest #059669 / --tag-skill #0284c7 / --tag-personality #f59e0b`
- 启用 class-based dark：`@custom-variant dark (&:where(.dark, .dark *));`
- `.dark` 下重写语义变量：`--background #0d1210`（深灰绿带品牌绿调）、`--foreground` 浅色、卡片/边框暗值；`--color-brand` 暗色提亮为 emerald-600 系、`--color-accent` 提亮为 amber-400
- docs/ui-conventions.md 同步 token 表 + 暗色说明

### 1B. NavigationBar 品牌深绿顶栏（src/components/NavigationBar.tsx）
- 顶栏 `bg-white/80 backdrop-blur-md border-b border-gray-100` → `bg-brand`（深绿，暗色下自动提亮），去掉白底毛玻璃
- 标题 `text-gray-800` → `text-white`
- 返回/主页图标按钮 `hover:bg-gray-100` → `hover:bg-white/15` + 图标色 `text-white`
- 层级 z-40 不变；右侧 w-24 占位保留（UserMenu 叠于其上）

### 1C. UserMenu 深底适配 + 主题切换（src/components/UserMenu.tsx）
- UserMenu 按钮（fixed z-[45]，叠于深绿顶栏右上）文字/hover 适配深底：`text-gray-700 hover:bg-gray-100` → `text-white hover:bg-white/15`
- 下拉面板保持白底（`bg-white`，暗色下暗底）；新增主题切换项（太阳/月亮/自动图标 + 文案），与「个人信息/退出登录」（或「登录」）同层，位于其上方
- 三态切换逻辑：读/写 localStorage（key `theme`，值 light/dark/system），默认 system；切换时更新 `document.documentElement` 的 `.dark` class

### 1D. 防闪烁（src/app/layout.tsx）
- `<head>` 加内联脚本：hydration 前读 localStorage `theme`，若为 dark 或（system 且 `prefers-color-scheme: dark`）则给 `<html>` 加 `.dark` class，避免暗色用户首屏白屏闪烁

### 1E. 首页重做（src/app/page.tsx，signature）
- 抛弃居中模板，改大字报深绿 hero：整块 `bg-brand`（暗色下提亮）+ 白字大标题（MiSans Heavy `font-extrabold`，text-4xl/5xl）+ 左对齐大字
- 琥珀指南针装饰（Compass 图标，`text-accent`，仅作装饰不作小字）
- 大号 CTA「开始探索」（白底绿字或琥珀强调，hover 微交互）；保留底部 SiteFooter

### 1F. 登录/注册深绿 hero（src/app/login/page.tsx、register/page.tsx）
- 页面背景改深绿 hero 区（`bg-brand`），输入卡白底浮于深绿之上（白卡 + shadow，暗色下暗卡）
- 输入框/按钮保持现有交互，仅换容器背景；呼应首页品牌氛围

### 1G. 标签三色系统（src/components/TagSelector.tsx）
- 按 `category.sortOrder` 映射三色（0 兴趣绿 / 1 技能蓝 / 2 性格琥珀，>3 循环取色）
- 选中标签按分类色填充（替换现有统一 `bg-green-500`）；已选 chips 同色；未选保持白底 + 分类色描边 hover
- 三色始终伴随文字标签，不依赖颜色单独传达（无障碍）

## 暗色主题（三态切换，随阶段一一次建好）

依赖 token 层 v2（同套语义变量换暗色值），与品牌色一次建好避免返工。具体见 1A（暗色变量）/1C（UserMenu 三态切换）/1D（防闪烁）。暗色配色：背景深灰绿带品牌绿调（不用纯黑）；深绿顶栏在暗色下提亮（用更亮的 emerald 系，避免糊成一片），琥珀用更亮的 amber-400。

## 阶段二 spec：内部页面（调查后精确版）

> 阶段二核心：把品牌色 + 暗色主题从「门面」铺到「内部页」。阶段一只改了公开页（首页/登录/注册/关于）与全局组件；**form 流程、学生面板、管理端内容区仍是 bg-gray-50/bg-white 硬编码，暗色主题下完全不生效**。本阶段补齐。

### 调查发现的现状问题

1. **form 流程**：6 页各自独立 NavigationBar，无步骤进度（学生不知身处第几步）；背景 `bg-gray-50`、卡片 `bg-white` 硬编码；complete 页 green-50 渐变 + green-500 圆，无品牌仪式感。
2. **学生面板**：白卡 + 单色绿标签（`bg-green-50`，与 TagSelector 三色不一致）；无品牌区；无 dark。
3. **管理端**：分组导航 `border-green-500` 激活、StatCard 白卡渐变顶条、页面 `bg-gray-50`；所有 Tab 组件白卡硬编码，无 dark。
4. **动效**：仅 StatCard hover 上浮、ConfirmDialog scale-in、setup spinner；无页面入场。

### 2A. 表单流程情绪化（/form/*）

- **步骤进度组件**（新增 `src/components/FormSteps.tsx`）：6 步（学号验证→选标签→词云→评价→形象→完成）横向进度条，当前步高亮 + 已完成步打勾；文字标签伴随（不依赖颜色单独传达）。挂到 student/tags/wordcloud/evaluation/avatar 五页顶部（complete 页本身就是终点）。
- **背景/卡片语义化**：各 form 页 `bg-gray-50`→`bg-background`，`bg-white` 卡→`bg-card`，文字/边框加 dark 变体。
- **complete 页仪式感**：改 `bg-brand` 深绿 hero + 白字大标题「提交成功」+ 琥珀 Compass 装饰 + 大号 CTA（呼应首页），替换 green-50 渐变。
- **标签选择微交互**：TagSelector 选中态加 `active:scale-95` 按压反馈 + transition（克制，尊重 reduced-motion）。

### 2B. 学生面板品牌强化（dashboard/student）

- **顶部深绿品牌区**：档案卡顶部 `bg-brand` 区，展示头像 + 姓名 + 学号（白字），替换纯白卡头。
- **标签三色统一**：面板内「我的标签」chips 从单色绿改为与 TagSelector 一致的三色系统（按所属分类取色）。
- **dark 适配**：白卡→`bg-card`，文字/边框/StatusBadge 加 dark 变体。

### 2C. 管理端品牌化（dashboard/admin + teacher + 全部 Tab 组件）

- **页面框架**：admin/teacher page `bg-gray-50`→`bg-background`；Tab 导航区 `bg-white`→`bg-card` + dark；分组/子 Tab 激活态 `border-green-500/text-green-600`→品牌色（`border-primary`/`text-primary-strong dark:text-green-400`）。
- **StatCard**：顶条渐变改品牌色系；卡片 `bg-white`→`bg-card` + dark；文字 dark 变体。
- **全部 Tab 组件 dark 适配**（最大工作量，逐文件）：OverviewTab、DashboardTab、SettingsTab、StudentsTab、ClassesTab、TeachersTab、ExportTab、TagsTab、ProfilesTab、TeacherHomeTab、AdminUI（Field/StatCard）、ConfirmDialog。白卡→`bg-card`、白底输入/表格→`bg-card`/暗底、文字/边框/下拉面板加 dark 变体。
- **可读性底线**：内容区表格/表单保持 `bg-card`（浅色态白底）确保数据可读；暗色下用暗卡片底 + 足够对比度。

### 2D. 动效编排（克制）

- **页面入场**：管理端/form 主内容区加 fade-in（复用 scale-in 思路新增 `fade-in` keyframes，0.2s ease-out）；尊重 prefers-reduced-motion（已就位）。
- **CTA/按钮 hover**：保留现有 hover，仅首页/complete 大 CTA 用 `hover:brightness` 微交互，不堆砌。

### 暗色适配范围清单（不遗漏）

| 模块 | 文件 |
|---|---|
| form 流程 | student/tags/wordcloud/evaluation/avatar/complete |
| 学生面板 | dashboard/student |
| 管理端框架 | dashboard/admin、dashboard/teacher |
| 管理 Tab 组件 | OverviewTab、DashboardTab、SettingsTab、StudentsTab、ClassesTab、TeachersTab、ExportTab、TagsTab、ProfilesTab、TeacherHomeTab、AdminUI、ConfirmDialog |
| 其他 | setup、ErrorBoundary |

### 无障碍（阶段二补充）

- 步骤进度：当前步除颜色外有字重/打勾变化；aria-current 标注当前步
- dark 对比度：暗卡片底配浅色文字重新过 AA；琥珀仍不作小字
- 动效：全部尊重 prefers-reduced-motion

### 阶段二提交拆分

- `feat: 表单流程情绪化——步骤进度 + dark 适配 + 提交成功深绿 hero`
- `feat: 学生面板品牌强化——深绿品牌区 + 三色标签 + dark 适配`
- `feat: 管理端品牌化——页面框架 + StatCard + 分组导航`
- `feat: 管理端 Tab 组件 dark 适配（批量）`
- `feat: 动效编排——入场动画 + 微交互`

每 commit 后 tsc/eslint；阶段二末 build 全绿 + 用户视觉确认（重点：暗色下三端面板 + form 流程窄屏走查）。

### 阶段二验收要点

- 暗色主题下：form 流程、学生面板、管理端三端均无白底残留、文字可读
- 明亮主题下：品牌色一致，无视觉回归
- 步骤进度清晰，标签三色全链路一致
- prefers-reduced-motion 下无入场动画

## 无障碍视觉评估（质量底线，贯穿两阶段）

目标 WCAG 2.1 AA。基于对比度实测（已计算）：

| 配色 | 对比度 | 等级 | 约束 |
|---|---|---|---|
| 白字 / 深绿底 #065f46 | 7.68:1 | AAA | 深绿顶栏白字安全 |
| 墨色 / 暖底 | 16.74:1 | AAA | 标题安全 |
| gray-500 / 白底 | 4.83:1 | AA | 正文/次要文字安全 |
| 琥珀 / 深绿底 | 3.58:1 | AA-large | 琥珀仅可用于大字/装饰，不作小字 |
| 琥珀 / 白底 | 2.15:1 | FAIL | **琥珀严禁在白底上单独承载文字**，仅作装饰/强调 |
| gray-400 / 白底 | 2.54:1 | FAIL | 存量占位/辅助文字对比不足，随升级一并收敛 |

**评估清单（每阶段末执行）**：
1. **对比度**：新增深绿/琥珀/暖底配色全部过 AA；存量 gray-400 占位/辅助文字对比不足项随升级收敛至 gray-500+（仅纯装饰除外）；**暗色下重算**——深灰绿底配浅色文字、琥珀在暗底的对比度重新过 AA
2. **色彩不作为唯一信息载体**：标签三色（绿/蓝/琥珀）始终伴随文字标签；激活/选中态除颜色外有形状/字重变化
3. **焦点可见**：深绿顶栏上 UserMenu/导航图标用浅色 focus 环；白底区保持 focus-visible 绿环；所有交互可键盘触达
4. **动效**：prefers-reduced-motion 已就位，入场/微交互均尊重
5. **图标可及**：仅图标按钮保留 aria-label（NavigationBar/UserMenu 已补）
6. **触控目标**：移动端可点区域 ≥ 44×44px

## 提交拆分

- 阶段一：`feat: 品牌色 token v2 + 暗色变量基础`、`feat: NavigationBar 品牌深绿顶栏 + UserMenu 适配`、`feat: 首页重做——大字报深绿 hero`、`feat: 登录注册深绿 hero + 标签三色系统`、`feat: 暗色主题三态切换（UserMenu 入口 + 防闪烁）`
- 阶段二：另行拆分（表单/学生面板/管理端/动效）

每 commit 后 tsc/eslint；每阶段末 build 全绿 + 用户视觉确认后再推进下一阶段。

## 假设与边界

- **全站大胆统一**：学生/教师/管理员界面一致使用品牌色，不为管理端保留克制；仅守数据可用底线（表格/表单内容区保白底对比度与留白）；暗色下同理（暗色内容区保足够对比度）
- 深绿顶栏是核心 aesthetic risk：UserMenu/UserMenu 下拉、NavigationBar 返回/主页图标需适配深底（白字/浅色 hover）
- 标签三色按 category 顺序循环映射（动态分类 >3 时循环取色）
- MiSans Heavy 800 已加载，大字 hero 无字体障碍
- 分阶段验证：阶段一完成后停下等用户视觉确认，再进阶段二
