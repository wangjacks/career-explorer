/**
 * 首套职业测评量表（#221）：O*NET Interest Profiler Mini-IP（30 题，RIASEC）中文改编版。
 *
 * 题库进数据库而非写死代码，本文件只是**首次安装的种子**；后台维护题面后，种子以 `code`
 * 存在性判定幂等，不会覆盖已维护的数据（见两适配器的 `seedAssessments`）。
 *
 * 数据来源与授权：
 * - 题目出自 O*NET Mini Interest Profiler 技术报告 Appendix A「O*NET Mini Interest Profiler Items」
 *   （https://www.onetcenter.org/dl_files/Mini-IP.pdf），6 个维度各 5 题，题号为原报告建议的呈现顺序；
 * - 原始 60 题纸笔版见 https://www.onetcenter.org/dl_tools/ipsf/Interest_Profiler.pdf ；
 * - 翻译与本土化依据 O*NET Tools Developer License（https://www.onetcenter.org/license_tools.html），
 *   必须保留署名并声明「USDOL/ETA 未审核、认可或测试这些修改」。
 *
 * 每题的 `source` 保留原始英文题面，**不入库**：只用于译审与后续信效度验证时与英文原版逐题对照，
 * 也是「题面被误改」时唯一可回溯的原文（单测会校验它非空）。
 *
 * Mini-IP 原始量表**没有反向计分题**（全部正向「愿意做 / 不愿意做」），故 `reverseScored` 全为 false；
 * 该列是给后续量表（如大五人格部分反向题）预留的通用能力，不是本量表的取值。
 */

/** 计量表定义的种子形态，与 `assessments` 表列一一对应（JSON 列在此已是对象/数组） */
export interface AssessmentSeed {
  code: string;
  name: string;
  questionCount: number;
  dimensions: { key: string; label: string }[];
  scoringMode: "typological" | "dimensional";
  scaleVersion: string;
  attribution: string;
  licenseText: string;
  disclaimer: string;
}

/** 单题种子，与 `assessment_questions` 表列的对应关系见字段注释 */
export interface QuestionSeed {
  /** 作答题号，量表内从 1 开始唯一（存 `question_index`） */
  index: number;
  /** 所属维度，必须是量表 `dimensions` 里的 key（存 `dimension`） */
  dimension: string;
  /** 反向计分（存 `reverse_scored`） */
  reverseScored: boolean;
  /** 中文题干（存 `prompt`） */
  prompt: string;
  /** 原始英文题面，仅供译审对照，不入库 */
  source: string;
}

/** 霍兰德六型顺序即量表声明的维度顺序：计分结果与雷达图都按此序展示 */
export const RIASEC_DIMENSIONS: { key: string; label: string }[] = [
  { key: "R", label: "现实型" },
  { key: "I", label: "研究型" },
  { key: "A", label: "艺术型" },
  { key: "S", label: "社会型" },
  { key: "E", label: "企业型" },
  { key: "C", label: "常规型" },
];

/** 量表 code，导出供调用方免硬编码字符串 */
export const RIASEC_CODE = "riasec";

/** 署名文本：O*NET Tools Developer License 的硬性要求，随测评记录落库、在作答与结果页展示 */
export const RIASEC_ATTRIBUTION =
  "本测评题目改编自 O*NET Career Exploration Tools（美国劳工部就业与培训署，U.S. Department of Labor, " +
  "Employment and Training Administration），依据 O*NET Tools Developer License 使用。" +
  "O*NET® 是 USDOL/ETA 的商标。";

/** 授权与修改声明：必须显式声明修改未经官方审核 */
export const RIASEC_LICENSE_TEXT =
  "本系统对原始材料进行了中文翻译与本土化修改，USDOL/ETA 未对这些修改进行审核、认可或测试。" +
  "原始材料：O*NET Interest Profiler Short Form（https://www.onetcenter.org/dl_tools/ipsf/Interest_Profiler.pdf）；" +
  "30 题版本见 O*NET Mini Interest Profiler 技术报告（https://www.onetcenter.org/dl_files/Mini-IP.pdf）；" +
  "授权条款：https://www.onetcenter.org/license_tools.html 。";

