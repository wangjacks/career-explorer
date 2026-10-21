import { getConfig } from "./db-config";
import { MysqlAdapter } from "./db-mysql";
import { SqliteAdapter } from "./db-sqlite";
import { isDemoScope, isDemoEnabled, getDemoDbPath } from "./demo-scope";
import type { QuestionOrigin } from "./assessment-data";
import type { ProfileListQuery } from "./profile-query";
import type { ClassTrendSeries, CompareStat } from "./stats-utils";

export type { ClassTrendSeries, CompareStat };

/** 数据列表筛选与排序入参（#295）：与前端 / API 共用同一形状，避免三处各定义一遍 */
export type SubmittedProfileFilters = ProfileListQuery;

/**
 * 批查分片大小（#193）：单条 SQL 的绑定参数数量有引擎上限——SQLite 旧构建为
 * 999（新构建 32766），MySQL 为 65535。批量导入的学号数量随名单规模增长，
 * 因此按 500 分片查询，远低于所有上限，也避免构造超长 IN 列表。
 */
export const BATCH_QUERY_CHUNK_SIZE = 500;

/** 按固定大小切分数组（批查分片用，最后一片可短于 size） */
export function chunkArray<T>(items: T[], size: number = BATCH_QUERY_CHUNK_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/** 按学号批查时的轻量投影（#193）：批量导入只需要「标识 + 班级归属」，不取整行（含 password_hash） */
export interface UserCodeRef {
  id: number;
  user_code: string;
  class_id: number | null;
}

export interface UserRow {
  id: number;
  user_code: string;
  password_hash: string | null;
  role: string;
  name: string;
  class_id: number | null;
  tags: string | null; // JSON 数组（标签名称），如 '["阅读","编程"]'
  avatar_url: string | null;
  /** 历史上传的评价词云图片；#162 起仅用于存量兼容，新数据写 evaluation_text */
  evaluation_url: string | null;
  /** 三条他人评价的 JSON 数组（#162），如 '["评价一","评价二","评价三"]' */
  evaluation_text: string | null;
  submitted_at: string | null;
  created_at: string;
  /** 文件所在存储后端（#111；旧备份可能缺失，恢复时回填本地后端） */
  storage_id: number;
}

export interface TagRow {
  id: number;
  name: string;
  type: "category" | "tag";
  parent_id: number | null;
  class_id: number;
  category_order: number;
  sort_order: number;
  active: number;
}

/** 档案提交历史版本行（#95）：每次提交的快照，users 表仅保留当前生效版本 */
export interface ProfileSubmissionRow {
  id: number;
  user_id: number;
  version: number;
  tags: string | null;
  avatar_url: string | null;
  evaluation_url: string | null;
  evaluation_text: string | null;
  storage_id: number;
  submitted_at: string;
  is_current: number;
}

/** insertProfileSubmission 的可写字段（不含 id/user_id/version） */
export interface ProfileSubmissionData {
  tags: string | null;
  avatar_url: string | null;
  evaluation_url: string | null;
  evaluation_text: string | null;
  storage_id: number;
  submitted_at: string;
  is_current: number;
}

/** 超限学生行（#95）：含班级用于教师管辖过滤 */
export interface ProfileSubmissionExceedRow {
  user_id: number;
  user_code: string;
  name: string;
  class_id: number | null;
  version_count: number;
}

/** 被引用的媒体文件（#118/#117）：存量缩略图补生成与媒体全量列表共用，携带后端归属与关联学生 */
export interface MediaFileRef {
  url: string;
  storageId: number;
  /** 关联学生（#117 全量列表展示用）；同一文件可能被多行引用，取其一 */
  userCode?: string;
  userName?: string;
}

/** 历史版本文件归属（#95）：storage-sign 对快照文件做权限校验时反查用 */
export interface ProfileSubmissionFileOwner {
  user_id: number;
  class_id: number | null;
  storage_id: number;
}

export interface BackupTagRow {
  id: number;
  name: string;
  type?: "category" | "tag";
  parent_id?: number | null;
  category?: string;
  class_id?: number | null;
  category_order?: number;
  sort_order?: number;
  active?: number;
}

/** 将 v2 备份中的 category 文本标签转换为 v3 层级标签。 */
export function normalizeBackupTags(tags: BackupTagRow[]): TagRow[] {
  const maxId = tags.reduce((max, tag) => Math.max(max, tag.id), 0);
  let nextCategoryId = maxId + 1;
  const categories = new Map<string, TagRow>();
  const result: TagRow[] = [];

  for (const tag of tags) {
    if (tag.type === "category") {
      const category: TagRow = {
        id: tag.id,
        name: tag.name,
        type: "category",
        parent_id: null,
        class_id: tag.class_id ?? 0,
        category_order: tag.category_order ?? 0,
        sort_order: tag.sort_order ?? 0,
        active: tag.active ?? 1,
      };
      categories.set(tag.name, category);
      result.push(category);
    }
  }

  for (const tag of tags) {
    if (tag.type === "category") continue;
    const categoryName = tag.category;
    let parent = categoryName ? categories.get(categoryName) : undefined;
    if (!parent && categoryName) {
      parent = {
        id: nextCategoryId++,
        name: categoryName,
        type: "category",
        parent_id: null,
        class_id: tag.class_id ?? 0,
        category_order: tag.category_order ?? 0,
        sort_order: 0,
        active: 1,
      };
      categories.set(categoryName, parent);
      result.push(parent);
    }
    result.push({
      id: tag.id,
      name: tag.name,
      type: "tag",
      parent_id: tag.parent_id ?? parent?.id ?? null,
      class_id: tag.class_id ?? 0,
      category_order: tag.category_order ?? parent?.category_order ?? 0,
      sort_order: tag.sort_order ?? 0,
      active: tag.active ?? 1,
    });
  }

  return result.sort((a, b) => a.id - b.id);
}

export interface ClassRow {
  id: number;
  name: string;
  invitation_code: string;
  created_at: string;
}

export interface TeacherClassRow {
  id: number;
  teacher_id: number;
  class_id: number;
  created_at: string;
}

export interface Stats {
  total: number;
  today: number;
  uniqueTags: number;
  topTags: { tag: string; count: number }[];
}

/** 提交趋势的单日点（#165）：窗口内每天一个点，无提交为 0 */
export interface TrendPoint {
  date: string;
  count: number;
}

/** 班级名册行（#217）：按班级身份聚合口径，只取展示所需字段，绝不带 password_hash */
export interface ClassRosterRow {
  name: string;
  user_code: string;
  submitted_at: string | null;
  tags: string | null;
}

/* ---------- 分组（#101） ---------- */

/** class_groups 行：当前分组里的一个组（允许空组，手工调整时会出现） */
export interface ClassGroupRow {
  id: number;
  class_id: number;
  group_no: number;
  created_at: string;
}

/** class_group_members 行：当前分组的成员归属 */
export interface ClassGroupMemberRow {
  id: number;
  group_id: number;
  user_id: number;
  created_at: string;
}

/** 覆盖当前分组的入参：组号 + 成员（成员只需 user_id，展示字段由路由用班级名单拼装） */
export interface ClassGroupingInput {
  group_no: number;
  user_ids: number[];
}

/** group_batches 行：一次自动分组的批次头（历史归档，只追加） */
export interface GroupBatchRow {
  id: number;
  class_id: number;
  /** 本次使用的策略名（算法标识） */
  strategy: string;
  /** 本次用到的特征源（JSON 文本：key / kind / weight）——新增数据源只需扩充这一列 */
  feature_sources: string | null;
  /** 目标组容量（每组上限） */
  group_size: number;
  student_count: number;
  /** 有特征的学生数（本期即「有标签人数」） */
  tagged_count: number;
  /** 指标快照（JSON 文本；标签会随时间变，故质量指标必须快照） */
  metrics: string | null;
  created_by_id: number | null;
  created_by_name: string | null;
  created_by_role: string | null;
  created_at: string;
}

/** group_batch_groups 行：批次内的一个组 */
export interface GroupBatchGroupRow {
  id: number;
  batch_id: number;
  group_no: number;
  /** 组内平均相似度快照 */
  cohesion: number | null;
  member_count: number;
  created_at: string;
}

/** group_batch_members 行：批次某组的成员（姓名/学号为快照，账号删除后历史仍可读） */
export interface GroupBatchMemberRow {
  id: number;
  /** 冗余批次号：用于在库层保证「同批次一个学生只出现一次」 */
  batch_id: number;
  group_id: number;
  user_id: number;
  user_code: string | null;
  name: string | null;
  created_at: string;
}

/** 追加一个历史批次的入参（头 + 组 + 成员，由适配器在同一事务内写入） */
export interface NewGroupBatchInput {
  classId: number;
  strategy: string;
  featureSources: string;
  groupSize: number;
  studentCount: number;
  taggedCount: number;
  metrics: string;
  actorId: number | null;
  actorName: string | null;
  actorRole: string | null;
  groups: {
    groupNo: number;
    cohesion: number | null;
    members: { userId: number; userCode: string | null; name: string | null }[];
  }[];
}

/* ---------- 职业测评（#221：测评定义 / 题库 / 作答结果三表） ---------- */

/** assessments 行：测评定义。题库进库而非写死代码，便于扩充第二套量表与后台维护中文题面 */
export interface AssessmentRow {
  id: number;
  /** 量表标识，如 `riasec`；跨环境稳定的业务主键 */
  code: string;
  name: string;
  question_count: number;
  /** 每次作答题数（#282）：0 = 全量作答（题库即本轮），>0 时分层抽题（`assessment-sampling.ts`） */
  items_per_attempt: number;
  /** 维度定义 JSON 文本 `[{ key, label }]`，顺序即展示与计分顺序 */
  dimensions_json: string;
  /** `typological`（取类型码，如霍兰德三字码）/ `dimensional`（多维高低分档） */
  scoring_mode: "typological" | "dimensional";
  scale_version: string;
  /** 署名文本：第三方量表（如 O*NET）授权要求，必须随作答与结果下发 */
  attribution: string;
  /** 授权条款与「修改未经官方审核」声明 */
  license_text: string;
  /** 免责声明：结果是探索参考，不作诊断或录用依据 */
  disclaimer: string;
  /** 0/1：是否在学生测评中心可见；下线量表保留数据只改这一列 */
  enabled: number;
  created_at: string;
  updated_at: string;
}

/** assessment_questions 行：题库（题面 + 计分元数据） */
export interface AssessmentQuestionRow {
  id: number;
  assessment_id: number;
  /** 作答题号，量表内从 1 开始唯一（唯一约束 `assessment_id + question_index`） */
  question_index: number;
  prompt: string;
  /** 所属维度：必须是该量表 `dimensions_json` 里的某个 key */
  dimension: string;
  /** 题目来源（#281）：`onet-mini` / `onet-sf` / `cn-original`，分层抽样与分来源分析用 */
  origin: QuestionOrigin;
  /** 0/1：反向计分（Mini-IP 全为正向，字段为后续量表预留） */
  reverse_scored: number;
  /** 题面版本，题面改动时自增；作答快照另存 answers/scores，历史结果不因此漂移 */
  version: number;
  created_at: string;
}

/** 题库升级结果（#281，只增不改）：供单测与日志观测，不对外暴露 */
export interface AssessmentBankUpgradeResult {
  /** 本次补插的题目数 */
  inserted: number;
  /** 本次回填 origin 的题目数（已存在题号只动这一列） */
  originBackfilled: number;
  /** 是否因 scale_version 变化而整体更新了量表定义字段 */
  definitionUpdated: boolean;
  /**
   * 是否在同版本库上单独刷新了 `license_text`（#284）：授权与放行状态文案是合规生成内容，
   * 与版本号无关；刷新只动这一列，不覆盖后台维护的 name 等字段
   */
  licenseTextUpdated: boolean;
  /** 是否回填了 `items_per_attempt`（#282：每次抽题数，与版本号无关） */
  itemsPerAttemptUpdated: boolean;
}

/** assessment_results 行：一次作答 + 结果快照（快照而非实时计算，学生回看仍是当时的结论） */
export interface AssessmentResultRow {
  id: number;
  user_id: number;
  assessment_id: number;
  /** `in_progress` 草稿（同 (user_id, assessment_id) 至多一条）/ `completed` 完成记录（可多条） */
  status: "in_progress" | "completed";
  /** 作答 JSON 文本：题号 → 1-5 作答值；草稿即未答全 */
  answers_json: string;
  /**
   * 本轮抽题快照（#282）：`{"v":1,"pool":"<题库指纹>","indexes":[…按呈现顺序]}`，
   * 默认 `'[]'`（旧数据读作「全库即本轮」）。解析/序列化只在 `assessment-sampling.ts` 一处。
   */
  items_json: string;
  /** 得分 JSON 文本：完成时写入（维度得分快照），草稿为 NULL */
  scores_json: string | null;
  /** 类型码（`typological` 模式的三字码，如 `SIA`）；`dimensional` 量表为 NULL */
  type_code: string | null;
  /** 0/1：是否为该用户该量表的当前有效完成结果（仅 completed 会置 1） */
  is_current: number;
  /**
   * 草稿位：草稿恒为 1、完成记录恒为 NULL，配合 `UNIQUE(user_id, assessment_id, draft_slot)`
   * 让「同一学生同一量表至多一条草稿」成为**数据库级**不变量（两库都允许多个 NULL，故完成记录不受限）。
   */
  draft_slot: number | null;
  started_at: string;
  updated_at: string;
  /** 完成时间；草稿为 NULL */
  completed_at: string | null;
}

/**
 * 教师侧「当前测评结果」轻量快照（#233 导出 / #234 数据列表共用）：一次批查，不逐学生查库。
 *
 * 只带需要的四列（学号 / 三字码 / 维度分快照 / 完成时间），不含作答内容——两个消费方都
 * 没有「逐题作答」的诉求，少取一列就少一份个人数据的搬运面。
 */
export interface AssessmentResultSummary {
  user_code: string;
  type_code: string | null;
  scores_json: string | null;
  completed_at: string | null;
}


/** completeAssessmentResult 入参（计分由调用方用计分引擎算好再落库，数据层不重复实现算法） */
export interface CompleteAssessmentInput {
  userId: number;
  assessmentId: number;
  answersJson: string;
  /** 本轮抽题快照（#282）：完成记录沿用草稿行时一并落库，`assessment-sampling.ts` 负责序列化 */
  itemsJson: string;
  scoresJson: string | null;
  typeCode: string | null;
}

/**
 * 测评统计的**原始计数**（#229，教师端）：适配器只负责数数，完成率、排序、截断与中文标签
 * 统一由 `src/lib/assessment-stats.ts` 的纯函数算——两适配器不重复实现同一套口径。
 *
 * 范围口径：`classIds = null` 表示全校（含未分班学生，保证完成率不出现 >100% 的怪值）；
 * 传具体班级集合时只统计这些班的学生，班级列表也只含这些班。
 */
export interface AssessmentStatsRaw {
  classes: { class_id: number; name: string; enrolled: number; assessed: number }[];
  /** 六型计数：key = 三字码首位字母（与计分引擎的破平优先序一致，不另算一遍） */
  types: { key: string; count: number }[];
  /** 每班六型计数（#311）：key = 三字码首位字母；未分班学生不进入班级构成 */
  classTypes: { class_id: number; key: string; count: number }[];
  /** 三字码计数（未排序未截断，最终展示顺序见 `finalizeAssessmentStats`） */
  codes: { code: string; count: number }[];
  total: { enrolled: number; assessed: number; last_completed_at: string | null };
}

/**
 * dimensional 量表的逐人结果快照（#312）：只取三列，供纯函数解析档位。
 *
 * 刻意不取姓名/学号：人格分布是**纯聚合**，个人分数与身份都不离开数据层；
 * 原始分数（`raw` / `standard`）由纯函数解析后只留下三档计数，响应里不出现。
 */
export interface DimensionalResultScoreRow {
  user_id: number;
  scores_json: string | null;
  completed_at: string | null;
}

/**
 * 班级完成矩阵的**原始计数**（#310）：档案提交与各量表已完成人数都按 `class_id` 分组，
 * `class_id = null` 表示未分班；`name` 只用于展示，**绝不作为分组键**（改名/重名会串数据）。
 * 完成率、列顺序、排序、空班剔除与总计统一由 `src/lib/completion-stats.ts` 的纯函数算。
 */
export interface CompletionStatsRaw {
  profile: {
    class_id: number | null;
    name: string | null;
    enrolled: number;
    submitted: number;
  }[];
  assessments: {
    assessment_id: number;
    class_id: number | null;
    assessed: number;
  }[];
}

/**
 * 测评名册行（#229）：**含个人信息**，只给教师端下钻用，读取必须记审计。
 *
 * #313 起支持多量表：`riasec` 看 `code`（三字码），`dimensional` 量表（如 `ipip-neo-ffi`）没有三字码，
 * 需要 `includeScores` 一并取回 `scores_json` 才能算档位——但**接口只下发档位**，绝不外泄 raw / standard。
 */
export interface AssessmentRosterRow {
  class_id: number | null;
  class_name: string | null;
  name: string;
  user_code: string;
  /** 三字码（首位即归型依据）；dimensional 量表恒为 null */
  code: string | null;
  assessed_at: string;
  /** 结果快照 JSON（仅 `filters.includeScores` 时取回）；dimensional 量表据此算档位 */
  scores_json?: string | null;
}

/** 未完成名册行（#313）：在册学生里还没有该量表 `completed + is_current` 记录的人，只给定位信息、不含测评字段 */
export interface AssessmentMissingRosterRow {
  class_id: number | null;
  class_name: string | null;
  name: string;
  user_code: string;
}

/**
 * onet_occupations 行（#226）：O*NET 职业库，**离线导入的只读参考数据**。
 * 不进备份（可离线重灌，且体量远大于业务数据），恢复后按种子自愈。
 */
export interface OnetOccupationRow {
  id: number;
  /** O*NET-SOC Code，如 `15-1252.00` */
  code: string;
  /** 英文职业名（O*NET 原始 Title） */
  name: string;
  /** 中文译名；首批未覆盖的职业为 NULL（展示回退英文名） */
  name_zh: string | null;
  /** O*NET 官方兴趣高码（1–3 位字母，由官方 Interest High-Point 指标推导） */
  interest_code: string;
  /** 六型原始分 JSON：`{"R":3.61,"I":6.05,"A":2.37,"S":1.81,"E":1.87,"C":5.62}`（O*NET 1–7 分） */
  interests_json: string;
  /** O*NET Job Zone 1–5 */
  job_zone: number;
  /** 由 Job Zone 归纳的常见学历要求（中文） */
  education_level: string;
  /** SOC 大类（所属职业群，中文） */
  cluster: string;
  /** 数据快照版本，如 `30.2` */
  dataset_version: string;
  created_at: string;
}

export interface BackupData {
  version: number;
  sourceType: string;
  createdAt: string;
  users: UserRow[];
  classes: ClassRow[];
  teacher_classes: TeacherClassRow[];
  tags: BackupTagRow[];
  /** 审计日志（#110；旧备份可能缺失，读取方容忍 undefined；恢复时缺字段 → 保留现状：记录本身要不可篡改，操作者另有 actor_user_code/姓名冗余快照兜底） */
  audit_logs?: AuditLogRow[];
  /** 档案功能配置（configs_profile 键值对；旧备份可能缺失，读取方容忍 undefined；恢复时缺字段 → 保留当前配置） */
  configs_profile?: { key: string; value: string }[];
  /** 存储后端注册表（#111；不含凭据；旧备份可能缺失，读取方容忍 undefined；恢复时缺字段 → 保留当前后端表并回填本地后端） */
  storage_backends?: StorageBackendRow[];
  /** 档案提交历史版本（#95；旧备份可能缺失。**按 user_id 引用 users，恢复时缺字段一律清空**，否则同 id 换人后会把甲的历史交给乙） */
  profile_submissions?: ProfileSubmissionRow[];
  /** 当前分组：组（#101；旧备份可能缺失，恢复时缺字段一律清空） */
  class_groups?: ClassGroupRow[];
  /** 当前分组：成员归属（#101；旧备份可能缺失，恢复时缺字段一律清空） */
  class_group_members?: ClassGroupMemberRow[];
  /** 历史批次头（#101；旧备份可能缺失，恢复时缺字段一律清空） */
  group_batches?: GroupBatchRow[];
  /** 历史批次内的组（#101；旧备份可能缺失，恢复时缺字段一律清空） */
  group_batch_groups?: GroupBatchGroupRow[];
  /** 历史批次的成员快照（#101；旧备份可能缺失，恢复时缺字段一律清空） */
  group_batch_members?: GroupBatchMemberRow[];
  /** 测评定义（#221；旧备份可能缺失，恢复时保留当前题库不动） */
  assessments?: AssessmentRow[];
  /** 题库（#221；旧备份可能缺失） */
  assessment_questions?: AssessmentQuestionRow[];
  /** 学生作答与结果快照（#221；旧备份可能缺失。**按 user_id 引用 users，恢复时缺字段一律清空**，口径同 profile_submissions） */
  assessment_results?: AssessmentResultRow[];
}

/** configs_profile 表行 */
export interface ConfigRow {
  key: string;
  value: string;
}

/** audit_logs 表行（#110）：操作者字段为快照冗余，账号改名/删除后仍可追溯 */
export interface AuditLogRow {
  id: number;
  created_at: string;
  actor_id: number | null; // 登录失败时为 NULL
  actor_user_code: string | null;
  actor_name: string | null;
  actor_role: string | null;
  action: string; // 语义词汇表 `资源:动作`
  method: string | null;
  path: string | null;
  resource_type: string | null;
  resource_id: string | null;
  status: "success" | "failed" | string;
  error_message: string | null;
  ip: string | null;
  user_agent: string | null;
  metadata: string | null; // JSON，已脱敏 + 截断
}

/** 审计日志写入参数（created_at 由适配器统一生成） */
export type NewAuditLog = Omit<AuditLogRow, "id" | "created_at">;

/** 审计日志查询筛选（教师场景由调用方强制注入 actorId，防越权） */
export interface AuditLogFilters {
  page: number;
  pageSize: number;
  from?: string;
  to?: string;
  actorId?: number;
  actorRole?: string;
  actorQuery?: string; // 姓名/编号模糊
  action?: string;
  resourceType?: string;
  status?: string;
}

/** 档案功能配置项：自定义标签数量上限默认值 */
export const DEFAULT_MAX_CUSTOM_TAGS = 6;

/** 上传大小上限配置（#111，单位 MB，按资源类型分设） */
export const MAX_AVATAR_SIZE_KEY = "max_avatar_size_mb";
export const MAX_EVALUATION_SIZE_KEY = "max_evaluation_size_mb";
export const DEFAULT_MAX_AVATAR_SIZE_MB = 5;
export const DEFAULT_MAX_EVALUATION_SIZE_MB = 10;

/** 档案提交历史版本上限配置（#95）：超出后仅删除 DB 记录，文件保留 */
export const MAX_PROFILE_SUBMISSIONS_KEY = "max_profile_submissions";
export const DEFAULT_MAX_PROFILE_SUBMISSIONS = 10;

/** 孤儿文件保留期配置（#117，单位天）：孤儿超过保留期才允许清理（覆盖上传→保存宽限期） */
export const MEDIA_ORPHAN_RETENTION_KEY = "media_orphan_retention_days";
export const DEFAULT_MEDIA_ORPHAN_RETENTION_DAYS = 7;

/** storage_backends 表行（#111）：凭据不入库，走 .env.local（S3_{id}_ACCESS_KEY / S3_{id}_SECRET_KEY） */
export interface StorageBackendRow {
  id: number;
  name: string;
  type: "local" | "s3";
  endpoint: string; // 公网端点（签名 URL 用）；local 后端为空
  internal_endpoint: string | null; // 内网端点，可选（服务端读写优先）
  region: string | null;
  bucket: string | null;
  path_prefix: string | null; // 对象根目录前缀，可选
  is_default: number; // 0/1，唯一默认由事务保证
  created_at: string;
  updated_at: string;
}

export interface NewStorageBackend {
  name: string;
  type: "local" | "s3";
  endpoint?: string;
  internal_endpoint?: string | null;
  region?: string | null;
  bucket?: string | null;
  path_prefix?: string | null;
}

export interface StorageBackendUpdateFields {
  name?: string;
  endpoint?: string;
  internal_endpoint?: string | null;
  region?: string | null;
  bucket?: string | null;
  path_prefix?: string | null;
}

export interface NewUser {
  user_code: string;
  password_hash?: string;
  role: string;
  name: string;
  class_id?: number | null;
}

export interface UserUpdateFields {
  name?: string;
  class_id?: number | null;
  password_hash?: string | null;
}

export interface DbAdapter {
  init(): Promise<void> | void;

  // users
  insertUser(user: NewUser): Promise<number> | number;
  getUserByCode(userCode: string): Promise<UserRow | undefined> | UserRow | undefined;
  getUsersByCodes(userCodes: string[]): Promise<UserCodeRef[]> | UserCodeRef[];
  getUserById(id: number): Promise<UserRow | undefined> | UserRow | undefined;
  getAdminUser(): Promise<UserRow | undefined> | UserRow | undefined;
  updateUser(id: number, fields: UserUpdateFields): Promise<void> | void;
  deleteStudents(userCodes: string[]): Promise<number> | number;

  getStudents(): Promise<UserRow[]> | UserRow[];
  getStudentByCode(userCode: string): Promise<UserRow | undefined> | UserRow | undefined;

  // submissions
  upsertSubmission(userCode: string, tagsJson: string, avatarUrl: string, evaluationUrl: string, evaluationText: string | null, storageId: number): Promise<void> | void;
  /**
   * 已提交档案的学生分页列表（#295）：筛选 / 排序 / 分页**全部在数据库里完成**，
   * 因此跨页数据也能被搜到；`filters` 缺省时行为与改造前一致（按提交时间倒序、无过滤）。
   */
  getSubmittedProfiles(
    page: number,
    pageSize: number,
    filters?: SubmittedProfileFilters
  ): Promise<{ rows: UserRow[]; total: number }> | { rows: UserRow[]; total: number };
  getAllSubmitted(): Promise<UserRow[]> | UserRow[];
  clearSubmissions(userCodes: string[]): Promise<number> | number;

  // profile_submissions（档案提交历史版本，#95）
  insertProfileSubmission(userId: number, version: number, data: ProfileSubmissionData): Promise<number> | number;
  getMaxProfileSubmissionVersion(userId: number): Promise<number> | number;
  getProfileSubmissions(userId: number): Promise<ProfileSubmissionRow[]> | ProfileSubmissionRow[];
  getProfileSubmission(id: number): Promise<ProfileSubmissionRow | undefined> | ProfileSubmissionRow | undefined;
  deleteOldestProfileSubmissions(userId: number, count: number): Promise<number> | number;
  setCurrentProfileSubmission(versionId: number, userId: number): Promise<void> | void;
  getStudentsExceedingSubmissionLimit(
    maxVersions: number
  ): Promise<ProfileSubmissionExceedRow[]> | ProfileSubmissionExceedRow[];
  /** 按文件引用反查历史版本归属（#95）：当前档案已更新的快照文件只能在 profile_submissions 中找到 */
  getProfileSubmissionOwnerByFileUrl(
    url: string
  ): Promise<ProfileSubmissionFileOwner | undefined> | ProfileSubmissionFileOwner | undefined;
  /** 枚举全部被引用媒体文件（#118）：users 当前档案 + profile_submissions 历史快照，携带后端归属 */
  getAllReferencedMedia(): Promise<MediaFileRef[]> | MediaFileRef[];
  /** 高层事务函数：提交档案 + 生成版本快照 + 超限清理，原子完成 */
  submitProfileWithVersion(
    userCode: string,
    tagsJson: string,
    avatarUrl: string,
    evaluationUrl: string,
    evaluationText: string | null,
    storageId: number,
    /** 演示播种用：显式提交时间（与 getNow 同格式 `YYYY-MM-DD HH:mm:ss`）；生产提交省略→取当前 */
    submittedAt?: string
  ): Promise<{ version: number }> | { version: number };

  // stats
  getStats(): Promise<Stats> | Stats;
  getTrends(days: number): Promise<TrendPoint[]> | TrendPoint[];
  /** 按班级分层的趋势（#165）：按 classes.id 分组，未分班用内部哨兵键 */
  getTrendsByClass(days: number): Promise<ClassTrendSeries> | ClassTrendSeries;
  /** 按班级分组统计在册/已提交（#165）：与趋势同口径 */
  getCompareByClass(): Promise<CompareStat[]> | CompareStat[];
  /** 按班级身份取名册（#217）：classId 为 null 表示未分班，口径与 compare 的 NULL 分组一致 */
  getClassRoster(classId: number | null): Promise<ClassRosterRow[]> | ClassRosterRow[];

  // tags & classes
  getTags(): Promise<TagRow[]> | TagRow[];
  getActiveTags(): Promise<TagRow[]> | TagRow[];
  insertTag(tag: {
    name: string;
    type: "category" | "tag";
    parent_id?: number | null;
    category_order?: number;
    sort_order?: number;
  }): Promise<number> | number;
  updateTag(id: number, fields: {
    name?: string;
    parent_id?: number | null;
    category_order?: number;
    sort_order?: number;
  }): Promise<void> | void;
  /** 物理删除标签；分类会级联删除其下标签（#94：停用机制下线） */
  deleteTags(ids: number[]): Promise<void> | void;
  /** 重置为默认预设（标签管理页「恢复默认」，#94 补充） */
  resetTagsToDefaults(): Promise<void> | void;
  getClasses(): Promise<ClassRow[]> | ClassRow[];
  /** 按 id 取班级（#313：`class-roster?classId=` 用它回显班级名并区分「不存在」与「参数非法」） */
  getClassById(id: number): Promise<ClassRow | undefined> | ClassRow | undefined;
  getClassByName(name: string): Promise<ClassRow | undefined> | ClassRow | undefined;
  getClassByInviteCode(code: string): Promise<ClassRow | undefined> | ClassRow | undefined;
  insertClass(name: string, invitationCode: string): Promise<number> | number;
  updateClass(id: number, fields: { name?: string; invitation_code?: string }): Promise<void> | void;
  deleteClass(id: number): Promise<void> | void;
  insertTeacherClass(teacherId: number, classId: number): Promise<void> | void;
  getTeacherClassPairs(): Promise<TeacherClassRow[]> | TeacherClassRow[];

  // teachers
  getTeachers(): Promise<UserRow[]> | UserRow[];
  deleteTeacher(id: number): Promise<void> | void;
  /** 演示专用：按 id 删除单个用户行（无关联清理）。调用方须先校验角色与编号；生产删除仍用 deleteStudents / deleteTeacher */
  deleteUserById(id: number): Promise<void> | void;

  // configs_profile（档案功能配置，键值式）
  getProfileConfigs(): Promise<ConfigRow[]> | ConfigRow[];
  setProfileConfig(key: string, value: string): Promise<void> | void;

  // storage_backends（对象存储多后端注册表，#111）
  listStorageBackends(): Promise<StorageBackendRow[]> | StorageBackendRow[];
  getStorageBackend(id: number): Promise<StorageBackendRow | undefined> | StorageBackendRow | undefined;
  insertStorageBackend(backend: NewStorageBackend): Promise<number> | number;
  updateStorageBackend(id: number, fields: StorageBackendUpdateFields): Promise<void> | void;
  /** 删除保护（本地/默认/被引用不可删）由路由层校验，本方法直接删除 */
  deleteStorageBackend(id: number): Promise<void> | void;
  /** 事务：全部置 0 → 目标置 1，保证唯一默认 */
  setDefaultStorageBackend(id: number): Promise<void> | void;
  getDefaultStorageBackend(): Promise<StorageBackendRow | undefined> | StorageBackendRow | undefined;
  countUsersByStorageId(storageId: number): Promise<number> | number;
  getUsersByStorageId(storageId: number): Promise<UserRow[]> | UserRow[];
  updateUserStorageId(userId: number, storageId: number): Promise<void> | void;
  /** 迁移时原子更新文件引用：后端归属 + 两个文件 URL（本地代理路径 → 对象 key） */
  updateUserStorageRef(userId: number, storageId: number, avatarUrl: string | null, evaluationUrl: string | null): Promise<void> | void;

  // audit_logs（操作审计，#110：只追加 + 查询，不提供修改/删除）
  insertAuditLog(log: NewAuditLog): Promise<void> | void;
  queryAuditLogs(
    filters: AuditLogFilters
  ): Promise<{ rows: AuditLogRow[]; total: number }> | { rows: AuditLogRow[]; total: number };

  // grouping（#101：当前分组可写；历史批次只追加）
  /** 读某班当前分组的组（含空组） */
  getClassGroups(classId: number): Promise<ClassGroupRow[]> | ClassGroupRow[];
  /** 读某班当前分组的成员归属（与班级名单在路由层拼装，避免适配器做多表 join） */
  getClassGroupMembers(classId: number): Promise<ClassGroupMemberRow[]> | ClassGroupMemberRow[];
  /** 事务：整体覆盖某班当前分组（自动分组 / 导入 / 清空共用；空数组 = 清空） */
  replaceClassGrouping(classId: number, groups: ClassGroupingInput[]): Promise<void> | void;
  /** 建一个空组（组号由调用方给出，唯一约束保证不与既有冲突） */
  insertGroupEntry(classId: number, groupNo: number): Promise<void> | void;
  /** 删除一个空的组（非空由调用方先校验；本方法只删组行，不动成员） */
  deleteGroupEntry(classId: number, groupNo: number): Promise<void> | void;
  /** 把成员移到本班的另一个组（目标组必须已存在） */
  moveGroupMember(classId: number, userId: number, toGroupNo: number): Promise<void> | void;
  /** 事务：追加一个历史批次（头 + 组 + 成员），返回批次 id */
  insertGroupBatch(input: NewGroupBatchInput): Promise<number> | number;
  /**
   * 自动分组落库：**同一事务**内「覆盖当前分组 + 追加历史批次」。
   * 拆成两次调用会在中途失败时留下「当前已覆盖但没有归档」的不一致态。
   */
  applyGroupingResult(
    classId: number,
    groups: ClassGroupingInput[],
    batch: NewGroupBatchInput
  ): Promise<number> | number;
  /** 按班列历史批次（新→旧） */
  getGroupBatches(classId: number): Promise<GroupBatchRow[]> | GroupBatchRow[];
  /** 读批次明细（头 + 组 + 成员） */
  getGroupBatchDetail(
    batchId: number
  ):
    | Promise<{ batch: GroupBatchRow | undefined; groups: GroupBatchGroupRow[]; members: GroupBatchMemberRow[] }>
    | { batch: GroupBatchRow | undefined; groups: GroupBatchGroupRow[]; members: GroupBatchMemberRow[] };
  /** 学生端：本人当前所在的组（无分组或未入组返回 undefined） */
  getStudentGroupRef(
    userId: number
  ): Promise<{ class_id: number; group_no: number } | undefined> | { class_id: number; group_no: number } | undefined;
  /**
   * 两人是否同属一个「当前分组」的同一组（#101 同组头像放行判定）。
   * 单条查询比对 group_id，避免两次读之间落入原子重分组而读到跨批次的组号。
   */
  areStudentsInSameCurrentGroup(userIdA: number, userIdB: number): Promise<boolean> | boolean;

  // assessments / assessment_questions / assessment_results（#221 职业测评数据层）
  /** 启用中的测评定义（学生测评中心列表；按 id 稳定排序） */
  getEnabledAssessments(): Promise<AssessmentRow[]> | AssessmentRow[];
  /** 按 code 取测评定义（含未启用：后台维护要能读到，启用与否由调用方判定） */
  getAssessmentByCode(code: string): Promise<AssessmentRow | undefined> | AssessmentRow | undefined;
  /** 按测评 id 取题库，按题号升序 */
  getAssessmentQuestions(assessmentId: number): Promise<AssessmentQuestionRow[]> | AssessmentQuestionRow[];
  /** 按 code 取题库（作答页一次调用拿全量），按题号升序 */
  getAssessmentQuestionsByCode(code: string): Promise<AssessmentQuestionRow[]> | AssessmentQuestionRow[];
  /**
   * 题库**只增不改**升级（#281）：补齐缺失题号 → 已存在题号只回填 `origin`（绝不动 prompt/dimension）→
   * `scale_version` 与种子不一致时整体更新量表定义字段；落库前跑新版 `validateAssessmentSeed`；
   * 全程单事务，SQLite / MySQL 行为一致（`init()` 在 `seedAssessments()` 之后调用）。
   */
  upgradeAssessmentBank(): Promise<AssessmentBankUpgradeResult> | AssessmentBankUpgradeResult;
  /**
   * 草稿 upsert：同一 (user_id, assessment_id) 至多一条 `in_progress` 记录，返回该行 id。
   * 幂等——续答只覆盖作答内容与抽题快照，不新增行；唯一性由 `draft_slot` 唯一约束兜住（并发自动保存不会插出第二条）。
   * `itemsJson`（#282）：本轮抽题快照，第一次作答时随草稿写入（`GET /start` 仍不落库）。
   */
  upsertAssessmentDraft(
    userId: number,
    assessmentId: number,
    answersJson: string,
    itemsJson: string
  ): Promise<number> | number;
  /** 读草稿（续答）；没有草稿返回 undefined */
  getAssessmentDraft(userId: number, assessmentId: number): Promise<AssessmentResultRow | undefined> | AssessmentResultRow | undefined;
  /**
   * 写完成结果：有草稿则沿用该行翻成 `completed`（保留 `started_at` 并释放草稿位），否则新插入；
   * 同一事务内把该用户该量表其他完成版本的 `is_current` 置 0，保证当前版本唯一。
   * @returns 写入（或沿用）的结果行 id
   */
  completeAssessmentResult(input: CompleteAssessmentInput): Promise<number> | number;
  /** 当前有效的完成结果（`is_current=1`）；未完成过返回 undefined */
  getCurrentAssessmentResult(
    userId: number,
    assessmentId: number
  ): Promise<AssessmentResultRow | undefined> | AssessmentResultRow | undefined;
  /** 完成记录历史（新→旧，不含草稿），供结果页回看与版本对比 */
  getAssessmentResults(userId: number, assessmentId: number): Promise<AssessmentResultRow[]> | AssessmentResultRow[];
  /**
   * 按学号集合批量取「当前有效完成结果」的轻量快照（#233 教师导出 / #234 数据列表共用）：
   * 一次查询（适配器内部分块），未测评的学号不会出现在结果里，由调用方按缺失留空。
   */
  getCurrentAssessmentResultsByUserCodes(
    assessmentId: number,
    userCodes: string[]
  ): Promise<AssessmentResultSummary[]> | AssessmentResultSummary[];

  // onet_occupations（#226 O*NET 职业库：离线导入的只读参考数据）
  /** 全部职业（按 code 升序）。匹配在内存里做（余弦），一次读全量比逐条查省事且结果稳定 */
  getOnetOccupations(): Promise<OnetOccupationRow[]> | OnetOccupationRow[];

  // 教师端测评统计（#229）
  /**
   * 测评聚合计数（**不含个人信息**）：班级完成度、六型计数、三字码计数与总计。
   * `classIds = null` 为全校口径；传集合则只统计这些班级（教师「只看我的班」）。
   * `classId` 再把整个聚合范围收窄到单班（#311）。
   */
  getAssessmentStats(
    assessmentId: number,
    classIds: number[] | null,
    classId?: number
  ): Promise<AssessmentStatsRaw> | AssessmentStatsRaw;
  /**
   * 班级完成矩阵原始计数（#310）：档案提交 + 各量表完成人数，按 `class_id` 分组。
   * `assessmentIds` 为空时只返回档案列；`classIds = null` 为全校口径（含未分班），
   * 传集合则只统计这些班级（教师「只看我的班」）。不含任何姓名/学号。
   */
  getCompletionStats(
    assessmentIds: number[],
    classIds: number[] | null
  ): Promise<CompletionStatsRaw> | CompletionStatsRaw;
  /**
   * dimensional 量表逐人结果快照（#312）：`completed + is_current` 的学生各一行，
   * 只返回 `user_id / scores_json / completed_at`，班级范围按 `classIds` 收窄
   * （`null` = 全校，空集合直接返回空数组）。解析与三档归并统一在纯函数里做。
   */
  getDimensionalResultScores(
    assessmentId: number,
    classIds: number[] | null
  ): Promise<DimensionalResultScoreRow[]> | DimensionalResultScoreRow[];
  /**
   * 测评名册（**含姓名/学号，读取须记审计**）：只返回已完成且当前有效的结果。
   * `classIds` 收窄班级范围（教师归属班级），`filters.classId` 再收窄到单班，
   * `filters.lead` 按三字码首位过滤，`filters.code` 按完整三字码精确过滤（#232 三字码胶囊下钻）。
   * `filters.includeScores` 额外取回结果快照（#313：dimensional 量表据此算档位），默认不取。
   */
  getAssessmentRoster(
    assessmentId: number,
    classIds: number[] | null,
    filters?: {
      classId?: number | null;
      lead?: string | null;
      code?: string | null;
      includeScores?: boolean;
    }
  ): Promise<AssessmentRosterRow[]> | AssessmentRosterRow[];
  /**
   * 未完成名册（#313）：在册学生里**不存在**该量表 `completed + is_current` 记录的人，含只有草稿的学生。
   * 主查询以 `users` 为基准 + `NOT EXISTS` 子查询——不能改成 LEFT JOIN 结果表判 NULL，否则草稿会被当成已完成。
   */
  getAssessmentMissingRoster(
    assessmentId: number,
    classIds: number[] | null,
    filters?: { classId?: number | null }
  ): Promise<AssessmentMissingRosterRow[]> | AssessmentMissingRosterRow[];

  backup(): Promise<BackupData> | BackupData;
  restore(data: BackupData): Promise<void> | void;
  close(): Promise<void> | void;
}

/** 生成随机邀请码（排除易混淆字符） */
export function randomInviteCode(len = 8): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < len; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

/**
 * 量表 code 归一化（#221）：SQLite 的 `=` 对 TEXT 区分大小写、MySQL 的默认 collation 不区分，
 * 直接在 SQL 里比会让两适配器行为分叉（#191 同类教训）。归一化放在边界（写入的种子本身即小写），
 * 两侧都用它查，行为恒等。
 */
export function normalizeAssessmentCode(code: string): string {
  return code.trim().toLowerCase();
}

let currentAdapter: DbAdapter | null = null;
let currentType: string = "";
let initPromise: Promise<void> | null = null;

// 演示库 adapter 使用独立的 memo 槽，避免与生产 adapter 在 createAdapter() 的
// 「切换即关闭旧 adapter」逻辑里相互 thrash（两者可能在同一进程内并存）。
let demoAdapter: DbAdapter | null = null;
let demoType: string = "";
let demoInitPromise: Promise<void> | null = null;

function createAdapter(): DbAdapter {
  const config = getConfig();
  const dbType = config.type || "mysql";
  const configKey = dbType === "sqlite"
    ? `sqlite:${config.sqlite?.path || "./data/career.db"}`
    : `mysql:${JSON.stringify(config.mysql)}`;

  if (currentAdapter && currentType === configKey) return currentAdapter;

  if (currentAdapter) {
    try {
      const c = currentAdapter.close();
      if (c instanceof Promise) c.catch(() => {});
    } catch {}
  }

  const adapter = dbType === "sqlite"
    ? new SqliteAdapter(config.sqlite?.path || "./data/career.db")
    : new MysqlAdapter(config.mysql);
  currentAdapter = adapter;
  currentType = configKey;
  initPromise = Promise.resolve(adapter.init());
  initPromise.catch(() => {});
  return adapter;
}

/**
 * 演示库 adapter：始终为独立 SQLite 文件（与生产库类型无关，经用户决策采用物理隔离）。
 * 仅在演示作用域内被调用；`DEMO_ENABLED` 关闭时抛错——fail-safe，绝不回落到生产库。
 */
function getDemoAdapter(): DbAdapter {
  if (!isDemoEnabled()) {
    throw new Error("演示模式未启用（DEMO_ENABLED != true），拒绝访问演示库");
  }
  const demoPath = getDemoDbPath();
  const configKey = `sqlite:${demoPath}`;

  if (demoAdapter && demoType === configKey) return demoAdapter;

  if (demoAdapter) {
    try {
      const c = demoAdapter.close();
      if (c instanceof Promise) c.catch(() => {});
    } catch (err) {
      console.error("关闭旧演示 adapter 失败:", err);
    }
  }

  const adapter = new SqliteAdapter(demoPath);
  demoAdapter = adapter;
  demoType = configKey;
  demoInitPromise = Promise.resolve(adapter.init());
  demoInitPromise.catch((err) => {
    console.error("演示库初始化失败（后续请求将 await 到同一 rejected promise 并抛 500）:", err);
  });
  return adapter;
}

async function ensureInit(): Promise<DbAdapter> {
  if (isDemoScope()) {
    const adapter = getDemoAdapter();
    if (demoInitPromise) await demoInitPromise;
    return adapter;
  }
  const adapter = createAdapter();
  if (initPromise) await initPromise;
  return adapter;
}

export async function insertUser(user: NewUser): Promise<number> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.insertUser(user));
}

