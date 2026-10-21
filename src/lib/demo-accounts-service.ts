/**
 * 演示访客账户服务（#278）：一个访客账户 = 同名同密码的三个 user 行
 * （admin / teacher / student），由同一 seq 从专用号段派生编号（见 demo-accounts.ts）。
 *
 * 本模块**不自行进入演示作用域**——由路由在 admin 校验后 `runInDemoScope` 包裹（同 materializeDemoSeed）。
 * 所有操作仅作用于演示库；生产 admin 的审计由路由在生产作用域写入。
 */
import { isDemoScope } from "./demo-scope";
import {
  demoAccountCodes,
  assertVisitorSeq,
  visitorSeqOf,
  pickName,
  VISITOR_SEQ_START,
  VISITOR_SEQ_MAX,
  DEMO_CLASS_NAME,
  createDemoAccount,
} from "./demo-accounts";
import {
  getStudents,
  getUserByCode,
  updateUser,
  clearSubmissions,
  deleteStudents,
  deleteTeacher,
  deleteUserById,
  insertTeacherClass,
  getClassByName,
  getProfileSubmissions,
  type UserRow,
} from "./db";
import { getStorage } from "./storage";
import { hashPassword } from "./auth";
import { generatePassword } from "./password";
import { extractKey } from "./thumbnail-backfill";
import { getThumbnailKey } from "./thumbnail-utils";

export interface DemoAccountCodes {
  admin: string;
  teacher: string;
  student: string;
}

export interface VisitorAccountSummary {
  seq: number;
  name: string;
  /** 现有身份是否全部处于禁用态（password_hash 为 NULL） */
  disabled: boolean;
  codes: DemoAccountCodes;
  identities: { admin: boolean; teacher: boolean; student: boolean };
  classId: number | null;
  submittedAt: string | null;
}

export interface VisitorAccountCreated {
  seq: number;
  name: string;
  /** 明文仅此一次返回，库中只存 bcrypt hash */
  password: string;
  codes: DemoAccountCodes;
  classId: number;
}

export interface VisitorPasswordRotation {
  seq: number;
  password: string;
  codes: DemoAccountCodes;
}

export interface VisitorDeleteReport {
  seq: number;
  codes: DemoAccountCodes;
  deleted: { admin: boolean; teacher: boolean; student: boolean };
  files: { deleted: number; failed: number };
}

/** 演示库未初始化（缺演示班级）——仅影响创建 */
export class DemoAccountNotReadyError extends Error {}
/** 访客号段耗尽 */
export class DemoAccountSeqExhaustedError extends Error {}

function assertDemoScope(): void {
  if (!isDemoScope()) {
    throw new Error("演示账户操作必须在演示作用域内执行");
  }
}

/** 串行化所有账户变更：seq 分配是「扫描 + 探测 + 插入」，不可与另一变更交错 */
let mutationTail: Promise<unknown> = Promise.resolve();
function withMutationLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = mutationTail.then(fn, fn);
  mutationTail = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

interface BundleRows {
  codes: DemoAccountCodes;
  admin?: UserRow;
  teacher?: UserRow;
  student?: UserRow;
}

/** 按派生编号加载三行；角色不匹配的行视为不存在（防编号被手改后误操作） */
async function loadRows(seq: number): Promise<BundleRows | null> {
  const codes = demoAccountCodes(seq);
  const [a, t, s] = await Promise.all([
    getUserByCode(codes.admin),
    getUserByCode(codes.teacher),
    getUserByCode(codes.student),
  ]);
  const admin = a && a.role === "admin" ? a : undefined;
  const teacher = t && t.role === "teacher" ? t : undefined;
  const student = s && s.role === "student" ? s : undefined;
  if (!admin && !teacher && !student) return null;
  return { codes, admin, teacher, student };
}

function toSummary(seq: number, rows: BundleRows): VisitorAccountSummary {
  const present = [rows.admin, rows.teacher, rows.student].filter((r): r is UserRow => !!r);
  const disabled = present.length > 0 && present.every((r) => !r.password_hash);
  return {
    seq,
    name: present[0]?.name ?? "",
    disabled,
    codes: rows.codes,
    identities: { admin: !!rows.admin, teacher: !!rows.teacher, student: !!rows.student },
    classId: rows.student?.class_id ?? null,
    submittedAt: rows.student?.submitted_at ?? null,
  };
}

