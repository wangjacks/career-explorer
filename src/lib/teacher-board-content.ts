/**
 * 教师端「怎么看这份数据」说明层的长文案（#315）。
 *
 * 为什么单独一层：抽屉三 Tab 的正文（怎么读三字码、三档阈值、课堂上怎么用、不要怎么用）
 * 与卡片上的短标签不是一类东西——短标签进 `TEACHER_BOARD_COPY`，长段落放这里，
 * 组件只负责排版。六型与五项的**科普正文不在此复制**：直接复用学生端已合并的
 * `assessment-center-content.ts`（`RIASEC_INTRO` / `BIG_FIVE_INTRO`），教师版只补
 * 「第一线怎么用」与「别怎么用」的增量说明。
 *
 * 禁词与教师侧文案表一致（不出现「在册 / 口径 / 提交率 / 已提交 / 未提交 / 还差 /
 * 维度 / 学生名单 / 全校 / 全班 / 本班」…），也不出现任何商业量表名与诊断式表述。
 */

import type { BigFiveKey } from "./assessment-center-content";
import type { RiasecKey } from "./assessment-match";

export interface TeacherBoardHowTo {
  title: string;
  body: string;
}

export interface TeacherBoardContent {
  /** 「怎么用」Tab 的三条主线 */
  howTo: readonly TeacherBoardHowTo[];
  /** 可以这样和学生聊（不点名、不贴标签的开放式提问） */
  conversationStarters: readonly string[];
  /** 「不要这样用」的琥珀提示 */
  misuseWarning: string;
  /** 三字码的读法（SIA 为例） */
  codeHowTo: { title: string; body: string };
  /** 六型在课堂上的一句话落点（按型） */
  riasecClassroom: Readonly<Record<RiasecKey, string>>;
  /** 五项三档阈值，以及与学生端 50 分中线口径的差异说明 */
  bigFiveBandNote: string;
  /** 教师界面里五项的叫法：N 换成不带诊断味的说法，其余保留学生端口径 */
  bigFiveTeacherLabels: Readonly<Record<BigFiveKey, string>>;
  /** E/A/C 同名不同义的显式警告（#315 硬约束） */
  crossScaleWarning: string;
  /** 抽屉页脚的合规声明 */
  footerDisclaimer: string;
}

/** 五项在教师页上的显示名：`N` 说「情绪敏感度」，其余与量表定义一致 */
export const BIG_FIVE_TEACHER_LABELS: Readonly<Record<BigFiveKey, string>> = {
  N: "情绪敏感度（神经质 N）",
  E: "外向性（E）",
  O: "开放性（O）",
  A: "宜人性（A）",
  C: "尽责性（C）",
};

/** 取教师侧的五项显示名；未知 key 回退接口下发的正式标签，不抛错 */
export function bigFiveTeacherLabel(key: string, fallback: string): string {
  return BIG_FIVE_TEACHER_LABELS[key as BigFiveKey] ?? fallback;
}

export const TEACHER_BOARD_CONTENT: TeacherBoardContent = {
  howTo: [
    {
      title: "先看完成度",
      body: "样本少于 5 人时先别解读结构；先看谁还没做、哪个班需要提醒，做完的人多了结构才有参考价值。",
    },
    {
      title: "两边一起看",
      body: "兴趣回答「愿不愿意做」，性格回答「习惯怎么做」；两边互相补充，不做因果推断。",
    },
    {
      title: "用在教学上",
      body: "谈话、分组、任务设计都可以用；不用于评价、分档、贴标签。结果不是诊断。",
    },
  ],
  conversationStarters: [
    "最近做什么事的时候，你觉得时间过得特别快？",
    "小组合作时，你更常做哪一部分？",
    "什么情况下你更容易紧张？那时候你希望别人怎么配合？",
  ],
  misuseWarning:
    "不要这样用：不要当着学生念分数；不要用「你就是 X 型」定义学生；不要把结果作为评优、分班或家长会的结论。",
  codeHowTo: {
    title: "三字码怎么读？以 SIA 为例",
    body: "第一位最重要，后两位是补充；三字码是兴趣组合，不是能力排名，也不用它来分档。",
  },
  riasecClassroom: {
    R: "多安排动手、户外、看得到结果的活动，比如实验、制作、维修、实地观察。",
    I: "给一个问题链或小课题，让他自己查资料、把原理讲清楚。",
    A: "开放作品、设计、写作与表达的机会，会让他更投入。",
    S: "小组互助、同伴讲解、服务性任务更容易调动他。",
    E: "项目负责、辩论、路演这类能推动事情的角色更合适。",
    C: "流程、清单、核对、归档这类条理清晰的任务更顺手。",
  },
  bigFiveBandNote:
    "班级分布用三档：低 <33、中 33–67、高 ≥67。学生本人看到的是按 50 分中线的偏高 / 偏低描述——两者都是常规做法，不必互相校正；学生那边保持原样。",
  bigFiveTeacherLabels: BIG_FIVE_TEACHER_LABELS,
  crossScaleWarning:
    "别把两套字母混在一起：霍兰德的 E / A / C 是兴趣类型，大五的 E / A / C 是性格方面——企业型 ≠ 外向性，艺术型 ≠ 宜人性，常规型 ≠ 尽责性。它们可能相关，但不是一回事。",
  footerDisclaimer: "结果用于生涯探索与教学参考，不构成心理诊断，也不作为评价学生的依据。",
};
