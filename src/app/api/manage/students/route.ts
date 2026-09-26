import { NextRequest, NextResponse } from "next/server";
import { getStudents, insertUser, getUserByCode, updateUser, deleteStudents, getClassByName } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { getAuditActor, getRequestContext, recordAudit } from "@/lib/audit";
import { resolveClassByName } from "@/lib/class-utils";

export async function GET() {
  const students = await getStudents();
  return NextResponse.json({ data: students, total: students.length });
}

export async function POST(request: NextRequest) {
  const { ip, user_agent } = getRequestContext(request);
  const actor = await getAuditActor(request);
  try {
    const body = await request.json();

    // Single student
    if (body.studentId && body.name) {
      if (!/^\d{12}$/.test(body.studentId)) {
        void recordAudit({
          ...actor, action: "student:create", method: "POST", path: "/api/manage/students",
          resource_type: "student", resource_id: String(body.studentId),
          status: "failed", error_message: "学号必须为12位数字", ip, user_agent, metadata: null,
        });
        return NextResponse.json({ error: "学号必须为12位数字" }, { status: 400 });
      }
      // 班级名解析（#160）：未命中不绑定但给出明确反馈，与批量导入共用解析口径
      const binding = await resolveClassByName(body.className);
      const existing = await getUserByCode(body.studentId);
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
        ...actor, action: "student:create", method: "POST", path: "/api/manage/students",
        resource_type: "student", resource_id: body.studentId,
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
      const valid = body.students.filter(
        (s: { studentId: string; name: string; className?: string }) =>
          s.studentId && /^\d{12}$/.test(s.studentId) && s.name
      );
      if (valid.length === 0) {
        void recordAudit({
          ...actor, action: "student:batch-import", method: "POST", path: "/api/manage/students",
          resource_type: "student", resource_id: null,
          status: "failed", error_message: "没有有效的学生数据", ip, user_agent,
          metadata: { submitted: body.students.length },
        });
        return NextResponse.json({ error: "没有有效的学生数据" }, { status: 400 });
      }
      let unbound = 0;
      for (const s of valid) {
        // 按班级名查 class_id；班级不存在时不绑定并计数（与单条添加共用解析口径）
        const binding = await resolveClassByName(s.className);
        if (binding.provided && binding.classId === null) unbound++;
        const existing = await getUserByCode(s.studentId);
        if (existing) {
          const fields: { name: string; class_id?: number } = { name: s.name };
          if (binding.classId !== null) fields.class_id = binding.classId;
          await updateUser(existing.id, fields);
        } else {
          await insertUser({
            user_code: s.studentId,
            role: "student",
            name: s.name,
            ...(binding.classId !== null ? { class_id: binding.classId } : {}),
          });
        }
      }
      void recordAudit({
        ...actor, action: "student:batch-import", method: "POST", path: "/api/manage/students",
        resource_type: "student", resource_id: null,
        status: "success", error_message: null, ip, user_agent,
        metadata: { imported: valid.length, unbound },
      });
      const suffix = unbound > 0 ? `，其中 ${unbound} 条因班级不存在未绑定` : "";
      return NextResponse.json({ message: `导入 ${valid.length} 名学生${suffix}` });
    }

    return NextResponse.json({ error: "参数错误" }, { status: 400 });
  } catch (err) {
    console.error("Students POST error:", err);
    return NextResponse.json({ error: "添加失败" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const { ip, user_agent } = getRequestContext(request);
  const actor = await getAuditActor(request);
  try {
    const { ids } = await request.json();
    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: "请选择要删除的学生" }, { status: 400 });
    }
    const deleted = await deleteStudents(ids);
    void recordAudit({
      ...actor, action: "student:delete", method: "DELETE", path: "/api/manage/students",
      resource_type: "student", resource_id: null,
      status: "success", error_message: null, ip, user_agent,
      metadata: { ids, deleted },
    });
    return NextResponse.json({ deleted, message: `已删除 ${deleted} 名学生` });
  } catch (err) {
    console.error("Students DELETE error:", err);
    return NextResponse.json({ error: "删除失败" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const { ip, user_agent } = getRequestContext(request);
  const actor = await getAuditActor(request);
  try {
    const body = await request.json();
    const { studentId, name, className, password } = body;
    if (!studentId || (name === undefined && className === undefined && password === undefined)) {
      return NextResponse.json({ error: "参数错误" }, { status: 400 });
    }
    const existing = await getUserByCode(studentId);
    if (!existing) {
      void recordAudit({
        ...actor, action: "student:update", method: "PUT", path: "/api/manage/students",
        resource_type: "student", resource_id: String(studentId),
        status: "failed", error_message: "学号不存在", ip, user_agent, metadata: null,
      });
      return NextResponse.json({ error: "学号不存在" }, { status: 404 });
    }
    const fields: { name?: string; class_id?: number | null; password_hash?: string } = {};
    if (name !== undefined) fields.name = name;
    if (className !== undefined) {
      if (!className) {
        fields.class_id = null;
      } else {
        const cls = await getClassByName(className);
        if (!cls) {
          void recordAudit({
            ...actor, action: "student:update", method: "PUT", path: "/api/manage/students",
            resource_type: "student", resource_id: String(studentId),
            status: "failed", error_message: "班级不存在", ip, user_agent,
            metadata: { className },
          });
          return NextResponse.json({ error: "班级不存在" }, { status: 400 });
        }
        fields.class_id = cls.id;
      }
    }
    if (password !== undefined) {
      const pwd = String(password);
      if (pwd.length < 8) {
        void recordAudit({
          ...actor, action: "student:reset-password", method: "PUT", path: "/api/manage/students",
          resource_type: "student", resource_id: String(studentId),
          status: "failed", error_message: "密码须至少 8 位", ip, user_agent, metadata: null,
        });
        return NextResponse.json({ error: "密码须至少 8 位" }, { status: 400 });
      }
      fields.password_hash = await hashPassword(pwd);
    }
    await updateUser(existing.id, fields);

    // 资料变更与改密分别记审计（可同时发生）；密码绝不入 metadata（#110）
    if (name !== undefined || className !== undefined) {
      void recordAudit({
        ...actor, action: "student:update", method: "PUT", path: "/api/manage/students",
        resource_type: "student", resource_id: String(studentId),
        status: "success", error_message: null, ip, user_agent,
        metadata: {
          old: { name: existing.name, class_id: existing.class_id },
          new: { name: fields.name ?? existing.name, class_id: fields.class_id ?? existing.class_id },
        },
      });
    }
    if (password !== undefined) {
      void recordAudit({
        ...actor, action: "student:reset-password", method: "PUT", path: "/api/manage/students",
        resource_type: "student", resource_id: String(studentId),
        status: "success", error_message: null, ip, user_agent, metadata: null,
      });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Students PUT error:", err);
    return NextResponse.json({ error: "更新失败" }, { status: 500 });
  }
}