export async function getUserByCode(userCode: string): Promise<UserRow | undefined> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getUserByCode(userCode));
}

/** 按学号集合批查（#193 批量导入）：避免逐行查库；适配器内部分块，调用方无需限制入参长度。只返回标识与班级归属 */
export async function getUsersByCodes(userCodes: string[]): Promise<UserCodeRef[]> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getUsersByCodes(userCodes));
}

export async function getUserById(id: number): Promise<UserRow | undefined> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getUserById(id));
}

export async function getAdminUser(): Promise<UserRow | undefined> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getAdminUser());
}

export async function updateUser(id: number, fields: UserUpdateFields): Promise<void> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.updateUser(id, fields));
}

export async function deleteStudents(userCodes: string[]): Promise<number> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.deleteStudents(userCodes));
}

export async function getStudents(): Promise<UserRow[]> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getStudents());
}

export async function getStudentByCode(userCode: string): Promise<UserRow | undefined> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getStudentByCode(userCode));
}

export async function upsertSubmission(userCode: string, tagsJson: string, avatarUrl: string, evaluationUrl: string, evaluationText: string | null, storageId: number): Promise<void> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.upsertSubmission(userCode, tagsJson, avatarUrl, evaluationUrl, evaluationText, storageId));
}

export async function getSubmittedProfiles(
  page: number = 1,
  pageSize: number = 20,
  filters?: SubmittedProfileFilters
): Promise<{ rows: UserRow[]; total: number }> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getSubmittedProfiles(page, pageSize, filters));
}

