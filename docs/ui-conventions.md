# UI 组件规范

> 本规范是 UI/UX 一致性收敛的依据。存量代码逐步对齐，增量代码必须遵守。
> 设计基调：收敛优先于创造——绿色品牌色 + MiSans 字体已定调，不引入新视觉方向。

## 色彩语义

| 语义 | Token | 色阶 | 用途 |
|---|---|---|---|
| 品牌/主操作 | `--color-primary` | green-600 | 主按钮、激活态、链接强调 |
| 主操作悬停 | `--color-primary-strong` | green-700 | hover 加深 |
| 品牌浅底 | `--color-primary-soft` | green-50 | 选中底色、标签浅底 |
| 焦点环 | `--color-focus-ring` | green-300 | `focus:ring-2 focus:ring-green-300` |
| 信息/批量 | `--color-info` | blue-500 | 批量操作按钮、信息提示（快速提交横幅） |
| 警告/凭据 | `--color-warning` | amber-500 | 警告提示、凭据展示、重置密码 |
| 危险/删除 | `--color-danger` | red-500 | 删除、错误态 |

灰阶层级：`gray-900` 标题 / `gray-800` 卡片标题 / `gray-600` 正文 / `gray-500` 次要 / `gray-400` 辅助与占位。

存量代码中的 `green-*` 硬编码（240+ 处）不强制迁移；新代码优先使用语义 token。

## 字体

- 全站 MiSans 自托管（Regular 400 / Medium 500 / Semibold 600 / Bold 700 / Heavy 800）
- 等宽场景（学号、密码、邀请码）走系统等宽栈 `font-mono`
- 字号阶梯：页面大标题 `text-2xl font-bold`、区块标题 `text-lg font-semibold`、卡片标题 `text-sm font-semibold`、正文 `text-sm`、辅助 `text-xs`

## 卡片

| 类型 | 规格 |
|---|---|
| 内容卡片 | `bg-white rounded-xl border border-gray-100 shadow-sm` |
| 统计卡 | 内容卡规格 + 顶部 `h-1` 渐变色条 + hover 上浮 |
| 弹窗/模态 | `rounded-2xl shadow-xl`（全屏遮罩 `bg-black/40`） |

- 卡片内边距统一 `p-5`/`p-6`；区块间距 `space-y-6`/`space-y-8`
- 含弹层（下拉/tooltip）的卡片容器禁止 `overflow-hidden`，圆角由子区块 `rounded-t-lg`/`rounded-b-lg` 各自承担

## 按钮

| 变体 | 样式 |
|---|---|
| 主操作 | `bg-green-500 hover:bg-green-600 text-white` |
| 次操作 | `bg-gray-100 hover:bg-gray-200 text-gray-700` |
| 危险 | `bg-red-500 hover:bg-red-600 text-white` |
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

- **加载态**：区块居中「加载中...」`text-gray-400`；按钮异步态显示动作文案（如「验证中...」）
- **空态**：居中 lucide 图标 + 说明 + 行动引导（空屏幕是行动的邀请，不写「暂无数据」孤句）
- **错误态**：说明发生了什么 + 重试按钮；toast 用 `toast.error` 陈述事实，不道歉
- **表单反馈**：成功 `toast.success(「已XX」)`，动作与结果用同一词汇

## 层级（z-index）

```
内容 < 下拉 z-30 < 全局导航（UserMenu）z-40 < 弹窗 z-50 < 沉浸式灯箱 z-[100]
```

- 弹窗必须高于全局导航，遮罩区域点击不被拦截
- 粘性元素：NavigationBar `sticky z-50`、表头 `sticky z-10`（卡片内局部）
