import { PANEL_ICONS } from "./panel-icons";
import type { PanelSidebarGroup, PanelSidebarItem } from "./PanelSidebar";
import type { PanelNavItemDef } from "@/lib/panel-nav";

/**
 * 把纯导航配置（`src/lib/panel-nav.ts`）渲染成侧边栏分组。
 * `badges` 由 layout 传入（如管理/教师面板的「N 名」学生数），`hiddenKeys` 用于
 * demo-admin 隐藏无权 Tab；过滤后为空的分组不渲染。
 */
export function buildPanelGroups(
  items: readonly PanelNavItemDef[],
  options: { badges?: Record<string, string | undefined>; hiddenKeys?: ReadonlySet<string> } = {}
): PanelSidebarGroup[] {
  const { badges = {}, hiddenKeys } = options;
  const grouped = new Map<string | undefined, PanelSidebarItem[]>();

  for (const item of items) {
    if (hiddenKeys?.has(item.key)) continue;
    const group = grouped.get(item.group) ?? [];
    group.push({
      key: item.key,
      label: item.label,
      icon: PANEL_ICONS[item.key],
      badge: badges[item.key],
      // 教师主页快捷入口依赖 description；这里丢掉会让卡片的一句话说明消失
      description: item.description,
    });
    grouped.set(item.group, group);
  }

  return [...grouped.entries()].map(([label, groupItems]) =>
    label ? { label, items: groupItems } : { items: groupItems }
  );
}