/** 免责声明：随测评定义下发，结果页必须展示（不得被解读为诊断或录用依据） */
export const RIASEC_DISCLAIMER =
  "测评结果用于生涯探索与自我认识，不作为心理诊断或招生、就业的录用依据。";

/** RIASEC 量表定义种子 */
export const RIASEC_ASSESSMENT: AssessmentSeed = {
  code: RIASEC_CODE,
  name: "霍兰德职业兴趣测评（Mini-IP 精简版）",
  questionCount: 30,
  dimensions: RIASEC_DIMENSIONS,
  scoringMode: "typological",
  scaleVersion: "Mini-IP-CN 1.0",
  attribution: RIASEC_ATTRIBUTION,
  licenseText: RIASEC_LICENSE_TEXT,
  disclaimer: RIASEC_DISCLAIMER,
};

/** 30 题中文题库，题号与维度严格照 Mini-IP Appendix A 的建议呈现顺序 */
export const RIASEC_QUESTIONS: QuestionSeed[] = [
  { index: 1, dimension: "R", reverseScored: false, prompt: "动手制作厨房橱柜", source: "Build kitchen cabinets" },
  { index: 2, dimension: "I", reverseScored: false, prompt: "研发一种新药", source: "Develop a new medicine" },
  { index: 3, dimension: "A", reverseScored: false, prompt: "写书或写剧本", source: "Write books or plays" },
  {
    index: 4,
    dimension: "S",
    reverseScored: false,
    prompt: "帮助别人解决个人或情绪上的困扰",
    source: "Help people with personal or emotional problems",
  },
  {
    index: 5,
    dimension: "E",
    reverseScored: false,
    prompt: "管理大公司里的一个部门",
    source: "Manage a department within a large company",
  },
  {
    index: 6,
    dimension: "C",
    reverseScored: false,
    prompt: "在单位的大规模网络中为多台电脑安装软件",
    source: "Install software across computers on a large network",
  },
  { index: 7, dimension: "R", reverseScored: false, prompt: "修理家用电器", source: "Repair household appliances" },
  { index: 8, dimension: "I", reverseScored: false, prompt: "研究减少水污染的方法", source: "Study ways to reduce water pollution" },
  { index: 9, dimension: "A", reverseScored: false, prompt: "作曲或编曲", source: "Compose or arrange music" },
  { index: 10, dimension: "S", reverseScored: false, prompt: "给别人做职业发展方面的指导", source: "Give career guidance to people" },
  { index: 11, dimension: "E", reverseScored: false, prompt: "自己创业、开办一家公司", source: "Start your own business" },
  { index: 12, dimension: "C", reverseScored: false, prompt: "用计算器进行运算", source: "Operate a calculator" },
  { index: 13, dimension: "R", reverseScored: false, prompt: "组装电子元件", source: "Assemble electronic parts" },
  { index: 14, dimension: "I", reverseScored: false, prompt: "做化学实验", source: "Conduct chemical experiments" },
  { index: 15, dimension: "A", reverseScored: false, prompt: "为电影制作特效", source: "Create special effects for movies" },
  {
    index: 16,
    dimension: "S",
    reverseScored: false,
    prompt: "为病人做康复治疗",
    source: "Perform rehabilitation therapy",
  },
  { index: 17, dimension: "E", reverseScored: false, prompt: "进行商业合同的谈判", source: "Negotiate business contracts" },
  {
    index: 18,
    dimension: "C",
    reverseScored: false,
    prompt: "记录货物的收货与发货情况",
    source: "Keep shipping and receiving records",
  },
  {
    index: 19,
    dimension: "R",
    reverseScored: false,
    prompt: "开卡车把包裹送到办公楼和住户家中",
    source: "Drive a truck to deliver packages to offices and homes",
  },
  {
    index: 20,
    dimension: "I",
    reverseScored: false,
    prompt: "用显微镜检查血液样本",
    source: "Examine blood samples using a microscope",
  },
  { index: 21, dimension: "A", reverseScored: false, prompt: "为舞台剧绘制布景", source: "Paint sets for plays" },
  {
    index: 22,
    dimension: "S",
    reverseScored: false,
    prompt: "在非营利组织做志愿服务",
    source: "Do volunteer work at a non-profit organization",
  },
  {
    index: 23,
    dimension: "E",
    reverseScored: false,
    prompt: "为新款服装做营销推广",
    source: "Market a new line of clothing",
  },
  {
    index: 24,
    dimension: "C",
    reverseScored: false,
    prompt: "用手持设备盘点库存",
    source: "Inventory supplies using a hand-held computer",
  },
  {
    index: 25,
    dimension: "R",
    reverseScored: false,
    prompt: "在发货前检验零件质量",
    source: "Test the quality of parts before shipment",
  },
  {
    index: 26,
    dimension: "I",
    reverseScored: false,
    prompt: "研究更准确地预报天气的方法",
    source: "Develop a way to better predict the weather",
  },
  {
    index: 27,
    dimension: "A",
    reverseScored: false,
    prompt: "为电影或电视剧写剧本",
    source: "Write scripts for movies or television shows",
  },
  { index: 28, dimension: "S", reverseScored: false, prompt: "给高中生上课", source: "Teach a high-school class" },
  {
    index: 29,
    dimension: "E",
    reverseScored: false,
    prompt: "在百货商场销售商品",
    source: "Sell merchandise at a department store",
  },
  {
    index: 30,
    dimension: "C",
    reverseScored: false,
    prompt: "为单位盖章、分拣并分发邮件",
    source: "Stamp, sort, and distribute mail for an organization",
  },
];