export async function getAllSubmitted(): Promise<UserRow[]> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getAllSubmitted());
}

export async function clearSubmissions(userCodes: string[]): Promise<number> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.clearSubmissions(userCodes));
}

export async function insertProfileSubmission(userId: number, version: number, data: ProfileSubmissionData): Promise<number> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.insertProfileSubmission(userId, version, data));
}

export async function getMaxProfileSubmissionVersion(userId: number): Promise<number> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getMaxProfileSubmissionVersion(userId));
}

export async function getProfileSubmissions(userId: number): Promise<ProfileSubmissionRow[]> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getProfileSubmissions(userId));
}

export async function getProfileSubmission(id: number): Promise<ProfileSubmissionRow | undefined> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getProfileSubmission(id));
}

export async function deleteOldestProfileSubmissions(userId: number, count: number): Promise<number> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.deleteOldestProfileSubmissions(userId, count));
}

export async function setCurrentProfileSubmission(versionId: number, userId: number): Promise<void> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.setCurrentProfileSubmission(versionId, userId));
}

export async function getStudentsExceedingSubmissionLimit(
  maxVersions: number
): Promise<ProfileSubmissionExceedRow[]> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getStudentsExceedingSubmissionLimit(maxVersions));
}

export async function getProfileSubmissionOwnerByFileUrl(
  url: string
): Promise<ProfileSubmissionFileOwner | undefined> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getProfileSubmissionOwnerByFileUrl(url));
}

