import { withDemoScope } from "@/lib/demo-scope";
import { NextRequest, NextResponse } from "next/server";
import { getStudents, insertUser, getUserByCode, updateUser, deleteStudents } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { getRequestContext, recordAudit } from "@/lib/audit";
import { resolveClassByName } from "@/lib/class-utils";
import { WriteGuard } from "../write-guard";

const PATH = "/api/manage/students";
const OUT_OF_SCOPE_STUDENT = "该学生不在你管理的班级";
const OUT_OF_SCOPE_CLASS = "无权操作该班级的学生";

async function GET_impl() {
  const students = await getStudents();
  return NextResponse.json({ data: students, total: students.length });
}

async function POST_impl(request: NextRequest) {
  const { ip, user_agent } = getRequestContext(request);
  const guard = await WriteGuard.from(request);
  const actor = guard.actor;
  try {
    if (!guard.session) return guard.unauthenticated();
    const body = await request.json();

    // Single student
    if (body.studentId && body.name) {
      const entry = { action: "student:create", method: "POST", path: PATH, resource_type: "student" } as const;
      if (!/^\d{12}$/.test(body.studentId)) {
        return guard.deny(entry, String(body.studentId), "学号必须为12位数字", 400);
      }
      // 班级名解析（#160）：未命中不绑定但给出明确反馈，与批量导入共用解析口径
      const binding = await resolveClassByName(body.className);
      const existing = await getUserByCode(body.studentId);

      // 归属校验（#171）：已有学生须在该会话管辖班级内；未分班学生只有管理员能维护
      if (existing && !guard.canWriteStudent(existing)) {
        return guard.deny(entry, String(body.studentId), OUT_OF_SCOPE_STUDENT, 403, { class_id: existing.class_id });
      }
      // 目标班级须在该会话管辖范围内（改绑与新建同理）
      if (binding.classId !== null && !guard.canWriteClass(binding.classId)) {
        return guard.deny(entry, String(body.studentId), OUT_OF_SCOPE_CLASS, 403, { class_id: binding.classId });
      }
      // 教师新建学生必须放进自己带的班，否则产出一个谁都管不到的未分班账户
      if (!guard.canWriteGlobal && !existing && binding.classId === null) {
        return guard.deny(
          entry,
          String(body.studentId),
          binding.provided ? `班级「${binding.className}」不存在` : "请选择你管理的班级",
          400
        );
      }

      // 手动添加只给未分班学生补绑班级；已分班者只改姓名，转班走编辑弹窗或批量设班
      const canBind = !existing || existing.class_id == null;
      const boundClassId = canBind ? binding.classId : null;
      const classSkipped = !canBind && binding.classId !== null && binding.classId !== existing?.class_id;
      if (existing) {
        await updateUser(existing.id, {
          name: body.name,
          ...(boundClassId !== null ? { class_id: boundClassId } : {}),
        });
      } else {
        await insertUser({
          user_code: body.studentId,
          role: "student",
          name: body.name,
          ...(boundClassId !== null ? { class_id: boundClassId } : {}),
        });
      }
      const unbound = binding.provided && binding.classId === null;
      void recordAudit({
        ...actor, ...entry, resource_id: body.studentId,
        status: "success", error_message: null, ip, user_agent,
        metadata: {
          mode: existing ? "updated" : "created",
          name: body.name,
          className: binding.className || null,
          class_id: boundClassId,
          unbound,
          class_skipped: classSkipped,
        },
      });
      const suffix = unbound
        ? `；班级「${binding.className}」不存在，未绑定班级`
        : classSkipped
          ? "；该学生已有班级，未改绑（转班请用编辑或批量设班）"
          : "";
      return NextResponse.json({ message: `添加成功${suffix}`, unbound, class_skipped: classSkipped });
    }

    // Batch import
    if (Array.isArray(body.students)) {
      const entry = { action: "student:batch-import", method: "POST", path: PATH, resource_type: "student" } as const;
      const rows = (body.students as { studentId: string; name: string; className?: string }[]).filter(
        (s) => s.studentId && /^\d{12}$/.test(s.studentId) && s.name
      );
      if (rows.length === 0) {
        return guard.deny(entry, null, "没有有效的学生数据", 400, { submitted: body.students.length });
      }

      // 班级名一次解析、整批复用（与单条添加共用 #160 口径）
      const nameOf = (s: { className?: string }) => String(s.className ?? "").trim();
      const classIdByName = new Map<string, number | null>();
      for (const className of new Set(rows.map(nameOf).filter(Boolean))) {
        classIdByName.set(className, (await resolveClassByName(className)).classId);
      }
      const boundIdOf = (s: { className?: string }) => classIdByName.get(nameOf(s)) ?? null;

      // 归属预检（#171）：任一行越界则整批拒绝，绝不半途写入
      if (!guard.canWriteGlobal) {
        const classOfRoster = new Map((await getStudents()).map((s) => [s.user_code, s.class_id]));
        const foreign = rows.filter(
          (s) => classOfRoster.has(s.studentId) && !guard.canWriteClass(classOfRoster.get(s.studentId) ?? null)
        );
        if (foreign.length > 0) {
          return guard.deny(entry, null, OUT_OF_SCOPE_STUDENT, 403, { foreign: foreign.length, submitted: rows.length });
        }
        const classNames = [...new Set(rows.map(nameOf))];
        const missing = rows.filter((s) => !nameOf(s)).length;
        if (missing > 0) {
          return guard.deny(entry, null, `每行须指定班级（${missing} 行未填写）`, 400, { missing });
        }
        const unknown = classNames.filter((n) => !classIdByName.get(n));
        if (unknown.length > 0) {
          return guard.deny(entry, null, `班级「${unknown.join("」「")}」不存在`, 400, { classNames: unknown });
        }
        const outside = classNames.filter((n) => !guard.canWriteClass(classIdByName.get(n) ?? null));
        if (outside.length > 0) {
          return guard.deny(entry, null, OUT_OF_SCOPE_CLASS, 403, { classNames: outside });
        }
      }

      let unbound = 0;
      for (const s of rows) {
        const className = nameOf(s);
        const classId = boundIdOf(s);
        // 班级不存在时不绑定并计数（与单条添加共用解析口径）
        if (className && classId === null) unbound++;
        const existing = await getUserByCode(s.studentId);
        if (existing) {
          const fields: { name: string; class_id?: number } = { name: s.name };
          if (classId !== null) fields.class_id = classId;
          await updateUser(existing.id, fields);
        } else {
          await insertUser({
            user_code: s.studentId,
            role: "student",
            name: s.name,
            ...(classId !== null ? { class_id: classId } : {}),
          });
        }
      }
      void recordAudit({
        ...actor, ...entry, resource_id: null,
        status: "success", error_message: null, ip, user_agent,
        metadata: { imported: rows.length, unbound },
      });
      const suffix = unbound > 0 ? `，其中 ${unbound} 条因班级不存在未绑定` : "";
      return NextResponse.json({ message: `导入 ${rows.length} 名学生${suffix}` });
    }

    return NextResponse.json({ error: "参数错误" }, { status: 400 });
  } catch (err) {
    console.error("Students POST error:", err);
    return NextResponse.json({ error: "添加失败" }, { status: 500 });
  }
}

