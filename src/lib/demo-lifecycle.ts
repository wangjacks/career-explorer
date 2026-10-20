/**
 * 演示库生命周期编排（#253）：初始化 / 重置 / 状态读取。
 * 全程只在演示作用域内落库；重置是「生产 admin 触发的一次性操作」，故本模块不自带角色门禁——
 * 由调用端点（/api/manage/demo/*）负责 admin 校验后 `runInDemoScope`。
 *
 * 单实例：重置=删演示库文件 + 清 uploads/demo + 重新 init 建表/播种 + 全新随机重播，绝不触碰生产库/生产 uploads。
 */
import path from "path";
import { existsSync, rmSync } from "fs";
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

function demoDbFile(): string {
  return path.resolve(process.cwd(), getDemoDbPath());
}

function removeDbArtifacts(): void {
  const dbFile = demoDbFile();
  for (const suffix of ["", "-wal", "-shm"]) rmSync(dbFile + suffix, { force: true });
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
 * 重置的单飞锁：并发 resetDemo 调用共享同一次重置的 promise，杜绝「双删库 / 交叉清 uploads /
 * 半初始化叠加」。单实例下这是关键不变量——删文件与重播种不可重入。
 */
let resetInFlight: Promise<DemoSeedReport> | null = null;

export function resetDemo(actor: DemoSeedActor): Promise<DemoSeedReport> {
  if (resetInFlight) return resetInFlight;
  resetInFlight = doReset(actor).finally(() => {
    resetInFlight = null;
  });
  return resetInFlight;
}

/**
 * 全量重置：删演示库文件 → 清 uploads/demo → 重新 init + 播种 → 全新随机重播账户+数据+分组+占位图。
 * 失败保护：播种中途异常时关掉演示 adapter（连带清掉可能已被污染缓存的 initPromise）并删除半成品库，
 * 使状态回退到「未初始化、可重试」而非「表已建、数据半截」。
 *
 * 已知限制（单实例、重置为稀有运维操作）：重置期间若恰有进行中的演示请求，可能在 close 与 delete 之间
 * 经 ensureInit 重开一个句柄；但 reset 自身的 runInDemoScope 最后写入 memo 槽的 adapter 为有效新库，
 * 陈旧句柄被覆盖，且单飞保证不会有第二次 reset 交叉，最终库状态一致。
 */
async function doReset(actor: DemoSeedActor): Promise<DemoSeedReport> {
  if (!isDemoEnabled()) throw new Error("演示模式未启用（DEMO_ENABLED != true）");

  await closeDemoDb();
  removeDbArtifacts();

  try {
    return await runInDemoScope(async () => {
      // 演示作用域下基目录即 uploads/demo；先整体清空（storage.upload 会按需重建目录）
      rmSync(getUploadsBaseDir(), { recursive: true, force: true });
      await getClasses(); // 触发全新 init（文件已删 → 重灌表与种子）
      const tagNames = (await getActiveTags()).filter((t) => t.type === "tag").map((t) => t.name);
      const plan = planDemoSeed(freshSeed(), { tagNames });
      return materializeDemoSeed(plan, defaultDemoSeedDeps, actor);
    });
  } catch (err) {
    console.error("演示库重置失败，丢弃半成品库以回到可重试态:", err);
    // 关 adapter 会清 demoAdapter/demoInitPromise memo 槽，避免被污染的 rejected initPromise 拖垮后续请求
    await closeDemoDb().catch(() => {});
    removeDbArtifacts();
    throw err;
  }
}

/**
 * 读取演示库状态与规模。库文件不存在时直接返回「未初始化 + 零计数」，**绝不开 adapter**——
 * 避免 GET status 触发建库/灌种（init 会 mkdir + 打开文件 + 写标签/测评/O*NET 种子）的副作用。
 * 仅当库已存在才在演示作用域内查询计数（按演示号段过滤，绝不泄露生产）。
 */
export function readDemoStatus(): Promise<DemoStatus> {
  const dbPath = getDemoDbPath();
  if (!existsSync(demoDbFile())) {
    return Promise.resolve({
      enabled: isDemoEnabled(),
      dbPath,
      initialized: false,
      counts: { classes: 0, students: 0, teachers: 0, submittedProfiles: 0, demoFiles: 0 },
    });
  }
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
      enabled: true,
      dbPath,
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