export async function getAllReferencedMedia(): Promise<MediaFileRef[]> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getAllReferencedMedia());
}

export async function submitProfileWithVersion(
  userCode: string,
  tagsJson: string,
  avatarUrl: string,
  evaluationUrl: string,
  evaluationText: string | null,
  storageId: number,
  submittedAt?: string
): Promise<{ version: number }> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.submitProfileWithVersion(userCode, tagsJson, avatarUrl, evaluationUrl, evaluationText, storageId, submittedAt));
}

export async function getStats(): Promise<Stats> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getStats());
}

export async function getTrends(days: number): Promise<TrendPoint[]> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getTrends(days));
}

export async function getTrendsByClass(days: number): Promise<ClassTrendSeries> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getTrendsByClass(days));
}

export async function getCompareByClass(): Promise<CompareStat[]> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getCompareByClass());
}

export async function getClassRoster(classId: number | null): Promise<ClassRosterRow[]> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getClassRoster(classId));
}

export async function getTags(): Promise<TagRow[]> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getTags());
}

export async function getActiveTags(): Promise<TagRow[]> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getActiveTags());
}

export async function insertTag(tag: {
  name: string;
  type: "category" | "tag";
  parent_id?: number | null;
  category_order?: number;
  sort_order?: number;
}): Promise<number> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.insertTag(tag));
}

