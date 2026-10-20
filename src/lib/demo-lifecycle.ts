/**
 * 演示库生命周期编排（#253）：初始化 / 重置 / 状态读取。
 * 全程只在演示作用域内落库；重置是「生产 admin 触发的一次性操作」，故本模块不自带角色门禁——
 * 由调用端点（/api/manage/demo/*）负责 admin 校验后 `runInDemoScope`。
 *
 * 单实例：重置=删演示库文件 + 清 uploads/demo + 重新 init 建表/播种 + 全新随机重播，绝不触碰生产库/生产 uploads。
 */
import path from "path";
import { rmSync } from "fs";
import { isDemoEnabled, getDemoDbPath, runInDemoScope } from "./demo-scope";
import { getUploadsBaseDir } from "./storage-local";
import { getStorage } from "./storage";
import {
  getClasses,
  getStudents,
  getTeachers,
  getActiveTags,
  getDefaultStorageBackend,
  closeDemoDb,
} from "./db";
import {
  planDemoSeed,
  materializeDemoSeed,
  defaultDemoSeedDeps,
  type DemoSeedActor,
  type DemoSeedReport,
} from "./demo-seed";

/** 每次全新随机种子（不可复现、不暴露、不存储）——满足「演示数据每次新随机」 */
function freshSeed(): number {
  return (Math.random() * 0x1_0000_0000) >>> 0;
}

/** 仅确保演示库存在并完成 init（建表 + seedTags/seedAssessments/seedO*NET + 本地默认后端）。幂等 */
export function initDemoDb(): Promise<void> {
  if (!isDemoEnabled()) throw new Error("演示模式未启用（DEMO_ENABLED != true）");
  return runInDemoScope(async () => {
    await getClasses(); // 触发 ensureInit → getDemoAdapter → init
  });
}

export interface DemoStatus {
  enabled: boolean;
  dbPath: string;
  initialized: boolean;
  counts: {
    classes: number;
    students: number;
    teachers: number;
    submittedProfiles: number;
    demoFiles: number;
  };
}

/**
 * 全量重置：删演示库文件 → 清 uploads/demo → 重新 init + 播种 → 全新随机重播账户+数据+分组+占位图。
 * 须在演示作用域外调用 closeDemoDb（它只清演示 memo 槽，与当前作用域无关）。
 */
export async function resetDemo(actor: DemoSeedActor): Promise<DemoSeedReport> {
  if (!isDemoEnabled()) throw new Error("演示模式未启用（DEMO_ENABLED != true）");

  await closeDemoDb();
  const dbFile = path.resolve(process.cwd(), getDemoDbPath());
  for (const suffix of ["", "-wal", "-shm"]) rmSync(dbFile + suffix, { force: true });

  return runInDemoScope(async () => {
    // 演示作用域下基目录即 uploads/demo；先整体清空（storage.upload 会按需重建目录）
    rmSync(getUploadsBaseDir(), { recursive: true, force: true });
    await getClasses(); // 触发全新 init（文件已删 → 重灌表与种子）
    const tagNames = (await getActiveTags()).filter((t) => t.type === "tag").map((t) => t.name);
    const plan = planDemoSeed(freshSeed(), { tagNames });
    return materializeDemoSeed(plan, defaultDemoSeedDeps, actor);
  });
}

/** 读取演示库状态与规模（全部计数只来自演示作用域、按演示号段过滤，绝不泄露生产） */
export function readDemoStatus(): Promise<DemoStatus> {
  return runInDemoScope(async () => {
    const classes = await getClasses();
    const students = (await getStudents()).filter((s) => /^9\d{11}$/.test(s.user_code));
    const teachers = (await getTeachers()).filter((t) => /^99\d{6}$/.test(t.user_code));
    const submittedProfiles = students.filter((s) => s.submitted_at).length;

    let demoFiles = 0;
    const backend = await getDefaultStorageBackend();
    if (backend) {
      demoFiles = (await (await getStorage(backend.id)).listObjects()).length;
    }

    return {
      enabled: isDemoEnabled(),
      dbPath: getDemoDbPath(),
      initialized: classes.length > 0 && students.length > 0,
      counts: {
        classes: classes.length,
        students: students.length,
        teachers: teachers.length,
        submittedProfiles,
        demoFiles,
      },
    };
  });
}
