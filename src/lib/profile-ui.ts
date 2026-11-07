/**
 * 「我的档案」期 3 收尾的纯函数（#324）：移动端 sticky 操作条状态、图表 aria 文案。
 *
 * 仓库没有 DOM 测试环境（见 AGENTS.md），交互判定先落纯函数再测：
 * - `profileStickyAction`：移动端底部「修改数据」在哪些视图/状态下出现、是否禁用、截止提示；
 * - `chartAriaLabel`：雷达图不能只靠颜色/形状传达信息，读屏要能读到每一维的数值。
 */

/** 学生移动端底部操作条状态 */
export interface ProfileStickyActionState {
  /** 是否显示在移动端底部（桌面端始终有 hero/资料卡内的修改入口） */
  visible: boolean;
  /** 提交截止后置灰（点击不触发编辑） */
  disabled: boolean;
  /** 截止提示（未截止为 null） */
  hint: string | null;
}

export interface ProfileStickyActionInput {
  /** 是否已提交过档案 */
  hasSubmitted: boolean;
  /** 是否处于编辑态（编辑态底部已有「取消 / 保存」操作条，不再叠一条） */
  editing: boolean;
  /** 当前面板视图（只有「我的档案」主视图才需要这条主操作） */
  activeView: string;
  /** 移动端侧边抽屉是否打开（打开时让位给导航，避免操作条压住抽屉/遮罩） */
  sidebarOpen: boolean;
  /** 服务端下发的提交截止状态（#96） */
  submissionClosed: boolean;
  /** 截止时间文案（Y-M-D H:M）；未知为 null */
  submissionDeadline: string | null;
}

/**
 * 移动端 sticky「修改数据」的状态。
 *
 * - 只在「已归档 + 非编辑 + 我的档案视图」出现：未提交时引导卡与 hero 已有「开始填写」；
 *   历史提交视图的操作是「恢复」，不该被「修改数据」挡住；
 * - 移动端侧栏打开时隐藏：操作条是 fixed z-40，与抽屉同层，显示会压住抽屉并保持可点；
 * - 截止后仍显示但置灰，并给出截止时间——入口消失会让教师/学生以为界面坏了。
 */
export function profileStickyAction(input: ProfileStickyActionInput): ProfileStickyActionState {
  const visible =
    input.hasSubmitted && !input.editing && input.activeView === "profile" && !input.sidebarOpen;
  const disabled = input.submissionClosed;
  const hint = input.submissionClosed
    ? input.submissionDeadline
      ? `档案提交已于 ${input.submissionDeadline} 截止`
      : "档案提交已截止"
    : null;
  return { visible, disabled, hint };
}

/**
 * 雷达图的 aria 文案：系列名 + 每一维的整数分。
 *
 * 读屏用户拿不到图形形状，也不能只靠颜色区分系列——把数值写进 label，
 * 与旁边的条状排名互为补充（精度仍以条形排名的 0.1 分为准）。
 */
export function chartAriaLabel(
  seriesName: string,
  points: readonly { label: string; standard: number }[]
): string {
  if (points.length === 0) return seriesName;
  const values = points.map((point) => `${point.label} ${Math.round(point.standard)} 分`).join("、");
  return `${seriesName}：${values}`;
}

/** hero 在移动端的完整度文案（右侧大环收纳成一行文字） */
export function heroCompletionText(done: number, total = 3): string {
  const safeDone = Math.max(0, Math.min(total, Math.round(done)));
  return `资料完整度 ${safeDone}/${total}`;
}