export async function updateTag(id: number, fields: {
  name?: string;
  parent_id?: number | null;
  category_order?: number;
  sort_order?: number;
}): Promise<void> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.updateTag(id, fields));
}

export async function deleteTags(ids: number[]): Promise<void> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.deleteTags(ids));
}

export async function resetTagsToDefaults(): Promise<void> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.resetTagsToDefaults());
}

export async function getClasses(): Promise<ClassRow[]> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getClasses());
}

export async function getClassByName(name: string): Promise<ClassRow | undefined> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getClassByName(name));
}

/** #313：按 id 取班级（`class-roster?classId=` 回显班级名并区分「不存在」与「参数非法」） */
export async function getClassById(id: number): Promise<ClassRow | undefined> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getClassById(id));
}

export async function getClassByInviteCode(code: string): Promise<ClassRow | undefined> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getClassByInviteCode(code));
}

export async function insertClass(name: string, invitationCode: string): Promise<number> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.insertClass(name, invitationCode));
}

export async function updateClass(id: number, fields: { name?: string; invitation_code?: string }): Promise<void> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.updateClass(id, fields));
}

export async function deleteClass(id: number): Promise<void> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.deleteClass(id));
}

export async function insertTeacherClass(teacherId: number, classId: number): Promise<void> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.insertTeacherClass(teacherId, classId));
}

