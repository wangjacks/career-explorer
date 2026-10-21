# UI 组件规范

> 本规范是 UI/UX 一致性收敛的依据。存量代码逐步对齐，增量代码必须遵守。
> 设计基调：深翡翠绿 + 琥珀能量色品牌色系统 + Noto Sans SC 字体；全站大胆统一，只守数据可用底线。详见 docs/plan-v2.0.0-uiux.md。

## 色彩语义

### 品牌色 token v2

| 语义 | Token | 色值（浅/暗） | 用途 |
|---|---|---|---|
| 品牌深绿 | `--color-brand` | `#065f46` / 暗色提亮 `#059669` | 顶栏、侧边栏角色区、主标题 |
| 品牌深绿（hero 专用） | `--color-brand-deep` | `#065f46` / `#047857` | 承载白字小字的品牌色大底（hero）；暗色下 14px 白字实测 5.48:1 |
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
| 警告/凭据 | `--color-warning` / `--color-warning-strong` | amber-500 / amber-600 | 警告提示、凭据展示、重置密码（hover 用 strong） |
| 危险/删除 | `--color-danger` | red-500 | 删除、错误态 |
| 危险浅底 | `--color-danger-soft` | red-50 / 暗色 `red-900/30` | 危险语义的浅底胶囊、错误提示底色 |
| 危险强对比 | `--color-danger-strong` | red-700 / 暗色 `red-400` | 浅底上的危险小字（`--color-danger` 为 red-500，浅底仅 3.1:1、不达 AA；实测 red-700 浅底 5.9:1、暗色 6.1:1） |

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
| 品牌 hero | `bg-brand rounded-2xl p-5 sm:p-6 shadow-sm` + 白色文字（问候 / 日期 / 引导语） |
| 快捷入口卡 | `bg-card rounded-xl border border-border-soft p-4` + hover 上浮与阴影 + 顶部 `bg-accent` 悬停条（琥珀不承载小字） |
| 结果徽章 | `bg-brand rounded-xl` + 白色大字母（如三字码）+ `text-white/70` 小字标签，与品牌 hero 同族 |
| 弹窗/模态 | `rounded-2xl shadow-xl`（全屏遮罩 `bg-black/40`） |

## 图表（recharts）

| 场景 | 口径 |
|---|---|
| 线 / 面积 / 柱 / 饼 | 数据色用 `DATA_GREEN`（`#059669`）等固定色板；网格与轴用 `currentColor` + `strokeOpacity`，随深浅色自动适配 |
| 雷达图 | `PolarGrid` / `PolarAngleAxis` 用 `currentColor`；量程固定 0–100 且**不画半径刻度**（看的是形状，精确值交给并列的条状排名）；填充用主色 25% 透明度 |
| 进度条 / 排名条 | `bg-primary` 填充 + `bg-gray-100 dark:bg-gray-800` 轨道，高度 `h-2`（密集处 `h-1.5`） |
| 按钮 | 主操作 `bg-primary` 等语义 token；**数据分类色**（如 RIASEC 六型）属于数据而不是品牌语义，按数据给色并在组件旁注明来源，不混进语义 token（#232 的做法：六型配色表 + 单测校验对比度） |
| 读数 | Tooltip/读数用 `font-mono tabular-nums`；图与读数并列时图在左、读数在右（窄屏上下堆叠） |

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

## 表单控件

- **班级选择一律使用共享控件** `src/components/admin/ClassSelect.tsx`（受控单选，`combobox` + `listbox` 语义）：
  - 控件按 `class_id` 选择，提交时由调用方回填班级名，服务端名称解析口径不变；
  - 面板内**不得出现可自由输入班级名的入口**（`datalist` 自由文本已下线，#192）；
  - 键盘行为由控件统一实现（↓ / ↑ / Home / End / Enter / Space / Escape；选项不是独立 tab stop），
    新增入口直接复用即可，不要各写一套 keydown（#194）；
  - 班级列表加载失败且无缓存时，控件内展示失败态与「重试」，不得把正确班级名误报为不存在。
- 警告类提示统一用 `--color-warning` 作底（如 `bg-warning/10`），正文用**随主题重定义**的 `--color-warning-text`（浅色 amber-900 实测 8.36:1、暗色 amber-300 9.44:1，均达 WCAG AA）；`--color-warning-strong` 是静态 amber-600，浅底仅 2.83:1，**不得用于正文**。不得硬编码 `bg-amber-50` 一类色值。

## 筛选与弹层