async function DELETE_impl(request: NextRequest) {
  const { ip, user_agent } = getRequestContext(request);
  const guard = await WriteGuard.from(request);
  const actor = guard.actor;
  try {
    if (!guard.session) return guard.unauthenticated();
    const entry = { action: "student:delete", method: "DELETE", path: PATH, resource_type: "student" } as const;
    const { ids } = await request.json();
    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: "请选择要删除的学生" }, { status: 400 });
    }
    // 归属校验（#171）：删除名单里的学生须全部在该会话管辖班级内；整批拒绝，不留半删状态
    if (!guard.canWriteGlobal) {
      const roster = await getStudents();
      const classOf = new Map(roster.map((s) => [s.user_code, s.class_id]));
      const foreign = ids.filter(
        (raw: unknown) => classOf.has(String(raw)) && !guard.canWriteClass(classOf.get(String(raw)) ?? null)
      );
      if (foreign.length > 0) {
        return guard.deny(entry, null, OUT_OF_SCOPE_STUDENT, 403, { requested: ids.length, foreign: foreign.length });
      }
    }
    const deleted = await deleteStudents(ids);
    void recordAudit({
      ...actor, ...entry, resource_id: null,
      status: "success", error_message: null, ip, user_agent,
      metadata: { ids, deleted },
    });
    return NextResponse.json({ deleted, message: `已删除 ${deleted} 名学生` });
  } catch (err) {
    console.error("Students DELETE error:", err);
    return NextResponse.json({ error: "删除失败" }, { status: 500 });
  }
}