export async function getTeacherClassPairs(): Promise<TeacherClassRow[]> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getTeacherClassPairs());
}

export async function getTeachers(): Promise<UserRow[]> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getTeachers());
}

export async function deleteTeacher(id: number): Promise<void> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.deleteTeacher(id));
}

/** 演示专用：删除单个用户行（无关联清理）。调用方须先校验角色与编号 */
export async function deleteUserById(id: number): Promise<void> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.deleteUserById(id));
}

export async function getProfileConfigs(): Promise<ConfigRow[]> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getProfileConfigs());
}

export async function setProfileConfig(key: string, value: string): Promise<void> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.setProfileConfig(key, value));
}

export async function listStorageBackends(): Promise<StorageBackendRow[]> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.listStorageBackends());
}

export async function getStorageBackend(id: number): Promise<StorageBackendRow | undefined> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getStorageBackend(id));
}

export async function insertStorageBackend(backend: NewStorageBackend): Promise<number> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.insertStorageBackend(backend));
}

export async function updateStorageBackend(id: number, fields: StorageBackendUpdateFields): Promise<void> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.updateStorageBackend(id, fields));
}

export async function deleteStorageBackend(id: number): Promise<void> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.deleteStorageBackend(id));
}

export async function setDefaultStorageBackend(id: number): Promise<void> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.setDefaultStorageBackend(id));
}

