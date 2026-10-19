/**
 * 测评中心的内容卡文案（#225）：RIASEC 六型科普、作答提示、权威渠道外链。
 *
 * 为什么把文案放在 lib 而不是组件里：
 * - 内容卡是纯展示，真正会变的是文案与链接，抽成常量后可以直接单测「六型齐全、顺序正确、
 *   链接只走 https + 授权页可点」这类不变量（仓库无 DOM 测试环境，界面逻辑先落数据层）；
 * - 与商业量表的版权边界写在这里：只做**自建通俗介绍**，不复述 SDS / Strong / MBTI 等
 *   受版权或商标保护的题面与解释文本（口径见 `docs/plan-assessment.md` 第 2 节）。
 *
 * 六型介绍参考的是 O*NET 官方对 RIASEC 六类的公开描述，用初中生也能读懂的话重写；
 * 完整授权/署名文案不在这里——那份是数据（存在 `assessments` 表授权字段，随接口下发）。
 */
import type { RiasecKey } from "./assessment-match";

export interface RiasecIntro {
  key: RiasecKey;
  /** 中文类型名 */
  label: string;
  /** 英文原名（与 O*NET 的 Realistic / Investigative … 对应，便于学生对照外部资料） */
  english: string;
  /** 一段通俗介绍：讲「这类人通常喜欢做什么」，不下结论、不做人格判断 */
  summary: string;
  /** 2–3 个关键词，页面上做成小标签，方便快速扫读 */
  keywords: string[];
}

/** 六型科普文案：顺序固定 R → I → A → S → E → C（与三字码权重顺序一致，单测会锁） */
export const RIASEC_INTRO: readonly RiasecIntro[] = [
  {
    key: "R",
    label: "现实型",
    english: "Realistic",
    summary:
      "更喜欢和「东西」打交道：动手拆装、操作设备、户外作业，看到实实在在的成果会更有成就感。",
    keywords: ["动手操作", "工具设备", "户外作业"],
  },
  {
    key: "I",
    label: "研究型",
    english: "Investigative",
    summary:
      "好奇心驱动：喜欢观察、提问、分析原因，愿意查资料做实验，把复杂的问题一点点想明白。",
    keywords: ["探究原理", "分析推理", "实验研究"],
  },
  {
    key: "A",
    label: "艺术型",
    english: "Artistic",
    summary:
      "喜欢自由表达与创作：文字、图像、音乐、设计，比起标准答案更在意自己的想法和风格。",
    keywords: ["创意表达", "审美设计", "自由发挥"],
  },
  {
    key: "S",
    label: "社会型",
    english: "Social",
    summary: "喜欢和人打交道：愿意倾听、帮助和教导别人，在合作与服务里更容易获得能量。",
    keywords: ["沟通协作", "帮助他人", "教学服务"],
  },
  {
    key: "E",
    label: "企业型",
    english: "Enterprising",
    summary:
      "喜欢推动事情发生：组织、说服、做决定、带团队，愿意为目标争取资源和结果。",
    keywords: ["组织推动", "说服影响", "带领团队"],
  },
  {
    key: "C",
    label: "常规型",
    english: "Conventional",
    summary: "喜欢清楚、有序的工作：整理数据、按流程办事，把细节做准做稳会很有安全感。",
    keywords: ["条理清晰", "数据处理", "按流程办事"],
  },
];

/** 作答提示（状态卡之外的一小段说明，打消「答案有没有对错」的顾虑） */
export const ASSESSMENT_TIPS: readonly string[] = [
  "题目问的是「你愿不愿意做这类事」，没有对错，按第一感觉选就好。",
  "每题作答后立即保存；中途关掉页面，下次进来会从上次的题继续。",
  "提交后立刻生成三字码与六型兴趣得分，结果只用于职业兴趣探索参考。",
];

export interface HelpLink {
  id: string;
  title: string;
  description: string;
  /** 必须是 https 外链（单测锁死协议，避免 http 混合内容与站内路由混用） */
  href: string;
  /** 渠道署名：告诉学生「这是谁家的入口」，比单纯一个链接更可信 */
  source: string;
}

/**
 * 权威渠道外链：学职平台（教育部学信网 / 「全国大学生学业与职业发展平台」）。
 * 只做外链推荐、不复刻其题目（内容版权归平台，口径见 `docs/plan-assessment.md` 第 2 节）。
 */
export const ASSESSMENT_HELP_LINKS: readonly HelpLink[] = [
  {
    id: "xz-survey",
    title: "职业兴趣测评",
    description: "学职平台的免费测评入口，除职业兴趣外还有职业价值观、批判性思维等测评。",
    href: "https://xz.chsi.com.cn/survey/index.action",
    source: "教育部学信网 · 学职平台",
  },
  {
    id: "xz-occupation",
    title: "职业探索",
    description: "按职业检索岗位信息与能力要求，看看不同职业每天到底在做什么。",
    href: "https://xz.chsi.com.cn/occupation/index.action",
    source: "教育部学信网 · 学职平台",
  },
  {
    id: "xz-home",
    title: "学职平台首页",
    description: "全国大学生学业与职业发展平台，测评、职业信息与成长资源都在这里。",
    href: "https://xz.chsi.com.cn/",
    source: "教育部学信网",
  },
];

/** 外链统一 rel：`_blank` + `noopener`（防新标签页拿 `window.opener` 反向控制本页） */
export const EXTERNAL_LINK_REL = "noopener noreferrer";

/** O*NET Tools Developer License 授权页：结果区与测评中心的署名都要能点回原文 */
export const ONET_TOOLS_LICENSE_URL = "https://www.onetcenter.org/license_tools.html";

/**
 * 免责声明兜底文案：正常情况下用 `assessments` 表下发的 `disclaimer`（唯一权威在库里），
 * 这里只在「接口没起来 / 量表不存在」的空态下补一句，保证免责声明始终可见。
 * 与种子里的措辞保持一致，改口径时两边一起改（`src/lib/assessment-data.ts` 的 `RIASEC_DISCLAIMER`）。
 */
export const DISCLAIMER_FALLBACK = "测评结果用于生涯探索与自我认识，不作为心理诊断或招生、就业的录用依据。";

/** 取免责声明：接口给了非空文本就用接口的，否则用兜底文案 */
export function resolveDisclaimer(raw: unknown): string {
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : DISCLAIMER_FALLBACK;
}
