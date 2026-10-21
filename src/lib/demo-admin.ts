/**
 * 演示环境管理 Tab 的纯视图模型（#258）。
 * 仓库无 DOM 测试环境，界面逻辑先落这里再写组件（同 demo-view / assessment-view 约定）。
 * 类型镜像 API 响应，不 import 服务端模块，避免把 bcrypt / db 带进客户端包。
 */
import { ROLE_LABELS } from "./demo-view";

export interface DemoAccountCodes {
  admin: string;
  teacher: string;
  student: string;
}

export interface DemoStatusCounts {
  classes: number;
  students: number;
  teachers: number;
  submittedProfiles: number;
  demoFiles: number;
  visitorAccounts: number;
}

export interface DemoStatus {
  enabled: boolean;
  dbPath: string;
  initialized: boolean;
  counts: DemoStatusCounts;
}

export interface DemoVisitorAccount {
  seq: number;
  name: string;
  disabled: boolean;
  codes: DemoAccountCodes;
  identities: { admin: boolean; teacher: boolean; student: boolean };
  classId: number | null;
  submittedAt: string | null;
}

export interface DemoResetReport {
  classId: number;
  students: number;
  submitted: number;
  assessed: number;
  drafts: number;
  groups: number;
  images: number;
}

export interface DemoStatusCard {
  key: keyof DemoStatusCounts;
  label: string;
  color: "emerald" | "blue" | "amber" | "purple";
}

/** 状态卡固定顺序：名册与访客分开计数（visitorAccounts 不计入 students） */
export const DEMO_STATUS_CARDS: readonly DemoStatusCard[] = [
  { key: "classes", label: "演示班级", color: "emerald" },
  { key: "students", label: "名册学生", color: "blue" },
  { key: "teachers", label: "演示教师", color: "purple" },
  { key: "submittedProfiles", label: "已提交档案", color: "amber" },
  { key: "demoFiles", label: "演示文件", color: "blue" },
  { key: "visitorAccounts", label: "访客账户", color: "emerald" },
];

/**
 * demo 会话完全无权的 Tab（对应 src/proxy.ts 的 DEMO_ALLOWED）：
 * demo / 数据源设置 / 教师管理 / 存储管理 / 媒体管理。只读可用的
 * students / classes / tags / profile-config 等不在此列。
 */
export const DEMO_HIDDEN_TAB_KEYS = ["demo", "settings", "teachers", "storage", "media"] as const;

const HIDDEN_TAB_SET: ReadonlySet<string> = new Set(DEMO_HIDDEN_TAB_KEYS);

export function isDemoHiddenTab(key: string): boolean {
  return HIDDEN_TAB_SET.has(key);
}

export type DemoPasswordBody =
  | { ok: true; body: { password?: string } }
  | { ok: false; error: string };

/**
 * 创建访客账户的请求体：留空表示由服务端生成，必须省略 password 键
 * （服务端把空串判为 <8 位而 400）；非空时与后端同口径只校验长度、不 trim。
 */
export function demoCreatePasswordBody(raw: string): DemoPasswordBody {
  if (raw === "") return { ok: true, body: {} };
  if (raw.length < 8) return { ok: false, error: "密码须至少 8 位" };
  return { ok: true, body: { password: raw } };
}

export interface DemoCredentialsInput {
  name?: string;
  codes: DemoAccountCodes;
  password: string;
}

export interface DemoCredentialRow {
  label: string;
  value: string;
}

/** 一次性凭据展示/复制用的行：姓名（可选）→ 三编号 → 密码 */
export function demoCredentialRows(input: DemoCredentialsInput): DemoCredentialRow[] {
  const rows: DemoCredentialRow[] = [];
  const name = input.name?.trim();
  if (name) rows.push({ label: "姓名", value: name });
  rows.push(
    { label: `${ROLE_LABELS.admin}编号`, value: input.codes.admin },
    { label: `${ROLE_LABELS.teacher}编号`, value: input.codes.teacher },
    { label: `${ROLE_LABELS.student}编号`, value: input.codes.student },
    { label: "密码", value: input.password }
  );
  return rows;
}

export function demoCredentialCopyText(input: DemoCredentialsInput): string {
  return demoCredentialRows(input)
    .map((row) => `${row.label}：${row.value}`)
    .join("\n");
}