/** 全部量表种子：后续新增量表（如大五人格）只需在此追加一条 */
export const ASSESSMENT_SEEDS: AssessmentSeed[] = [RIASEC_ASSESSMENT];

/** 按量表 code 取题库种子；未注册的 code 返回 undefined */
export function getQuestionSeeds(code: string): QuestionSeed[] | undefined {
  return code === RIASEC_CODE ? RIASEC_QUESTIONS : undefined;
}

/**
 * 种子自检：题数、题号连续性、维度归属、题干非空。两适配器在落库前调用，坏数据宁可在安装时报错，
 * 也不留半截题库（同一个函数保证两种数据库的校验口径完全一致；单测同样复用）。
 */
export function validateAssessmentSeed(
  definition: AssessmentSeed,
  questions: readonly QuestionSeed[]
): void {
  if (!definition.code) throw new Error("测评种子缺少 code");
  if (definition.questionCount <= 0) throw new Error(`${definition.code} 的题数必须为正`);
  if (definition.questionCount !== questions.length) {
    throw new Error(`${definition.code} 声明的题数与题库不符：${definition.questionCount} vs ${questions.length}`);
  }

  const dimensionKeys = new Set<string>();
  for (const dimension of definition.dimensions) {
    if (!dimension.key || !dimension.label) throw new Error(`${definition.code} 的维度定义缺少 key 或 label`);
    if (dimensionKeys.has(dimension.key)) throw new Error(`${definition.code} 的维度 key 重复：${dimension.key}`);
    dimensionKeys.add(dimension.key);
  }

  const indexes = new Set<number>();
  const usedDimensions = new Set<string>();
  for (const question of questions) {
    if (!Number.isInteger(question.index) || question.index < 1) {
      throw new Error(`${definition.code} 的题号非法：${question.index}`);
    }
    if (indexes.has(question.index)) throw new Error(`${definition.code} 的题号重复：${question.index}`);
    indexes.add(question.index);
    if (!dimensionKeys.has(question.dimension)) {
      throw new Error(`${definition.code} 第 ${question.index} 题归属了未定义的维度：${question.dimension}`);
    }
    usedDimensions.add(question.dimension);
    if (!question.prompt.trim()) throw new Error(`${definition.code} 第 ${question.index} 题题干为空`);
    if (!question.source.trim()) throw new Error(`${definition.code} 第 ${question.index} 题缺少英文原文`);
  }
  // 题号必须 1..n 连续：作答接口按题号存答案，跳号会让「已答 n 题 / 总 n 题」进度与实际不符
  for (let expected = 1; expected <= questions.length; expected += 1) {
    if (!indexes.has(expected)) throw new Error(`${definition.code} 题号不连续，缺少第 ${expected} 题`);
  }
  // 每个声明的维度都要有题：零题维度在计分里恒为 0 分，会把未作答与真实低分混为一谈
  for (const key of dimensionKeys) {
    if (!usedDimensions.has(key)) throw new Error(`${definition.code} 的维度 ${key} 没有对应题目`);
  }
}
