/**
 * 学生面板标签目录的加载状态（#261）：空数组是合法业务态，不能用 length 判「加载中」。
 * 已 ready 后的后台刷新失败保持 ready，避免网络抖动撤掉学生正在使用的 TagSelector。
 */
export type TagCategoriesState = "loading" | "ready" | "failed";
export type TagCategoriesEvent = "start" | "success" | "failure";

export function nextTagCategoriesState(
  current: TagCategoriesState,
  event: TagCategoriesEvent
): TagCategoriesState {
  if (event === "success") return "ready";
  if (event === "failure") return current === "ready" ? "ready" : "failed";
  return current === "ready" ? "ready" : "loading";
}