export async function getDefaultStorageBackend(): Promise<StorageBackendRow | undefined> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getDefaultStorageBackend());
}

export async function countUsersByStorageId(storageId: number): Promise<number> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.countUsersByStorageId(storageId));
}

export async function getUsersByStorageId(storageId: number): Promise<UserRow[]> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getUsersByStorageId(storageId));
}

export async function updateUserStorageId(userId: number, storageId: number): Promise<void> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.updateUserStorageId(userId, storageId));
}

export async function updateUserStorageRef(userId: number, storageId: number, avatarUrl: string | null, evaluationUrl: string | null): Promise<void> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.updateUserStorageRef(userId, storageId, avatarUrl, evaluationUrl));
}

export async function insertAuditLog(log: NewAuditLog): Promise<void> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.insertAuditLog(log));
}

export async function queryAuditLogs(
  filters: AuditLogFilters
): Promise<{ rows: AuditLogRow[]; total: number }> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.queryAuditLogs(filters));
}

/** 读取上传大小上限（#111）；配置缺失或非法时回退默认值，合法范围 1–20 由路由层写入时校验 */
async function getSizeLimitMb(key: string, fallback: number): Promise<number> {
  const configs = await getProfileConfigs();
  const raw = configs.find((c) => c.key === key)?.value;
  const parsed = raw === undefined ? NaN : Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 20 ? parsed : fallback;
}

export async function getMaxAvatarSizeMb(): Promise<number> {
  return getSizeLimitMb(MAX_AVATAR_SIZE_KEY, DEFAULT_MAX_AVATAR_SIZE_MB);
}

export async function getMaxEvaluationSizeMb(): Promise<number> {
  return getSizeLimitMb(MAX_EVALUATION_SIZE_KEY, DEFAULT_MAX_EVALUATION_SIZE_MB);
}

/** 读取自定义标签数量上限；配置缺失或非法时回退默认值 */
export async function getMaxCustomTags(): Promise<number> {
  const configs = await getProfileConfigs();
  const raw = configs.find((c) => c.key === "max_custom_tags")?.value;
  const parsed = raw === undefined ? NaN : Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_CUSTOM_TAGS;
}

/** 读取档案提交历史版本上限（#95）；配置缺失或非法时回退默认值，合法范围 1–100 由路由层写入时校验 */
export async function getMaxProfileSubmissions(): Promise<number> {
  const configs = await getProfileConfigs();
  const raw = configs.find((c) => c.key === MAX_PROFILE_SUBMISSIONS_KEY)?.value;
  const parsed = raw === undefined ? NaN : Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 100 ? parsed : DEFAULT_MAX_PROFILE_SUBMISSIONS;
}

/** 读取孤儿文件保留期（#117）；配置缺失或非法时回退默认值，合法范围 1–365 由路由层写入时校验 */
export async function getMediaOrphanRetentionDays(): Promise<number> {
  const configs = await getProfileConfigs();
  const raw = configs.find((c) => c.key === MEDIA_ORPHAN_RETENTION_KEY)?.value;
  const parsed = raw === undefined ? NaN : Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 365 ? parsed : DEFAULT_MEDIA_ORPHAN_RETENTION_DAYS;
}

