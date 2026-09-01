# UI 组件规范

> 本规范是 UI/UX 一致性收敛的依据。存量代码逐步对齐，增量代码必须遵守。
> 设计基调：深翡翠绿 + 琥珀能量色品牌色系统 + Noto Sans SC 字体；全站大胆统一，只守数据可用底线。详见 docs/plan-v2.0.0-uiux.md。

## 色彩语义

### 品牌色 token v2

| 语义 | Token | 色值（浅/暗） | 用途 |
|---|---|---|---|
| 品牌深绿 | `--color-brand` | `#065f46` / 暗色提亮 `#059669` | hero 底、顶栏、主标题 |
| 能量琥珀 | `--color-accent` | `#f59e0b` / 暗色提亮 `#fbbf24` | 指南针、CTA、点缀（不作小字） |
| 背景 | `--color-background` | `#fafaf9` / `#0d1210` | 页面底 |
| 卡片底 | `--color-card` | `#ffffff` / `#16201c` | 内容卡片 |
| 软边框 | `--color-border-soft` | `#e7e5e4` / `#2a3833` | 卡片/分隔线 |
| 次要文本 | `--color-muted` | `#78716c` / `#a8a29e` | 辅助说明、占位、次要信息 |
| 墨色 | `--color-foreground` | `#1c1917` / `#e7e5e4` | 标题/正文 |

### 功能色 token

| 语义 | Token | 色阶 | 用途 |
|---|---|---|---|
| 主操作 | `--color-primary` | green-600 | 主按钮、激活态、链接强调 |
| 主操作悬停 | `--color-primary-strong` | green-700 | hover 加深 |
| 品牌浅底 | `--color-primary-soft` | green-50 | 选中底色、标签浅底 |
| 焦点环 | `--color-focus-ring` | green-300 | `focus:ring-2 focus:ring-focus-ring` |
| 信息/批量 | `--color-info` | blue-500 | 批量操作按钮、信息提示 |
| 警告/凭据 | `--color-warning` | amber-500 | 警告提示、凭据展示、重置密码 |
| 危险/删除 | `--color-danger` | red-500 | 删除、错误态 |

### 标签三色（三维度色彩编码，>3 类循环取色）

| 维度 | Token | 色值 |
|---|---|---|
| 兴趣 | `--tag-interest` | `#059669` |
| 技能 | `--tag-skill` | `#0284c7` |
| 性格 | `--tag-personality` | `#f59e0b` |

### 暗色主题

- class-based dark：`@custom-variant dark (&:where(.dark, .dark *))`，三态切换（浅色/深色/跟随系统）经 UserMenu + localStorage `theme`
- 品牌色在 `.dark` 下提亮（深绿顶栏用 emerald-600，琥珀用 amber-400），避免深底糊成一片
- 暗色对比度需重新过 WCAG AA

灰阶层级：`gray-900` 标题 / `gray-800` 卡片标题 / `gray-600` 正文 / `text-muted` 次要文本标准（浅色 stone-500 / 暗色 stone-400）/ `gray-400` 仅纯装饰（图标、占位弱化，对比不足慎用）。

存量代码中的 `green-*` 硬编码（240+ 处）不强制迁移；新代码优先使用语义 token。

## 字体

- 全站 Noto Sans SC（Google Fonts 加载，镜像前缀可配 FONT_CDN_PREFIX；字重 400 / 500 / 600 / 700 / 800）
- 等宽场景（学号、密码、邀请码）走系统等宽栈 `font-mono`
- 字号阶梯：页面大标题 `text-2xl font-bold`、区块标题 `text-lg font-semibold`、卡片标题 `text-sm font-semibold`、正文 `text-sm`、辅助 `text-xs`

## 卡片

| 类型 | 规格 |
|---|---|
| 内容卡片 | `bg-white rounded-xl border border-border-soft shadow-sm` |
| 统计卡 | 内容卡规格 + 顶部 `h-1` 渐变色条 + hover 上浮 |
| 弹窗/模态 | `rounded-2xl shadow-xl`（全屏遮罩 `bg-black/40`） |

- 卡片内边距统一 `p-5`/`p-6`；区块间距 `space-y-6`/`space-y-8`
- 含弹层（下拉/tooltip）的卡片容器禁止 `overflow-hidden`，圆角由子区块 `rounded-t-lg`/`rounded-b-lg` 各自承担

## 按钮

| 变体 | 样式 |
|---|---|
| 主操作 | `bg-primary hover:bg-primary-strong text-white` |
| 次操作 | `bg-gray-100 hover:bg-gray-200 text-gray-700` |
| 危险 | `bg-danger hover:bg-red-600 text-white` |
| 文字按钮 | `text-xs font-medium` + 语义色文字 |

- 面板内尺寸统一 `px-4 py-2 text-sm rounded-lg`；首页/落地页大号 CTA `py-3 rounded-xl` 为特例
- 禁用态统一 `disabled:opacity-40`（或 50），禁用时保持尺寸不跳动
- 键盘可达性：交互元素具备可见焦点环；仅图标按钮必须 `aria-label`

## 图标

- 统一使用 lucide-react，禁止手写内联 SVG
- 尺寸：行内小图标 `w-3.5 h-3.5`~`w-4 h-4`、卡片图标 `w-5 h-5`、页面级图标 `size={20~48}`
- 线宽：常规 `strokeWidth={2}`、统计卡 `1.5`、强调（提交成功）`3`
- 纯装饰图标保持 aria-hidden（lucide 默认）；`Image` 图标用 `ImageIcon` 别名导入（规避 a11y 规则误判）

## 状态

- **加载态**：区块居中「加载中...」`text-muted`；按钮异步态显示动作文案（如「验证中...」）
- **空态**：居中 lucide 图标 + 说明 + 行动引导（空屏幕是行动的邀请，不写「暂无数据」孤句）
- **错误态**：说明发生了什么 + 重试按钮；toast 用 `toast.error` 陈述事实，不道歉
- **表单反馈**：成功 `toast.success(「已XX」)`，动作与结果用同一词汇

## 层级（z-index）

```
内容 < 表头 sticky z-10 < 下拉 z-30 < 导航栏 sticky z-40 < UserMenu z-[45] < 弹窗 z-50 < 沉浸式灯箱 z-[100]
```

- UserMenu 必须高于导航栏（同处顶栏位置），但低于弹窗（弹窗打开时遮罩覆盖 UserMenu）
- 弹窗必须高于全局导航，遮罩区域点击不被拦截
- 粘性元素：NavigationBar `sticky z-40`、表头 `sticky z-10`（卡片内局部）