/** 分配下一个访客 seq：现有访客学生最大 seq + 1（无则 1000），并探测三码是否已被占用 */
async function allocateSeq(): Promise<number> {
  const students = await getStudents();
  let max = VISITOR_SEQ_START - 1;
  for (const s of students) {
    const seq = visitorSeqOf(s.user_code);
    if (seq != null && seq > max) max = seq;
  }
  let candidate = Math.max(VISITOR_SEQ_START, max + 1);
  while (candidate <= VISITOR_SEQ_MAX) {
    const codes = demoAccountCodes(candidate);
    const [a, t, s] = await Promise.all([
      getUserByCode(codes.admin),
      getUserByCode(codes.teacher),
      getUserByCode(codes.student),
    ]);
    if (!a && !t && !s) return candidate;
    candidate++;
  }
  throw new DemoAccountSeqExhaustedError(`演示访客号段已耗尽（${VISITOR_SEQ_START}–${VISITOR_SEQ_MAX}）`);
}

async function rollbackCreate(
  codes: DemoAccountCodes,
  adminId: number | undefined,
  teacherId: number | undefined
): Promise<void> {
  // student 最后建，故先按学生删（不存在则安全空操作），再教师、再 admin
  try {
    await deleteStudents([codes.student]);
  } catch (err) {
    console.error("回滚演示学生失败:", err);
  }
  if (teacherId != null) {
    try {
      await deleteTeacher(teacherId);
    } catch (err) {
      console.error("回滚演示教师失败:", err);
    }
  }
  if (adminId != null) {
    try {
      await deleteUserById(adminId);
    } catch (err) {
      console.error("回滚演示管理员失败:", err);
    }
  }
}

/** 列出全部访客账户（锚定演示学生号段 seq>=1000；名册与生产编号天然不入列） */
export async function listVisitorAccounts(): Promise<VisitorAccountSummary[]> {
  assertDemoScope();
  const students = await getStudents();
  const seqs = [
    ...new Set(
      students
        .map((s) => visitorSeqOf(s.user_code))
        .filter((v): v is number => v != null)
    ),
  ].sort((a, b) => a - b);

  const accounts: VisitorAccountSummary[] = [];
  for (const seq of seqs) {
    const rows = await loadRows(seq);
    if (rows) accounts.push(toSummary(seq, rows));
  }
  return accounts;
}

export async function getVisitorAccount(seq: number): Promise<VisitorAccountSummary | null> {
  assertDemoScope();
  assertVisitorSeq(seq);
  const rows = await loadRows(seq);
  return rows ? toSummary(seq, rows) : null;
}

export function createVisitorAccount(opts?: { password?: string }): Promise<VisitorAccountCreated> {
  return withMutationLock(async () => {
    assertDemoScope();
    const cls = await getClassByName(DEMO_CLASS_NAME);
    if (!cls) {
      throw new DemoAccountNotReadyError("演示库未初始化（缺少演示班级），请先初始化演示数据");
    }

    const seq = await allocateSeq();
    const name = pickName(Math.random); // 三身份共用一个姓名
    const plain = opts?.password ?? generatePassword(12);
    const hash = await hashPassword(plain);
    const codes = demoAccountCodes(seq);

    let adminId: number | undefined;
    let teacherId: number | undefined;
    try {
      adminId = await createDemoAccount({
        user_code: codes.admin,
        role: "admin",
        name,
        password_hash: hash,
        class_id: null,
      });
      teacherId = await createDemoAccount({
        user_code: codes.teacher,
        role: "teacher",
        name,
        password_hash: hash,
        class_id: null,
      });
      await insertTeacherClass(teacherId, cls.id);
      // student 最后建：它是列表锚点，失败时不会留下「半可见」账户
      await createDemoAccount({
        user_code: codes.student,
        role: "student",
        name,
        password_hash: hash,
        class_id: cls.id,
      });
    } catch (err) {
      await rollbackCreate(codes, adminId, teacherId);
      throw err;
    }

    return { seq, name, password: plain, codes, classId: cls.id };
  });
}