async function PUT_impl(request: NextRequest) {
  const { ip, user_agent } = getRequestContext(request);
  const guard = await WriteGuard.from(request);
  const actor = guard.actor;
  try {
    if (!guard.session) return guard.unauthenticated();
    const entry = { action: "student:update", method: "PUT", path: PATH, resource_type: "student" } as const;
    const body = await request.json();
    const { studentId, name, className, password } = body;
    if (!studentId || (name === undefined && className === undefined && password === undefined)) {
      return NextResponse.json({ error: "参数错误" }, { status: 400 });
    }
    const existing = await getUserByCode(studentId);
    if (!existing) {
      return guard.deny(entry, String(studentId), "学号不存在", 404);
    }
    // 归属校验（#171）：被改学生须在管辖班级内（未分班学生只有管理员能改）
    if (!guard.canWriteStudent(existing)) {
      return guard.deny(entry, String(studentId), OUT_OF_SCOPE_STUDENT, 403, { class_id: existing.class_id });
    }
    const fields: { name?: string; class_id?: number | null; password_hash?: string } = {};
    if (name !== undefined) fields.name = name;
    if (className !== undefined) {
      const binding = await resolveClassByName(className);
      if (!binding.provided) {
        fields.class_id = null;
      } else if (!binding.classId) {
        return guard.deny(entry, String(studentId), "班级不存在", 400, { className: binding.className });
      } else {
        // 转班目标同样须在管辖范围内：教师不能把别人的学生接进来，也不能把自己班的学生塞进去
        if (!guard.canWriteClass(binding.classId)) {
          return guard.deny(entry, String(studentId), OUT_OF_SCOPE_CLASS, 403, { class_id: binding.classId });
        }
        fields.class_id = binding.classId;
      }
    }
    if (password !== undefined) {
      const pwd = String(password);
      if (pwd.length < 8) {
        return guard.deny(
          { action: "student:reset-password", method: "PUT", path: PATH, resource_type: "student" },
          String(studentId), "密码须至少 8 位", 400
        );
      }
      fields.password_hash = await hashPassword(pwd);
    }
    await updateUser(existing.id, fields);

    // 资料变更与改密分别记审计（可同时发生）；密码绝不入 metadata（#110）
    if (name !== undefined || className !== undefined) {
      void recordAudit({
        ...actor, ...entry, resource_id: String(studentId),
        status: "success", error_message: null, ip, user_agent,
        metadata: {
          old: { name: existing.name, class_id: existing.class_id },
          new: { name: fields.name ?? existing.name, class_id: fields.class_id ?? existing.class_id },
        },
      });
    }
    if (password !== undefined) {
      void recordAudit({
        ...actor,
        action: "student:reset-password", method: "PUT", path: PATH, resource_type: "student",
        resource_id: String(studentId),
        status: "success", error_message: null, ip, user_agent, metadata: null,
      });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Students PUT error:", err);
    return NextResponse.json({ error: "更新失败" }, { status: 500 });
  }
}

export const GET = withDemoScope(GET_impl);
export const POST = withDemoScope(POST_impl);
export const DELETE = withDemoScope(DELETE_impl);
export const PUT = withDemoScope(PUT_impl);