/** 提交时限配置键（#96）：存储格式 `YYYY-MM-DD HH:mm`（Asia/Shanghai），空串表示不限制 */
export const SUBMISSION_DEADLINE_KEY = "submission_deadline";

/** 读取档案提交截止时间；未设置（缺失或空串）返回 null（不限制） */
export async function getSubmissionDeadline(): Promise<string | null> {
  const configs = await getProfileConfigs();
  const raw = configs.find((c) => c.key === SUBMISSION_DEADLINE_KEY)?.value;
  return raw && raw.trim().length > 0 ? raw.trim() : null;
}

/** 纯函数：定宽格式 `YYYY-MM-DD HH:mm` 字典序即时间序，便于单测 */
export function isAfterDeadline(nowMinute: string, deadline: string): boolean {
  return nowMinute >= deadline.slice(0, 16);
}

/** 判断当前时刻（Asia/Shanghai，与 getNow 同源）是否已超过提交截止时间；未设置返回 false */
export async function isSubmissionClosed(): Promise<boolean> {
  const deadline = await getSubmissionDeadline();
  if (!deadline) return false;
  // 服务端统一按 Asia/Shanghai 计算，不依赖客户端时钟
  const now = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).slice(0, 16);
  return isAfterDeadline(now, deadline);
}

/* ---------- 分组（#101） ---------- */

export async function getClassGroups(classId: number): Promise<ClassGroupRow[]> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getClassGroups(classId));
}

export async function getClassGroupMembers(classId: number): Promise<ClassGroupMemberRow[]> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getClassGroupMembers(classId));
}

export async function replaceClassGrouping(classId: number, groups: ClassGroupingInput[]): Promise<void> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.replaceClassGrouping(classId, groups));
}

export async function insertGroupEntry(classId: number, groupNo: number): Promise<void> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.insertGroupEntry(classId, groupNo));
}

export async function deleteGroupEntry(classId: number, groupNo: number): Promise<void> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.deleteGroupEntry(classId, groupNo));
}

export async function moveGroupMember(classId: number, userId: number, toGroupNo: number): Promise<void> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.moveGroupMember(classId, userId, toGroupNo));
}

export async function insertGroupBatch(input: NewGroupBatchInput): Promise<number> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.insertGroupBatch(input));
}

export async function applyGroupingResult(
  classId: number,
  groups: ClassGroupingInput[],
  batch: NewGroupBatchInput
): Promise<number> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.applyGroupingResult(classId, groups, batch));
}

export async function getGroupBatches(classId: number): Promise<GroupBatchRow[]> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getGroupBatches(classId));
}

export async function getGroupBatchDetail(batchId: number): Promise<{
  batch: GroupBatchRow | undefined;
  groups: GroupBatchGroupRow[];
  members: GroupBatchMemberRow[];
}> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getGroupBatchDetail(batchId));
}

export async function getStudentGroupRef(
  userId: number
): Promise<{ class_id: number; group_no: number } | undefined> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getStudentGroupRef(userId));
}

export async function areStudentsInSameCurrentGroup(
  userIdA: number,
  userIdB: number
): Promise<boolean> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.areStudentsInSameCurrentGroup(userIdA, userIdB));
}

/* ---------- 职业测评（#221） ---------- */

export async function getEnabledAssessments(): Promise<AssessmentRow[]> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getEnabledAssessments());
}

export async function getAssessmentByCode(code: string): Promise<AssessmentRow | undefined> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getAssessmentByCode(code));
}

export async function getAssessmentQuestions(assessmentId: number): Promise<AssessmentQuestionRow[]> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getAssessmentQuestions(assessmentId));
}

export async function getAssessmentQuestionsByCode(code: string): Promise<AssessmentQuestionRow[]> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getAssessmentQuestionsByCode(code));
}

/** #281：题库只增不改升级（通常由 `init()` 自动调用；导出供迁移脚本/测试显式触发） */
export async function upgradeAssessmentBank(): Promise<AssessmentBankUpgradeResult> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.upgradeAssessmentBank());
}

export async function upsertAssessmentDraft(
  userId: number,
  assessmentId: number,
  answersJson: string,
  itemsJson: string
): Promise<number> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.upsertAssessmentDraft(userId, assessmentId, answersJson, itemsJson));
}

export async function getAssessmentDraft(
  userId: number,
  assessmentId: number
): Promise<AssessmentResultRow | undefined> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getAssessmentDraft(userId, assessmentId));
}

export async function completeAssessmentResult(input: CompleteAssessmentInput): Promise<number> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.completeAssessmentResult(input));
}

export async function getCurrentAssessmentResult(
  userId: number,
  assessmentId: number
): Promise<AssessmentResultRow | undefined> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getCurrentAssessmentResult(userId, assessmentId));
}

export async function getAssessmentResults(
  userId: number,
  assessmentId: number
): Promise<AssessmentResultRow[]> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getAssessmentResults(userId, assessmentId));
}

/** 按学号集合批量取当前测评结果快照（#233 教师导出 / #234 数据列表：一次查询） */
export async function getCurrentAssessmentResultsByUserCodes(
  assessmentId: number,
  userCodes: string[]
): Promise<AssessmentResultSummary[]> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getCurrentAssessmentResultsByUserCodes(assessmentId, userCodes));
}

/** #226：O*NET 职业库全量（按 code 升序），推荐接口在内存里做余弦匹配 */
export async function getOnetOccupations(): Promise<OnetOccupationRow[]> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getOnetOccupations());
}

/** #229：教师端测评聚合计数（不含个人信息） */
export async function getAssessmentStats(
  assessmentId: number,
  classIds: number[] | null,
  classId?: number
): Promise<AssessmentStatsRaw> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getAssessmentStats(assessmentId, classIds, classId));
}

/** #310：班级完成矩阵原始计数（档案提交 + 多量表完成人数，不含个人信息） */
export async function getCompletionStats(
  assessmentIds: number[],
  classIds: number[] | null
): Promise<CompletionStatsRaw> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getCompletionStats(assessmentIds, classIds));
}

/** #312：dimensional 量表逐人结果快照（不含身份字段，解析在纯函数） */
export async function getDimensionalResultScores(
  assessmentId: number,
  classIds: number[] | null
): Promise<DimensionalResultScoreRow[]> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getDimensionalResultScores(assessmentId, classIds));
}

/** #229：教师端测评名册（含个人信息，调用方必须记审计并先收窄班级范围） */
export async function getAssessmentRoster(
  assessmentId: number,
  classIds: number[] | null,
  filters?: {
    classId?: number | null;
    lead?: string | null;
    code?: string | null;
    includeScores?: boolean;
  }
): Promise<AssessmentRosterRow[]> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getAssessmentRoster(assessmentId, classIds, filters));
}

/** #313：未完成名册（含个人信息，调用方必须记审计并先收窄班级范围） */
export async function getAssessmentMissingRoster(
  assessmentId: number,
  classIds: number[] | null,
  filters?: { classId?: number | null }
): Promise<AssessmentMissingRosterRow[]> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getAssessmentMissingRoster(assessmentId, classIds, filters));
}

export async function backup(): Promise<BackupData> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.backup());
}

export async function restore(data: BackupData): Promise<void> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.restore(data));
}

export async function closeDb(): Promise<void> {
  if (currentAdapter) {
    await Promise.resolve(currentAdapter.close());
    currentAdapter = null;
    currentType = "";
  }
}

/**
 * 关闭并清空演示 adapter 的 memo 槽。仅供演示库重置流程显式调用——刻意不与 `closeDb()`
 * 合一：`closeDb()` 的既有语义是「生产数据源配置变更，丢弃旧生产 adapter」（settings PUT
 * fire-and-forget 调用），若让它作用域敏感，演示 admin 调 settings 会误关演示 adapter、
 * 生产 adapter 反带旧配置常驻。故作用域归作用域、关闭各自显式。
 */
export async function closeDemoDb(): Promise<void> {
  if (demoAdapter) {
    await Promise.resolve(demoAdapter.close());
    demoAdapter = null;
    demoType = "";
    demoInitPromise = null;
  }
}