/** 禁用：三身份 password_hash 置 NULL（登录被「尚未设置密码」拦下；幂等） */
export function disableVisitorAccount(seq: number): Promise<VisitorAccountSummary | null> {
  return withMutationLock(async () => {
    assertDemoScope();
    assertVisitorSeq(seq);
    const rows = await loadRows(seq);
    if (!rows) return null;
    for (const row of [rows.admin, rows.teacher, rows.student]) {
      if (row && row.password_hash) await updateUser(row.id, { password_hash: null });
    }
    const fresh = await loadRows(seq);
    return fresh ? toSummary(seq, fresh) : null;
  });
}

/** 重置密码（同时是启用路径）：三身份写同一新 hash，明文一次性返回 */
export function rotateVisitorAccountPassword(seq: number): Promise<VisitorPasswordRotation | null> {
  return withMutationLock(async () => {
    assertDemoScope();
    assertVisitorSeq(seq);
    const rows = await loadRows(seq);
    if (!rows) return null;
    const plain = generatePassword(12);
    const hash = await hashPassword(plain);
    for (const row of [rows.admin, rows.teacher, rows.student]) {
      if (row) await updateUser(row.id, { password_hash: hash });
    }
    return { seq, password: plain, codes: rows.codes };
  });
}

interface FileRef {
  key: string;
  storageId: number;
}

/** 收集学生身份的头像/评价图引用（当前行 + 历史提交快照），按 storageId:key 去重 */
async function collectFileRefs(student: UserRow): Promise<FileRef[]> {
  const refs: FileRef[] = [];
  const add = (url: string | null, storageId: number) => {
    if (!url) return;
    const key = extractKey(url);
    if (key) refs.push({ key, storageId });
  };
  add(student.avatar_url, student.storage_id);
  add(student.evaluation_url, student.storage_id);
  const submissions = await getProfileSubmissions(student.id);
  for (const sub of submissions) {
    add(sub.avatar_url, sub.storage_id);
    add(sub.evaluation_url, sub.storage_id);
  }
  const seen = new Set<string>();
  return refs.filter((r) => {
    const k = `${r.storageId}:${r.key}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** best-effort 删除演示上传文件（含缩略图）；失败计入 failed，不阻断删除流程 */
async function deleteFiles(refs: FileRef[]): Promise<{ deleted: number; failed: number }> {
  let deleted = 0;
  let failed = 0;
  for (const ref of refs) {
    try {
      const storage = await getStorage(ref.storageId);
      await storage.delete(ref.key);
      const thumbKey = getThumbnailKey(ref.key);
      if (thumbKey !== ref.key) await storage.delete(thumbKey);
      deleted++;
    } catch (err) {
      failed++;
      console.error("删除演示账户文件失败:", ref, err);
    }
  }
  return { deleted, failed };
}

/**
 * 删除访客账户：先清档案版本与学生行（连带分组成员/测评结果），再教师（连带班级关联），再 admin。
 * 首次 DB 错误即中止（剩余行仍在，可重试）；文件在各步 DB 成功后 best-effort 清理。
 */
export function deleteVisitorAccount(seq: number): Promise<VisitorDeleteReport | null> {
  return withMutationLock(async () => {
    assertDemoScope();
    assertVisitorSeq(seq);
    const rows = await loadRows(seq);
    if (!rows) return null;

    const refs = rows.student ? await collectFileRefs(rows.student) : [];
    const deleted = { admin: false, teacher: false, student: false };

    if (rows.student) {
      await clearSubmissions([rows.codes.student]);
      await deleteStudents([rows.codes.student]);
      deleted.student = true;
    }
    if (rows.teacher) {
      await deleteTeacher(rows.teacher.id);
      deleted.teacher = true;
    }
    if (rows.admin) {
      await deleteUserById(rows.admin.id);
      deleted.admin = true;
    }

    const files = await deleteFiles(refs);
    return { seq, codes: rows.codes, deleted, files };
  });
}
