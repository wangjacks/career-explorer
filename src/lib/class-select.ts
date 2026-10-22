/**
 * 受控选择控件的键盘导航数学与班级判据（#192 / #194）
 *
 * 为何抽成纯函数：本仓 vitest 为 `environment: "node"` 且无 `@testing-library`，
 * 组件内键盘事件无法单测；把「活动项如何移动」和「班级判据」拿出来即可覆盖。
 * 注意：本模块必须保持客户端安全（不得引入 db 等仅服务端依赖）。
 */

export interface SelectableOption {
  id: number;
  name: string;
  disabled?: boolean;
}

/** 下一活动项：跳过 disabled、到两端循环；空列表或全部 disabled 返回 -1 */
export function nextEnabledIndex(
  options: SelectableOption[],
  current: number,
  direction: "ArrowDown" | "ArrowUp"
): number {
  const total = options.length;
  if (total === 0) return -1;
  const step = direction === "ArrowDown" ? 1 : -1;
  let index = current;
  for (let i = 0; i < total; i += 1) {
    index = (index + step + total) % total;
    if (!options[index].disabled) return index;
  }
  return -1;
}

/** 首个可用项下标；无可用项返回 -1 */
export function firstEnabledIndex(options: SelectableOption[]): number {
  return options.findIndex((option) => !option.disabled);
}

/** 末个可用项下标；无可用项返回 -1 */
export function lastEnabledIndex(options: SelectableOption[]): number {
  for (let i = options.length - 1; i >= 0; i -= 1) {
    if (!options[i].disabled) return i;
  }
  return -1;
}

/**
 * 已选项下标：
 * - `null` → 匹配空值哨兵项（未分班 / 不设置）
 * - `undefined` → 尚未选择（批量设班等场景），返回 -1，由控件显示占位文案
 */
export function selectedIndexFor(
  options: SelectableOption[],
  value: number | null | undefined,
  emptyId: number
): number {
  if (value === undefined) return -1;
  if (value === null) return options.findIndex((option) => option.id === emptyId);
  return options.findIndex((option) => option.id === value);
}

/**
 * 班级列表是否不可用（加载失败且无缓存）—— 面板内所有班级控件共用同一判据（#192）。
 * 加载失败时不清空已有列表，因此只有「失败 + 空」才算不可用。
 */
export function isClassListUnavailable(classes: unknown[], loadFailed: boolean): boolean {
  return loadFailed && classes.length === 0;
}

/**
 * 班级名是否「确认不存在」—— 单一判据（#192），供批量导入预览等按名称进线处使用。
 * 列表不可用时不作判断，避免把正确班级名误报为不存在（#182 修过的误报）。
 */
export function isClassNameMissing(
  name: string,
  classes: { name: string }[],
  listUnavailable: boolean
): boolean {
  const typed = name.trim();
  if (!typed || listUnavailable) return false;
  return !classes.some((c) => c.name === typed);
}