同一类数据的筛选条件变多时（如数据列表的「兴趣/人格」两组测评条件），**收进一个入口**，不要把选项全部平铺在工具条上：

- **单按钮 + 弹层**：按钮文案是筛选类别名（如「测评筛选」），有值时带**计数徽章**；已应用条件在工具条上以 **chip** 展示（读得懂的自然语言，如「兴趣：S·A·I（同时包含）」「人格：尽责性偏高」），chip 自带 `×` 一键清除
- **互斥分组**：弹层内用 tab 分组（`role="tablist"` / `role="tab"` / `aria-selected`）；**一次只应用一组条件**，切换并应用另一组时由调用方整体替换状态（类型上用联合类型表达，见 `profile-assessment.ts` 的 `AssessmentFilter`）；弹层底部常驻一句互斥说明
- **短句提示**：弹层内只放一句话提示（如「多选 = 三字码同时包含所选字母，最多 3 个」「偏高 = 标准分 ≥ 50」），不在弹层里写长段落
- **关闭与焦点**：Escape 关闭、点击外部关闭；`aria-expanded` / `aria-haspopup` 标注在触发按钮上；筛选项是 `aria-pressed` 的胶囊按钮
- **默认态等价**：没有任何筛选时，按钮与列表行为必须与改造前完全一致；列表标题在有筛选时带「已筛选」；空结果要区分「暂无数据」与「没有匹配（筛选已生效）」

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

## 学生档案：结论卡 / 折叠卡 / 移动端操作条

「我的档案」的结构是**结论先行 + 详情折叠 + 合规一次**（#322 / #323 / #324）；新增区块按这套规范落位，不要再造第二套折叠卡或第二份合规文案：

- **速览卡**：桌面 2×2、`<sm` 单列（`grid-cols-1 sm:grid-cols-2`）；每卡 = 图标 + 标题 + 右上「查看详情」（**真 `<button>`**，不是 div）+ 结论主体（最多 2 行 / 3 个数字）；单卡三态（ready / empty / degraded）互不影响，**失败不能说成没测过**
- **折叠卡**：`section[aria-labelledby]` → `h2 > button[aria-expanded][aria-controls]` → 展开面板 `role="region"` 同一标题；键盘 Enter / Space 可开合、`focus-visible` 焦点环；**收起时不挂载面板**（图表 / 大段内容等展开再渲染）；标题与口径行允许换行（`break-words`），长姓名 / 长班级名截断，不撑破卡片
- **图表**：雷达图 `role="img"` + `aria-label` 必须含每一维数值（`chartAriaLabel`）；recharts 组件一律 `next/dynamic({ ssr:false })` 懒加载 + 固定高度占位（`ChartLoadingPlaceholder`），避免首屏为不可见图表付体积；主色用语义 token（`currentColor` + `text-primary`），不硬编码色值
- **移动端 sticky 操作条**：`<sm` 时底部「修改数据」`fixed inset-x-0 bottom-0 z-40`，`padding-bottom: calc(... + env(safe-area-inset-bottom))` 预留安全区；主滚动区同步留底部内边距（`calc(7rem + env(safe-area-inset-bottom))`）避免遮挡；只在「已归档 + 非编辑 + 我的档案视图 + 侧栏关闭」出现（历史提交 / 小组 / 编辑态都有自己的主操作，不叠两条；侧栏打开时让位给抽屉）；提交截止后**仍显示但置灰**并注明截止时间，入口不消失
- **空态 CTA**：每个空态给下一步动作（去测评 / 开始填写 / 补充评价 / 重试），不渲染空占位大卡；状态判定与文案拼接落纯函数（`profile-ui.ts` / `profile-summary.ts`）并单测

## 层级（z-index）

```
内容 < 表头 sticky z-10 < 下拉 z-30 < 导航栏 sticky z-40 < UserMenu z-[45] < 弹窗 z-50 < 沉浸式灯箱 z-[100]
```

- UserMenu 必须高于导航栏（同处顶栏位置），但低于弹窗（弹窗打开时遮罩覆盖 UserMenu）
- 弹窗必须高于全局导航，遮罩区域点击不被拦截
- 粘性元素：NavigationBar `sticky z-40`、表头 `sticky z-10`（卡片内局部）
- 演示横幅（#256）为**在流顶部条**，紧贴 NavigationBar 之下，**不新增 z-index 层级**、不改变既有 3rem 顶栏偏移；仅 demo 会话渲染，配色走 warning 语义 token（`bg-warning/10` / `text-warning-text` / `border-warning/30`，浅/深实测 8.36:1 / 9.44:1 达 AA）。
