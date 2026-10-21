/**
 * 职业测评的题库与量表种子（#221 建立、#281 扩容霍兰德题库、#290 加入 IPIP 大五）。
 *
 * 题库进数据库而非写死代码，本文件只是**种子**；后台维护题面后，种子以 `code` 存在性判定幂等，
 * 不会覆盖已维护的数据（见两适配器的 `seedAssessments`）。生产库已有旧题库时由
 * `upgradeAssessmentBank()` 走**只增不改**的升级：补插缺失题号、只回填 `origin`、绝不 UPDATE 已存在题面。
 *
 * 120 题构成（`origin` 列即来源）：
 * - 1–30 `onet-mini`：O*NET Mini Interest Profiler 技术报告 Appendix A 的 30 题中文改编版
 *   （https://www.onetcenter.org/dl_files/Mini-IP.pdf），6 维各 5 题，题号为原报告建议的呈现顺序；
 * - 31–60 `onet-sf`：O*NET Interest Profiler Short Form 其余 30 题中文翻译
 *   （https://www.onetcenter.org/dl_tools/ipsf/Interest_Profiler.pdf），6 维各 5 题；
 * - 61–120 `cn-original`：本项目原创 60 题（6 维各 10 题），每题锚定一个真实 O*NET 职业，
 *   其职业信息参照 O*NET Database 30.2（CC BY 4.0）。
 *
 * 命题规则与完整题面清单见 `docs/plan-assessment-120.md` §4 / §6；本文件是题面的**权威落库来源**，
 * 方案文档只保留规则与清单，避免两处漂移。
 *
 * 翻译与本土化依据 O*NET Tools Developer License（https://www.onetcenter.org/license_tools.html），
 * 必须保留署名并声明「USDOL/ETA 未审核、认可或测试这些修改」。
 *
 * 每题的 `source` 保留英文题面（原创题为译注），`anchor` 保留锚定职业名，两者**都不入库**：
 * 用于译审、回溯与 `validateAssessmentSeed` 的效度校验（单测会逐题比对）。
 *
 * 本量表**没有反向计分题**（全部正向「愿意做 / 不愿意做」），故 `reverseScored` 全为 false；
 * 该列是给后续量表（如大五人格部分反向题）预留的通用能力，不是本量表的取值。
 */

/** 计量表定义的种子形态，与 `assessments` 表列一一对应（JSON 列在此已是对象/数组） */
export interface AssessmentSeed {
  code: string;
  name: string;
  questionCount: number;
  /** 每次作答题数（存 `items_per_attempt`）：0 = 全量作答（题库即本轮）；分层抽题见 `assessment-sampling.ts` */
  itemsPerAttempt: number;
  dimensions: { key: string; label: string }[];
  scoringMode: "typological" | "dimensional";
  scaleVersion: string;
  attribution: string;
  licenseText: string;
  disclaimer: string;
}

/** 题目来源：霍兰德分层抽样依赖 O*NET 分布；IPIP 公有领域条目单独标记 */
export type QuestionOrigin = "onet-mini" | "onet-sf" | "cn-original" | "ipip";

/** 作答页按量表下发的 5 点锚点 */
export interface AssessmentAnchor {
  value: 1 | 2 | 3 | 4 | 5;
  label: string;
}

/** 单题种子，与 `assessment_questions` 表列的对应关系见字段注释 */
export interface QuestionSeed {
  /** 作答题号，量表内从 1 开始唯一（存 `question_index`） */
  index: number;
  /** 所属维度，必须是量表 `dimensions` 里的 key（存 `dimension`） */
  dimension: string;
  /** 题目来源（存 `origin`）：官方 Mini-IP / 官方 SF / 本项目原创 / IPIP */
  origin: QuestionOrigin;
  /** 反向计分（存 `reverse_scored`） */
  reverseScored: boolean;
  /** 中文题干（存 `prompt`） */
  prompt: string;
  /** 原始英文题面（原创题为译注），仅供译审对照，不入库 */
  source: string;
  /** 锚定职业名（仅原创题）：必须是 O*NET 快照里的真实职业，用于维度归属的效度校验，不入库 */
  anchor?: string;
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
  "题库中 31–60 题同样出自上述 O*NET Interest Profiler Short Form；" +
  "61–120 题为本项目原创，其职业信息参照 O*NET Database（https://www.onetcenter.org/database.html，CC BY 4.0）。" +
  "正式启用前须完成专家评审与一个班级的试测（试测结果只出聚合指标）；" +
  "授权条款：https://www.onetcenter.org/license_tools.html 。";

/** 免责声明：随测评定义下发，结果页必须展示（不得被解读为诊断或录用依据） */
export const RIASEC_DISCLAIMER =
  "测评结果用于生涯探索与自我认识，不作为心理诊断或招生、就业的录用依据。";

/** 量表版本：从纯 Mini-IP（30 题）升级为 120 题库版本（#281） */
export const RIASEC_SCALE_VERSION = "RIASEC-CN 2.0";

/** RIASEC 量表定义种子（`questionCount` 语义 = **题库总量**；每次作答 30 题由 `itemsPerAttempt` 表达，#282） */
export const RIASEC_ASSESSMENT: AssessmentSeed = {
  code: RIASEC_CODE,
  name: "霍兰德职业兴趣测评（120 题库）",
  questionCount: 120,
  itemsPerAttempt: 30,
  dimensions: RIASEC_DIMENSIONS,
  scoringMode: "typological",
  scaleVersion: RIASEC_SCALE_VERSION,
  attribution: RIASEC_ATTRIBUTION,
  licenseText: RIASEC_LICENSE_TEXT,
  disclaimer: RIASEC_DISCLAIMER,
};

/** 30 题中文题库，题号与维度严格照 Mini-IP Appendix A 的建议呈现顺序 */
const RIASEC_MINI_QUESTIONS: QuestionSeed[] = [
  { index: 1, origin: "onet-mini", dimension: "R", reverseScored: false, prompt: "动手制作厨房橱柜", source: "Build kitchen cabinets" },
  { index: 2, origin: "onet-mini", dimension: "I", reverseScored: false, prompt: "研发一种新药", source: "Develop a new medicine" },
  { index: 3, origin: "onet-mini", dimension: "A", reverseScored: false, prompt: "写书或写剧本", source: "Write books or plays" },
  {
    index: 4, origin: "onet-mini",
    dimension: "S",
    reverseScored: false,
    prompt: "帮助别人解决个人或情绪上的困扰",
    source: "Help people with personal or emotional problems",
  },
  {
    index: 5, origin: "onet-mini",
    dimension: "E",
    reverseScored: false,
    prompt: "管理大公司里的一个部门",
    source: "Manage a department within a large company",
  },
  {
    index: 6, origin: "onet-mini",
    dimension: "C",
    reverseScored: false,
    prompt: "在单位的大规模网络中为多台电脑安装软件",
    source: "Install software across computers on a large network",
  },
  { index: 7, origin: "onet-mini", dimension: "R", reverseScored: false, prompt: "修理家用电器", source: "Repair household appliances" },
  { index: 8, origin: "onet-mini", dimension: "I", reverseScored: false, prompt: "研究减少水污染的方法", source: "Study ways to reduce water pollution" },
  { index: 9, origin: "onet-mini", dimension: "A", reverseScored: false, prompt: "作曲或编曲", source: "Compose or arrange music" },
  { index: 10, origin: "onet-mini", dimension: "S", reverseScored: false, prompt: "给别人做职业发展方面的指导", source: "Give career guidance to people" },
  { index: 11, origin: "onet-mini", dimension: "E", reverseScored: false, prompt: "自己创业、开办一家公司", source: "Start your own business" },
  { index: 12, origin: "onet-mini", dimension: "C", reverseScored: false, prompt: "用计算器进行运算", source: "Operate a calculator" },
  { index: 13, origin: "onet-mini", dimension: "R", reverseScored: false, prompt: "组装电子元件", source: "Assemble electronic parts" },
  { index: 14, origin: "onet-mini", dimension: "I", reverseScored: false, prompt: "做化学实验", source: "Conduct chemical experiments" },
  { index: 15, origin: "onet-mini", dimension: "A", reverseScored: false, prompt: "为电影制作特效", source: "Create special effects for movies" },
  {
    index: 16, origin: "onet-mini",
    dimension: "S",
    reverseScored: false,
    prompt: "为病人做康复治疗",
    source: "Perform rehabilitation therapy",
  },
  { index: 17, origin: "onet-mini", dimension: "E", reverseScored: false, prompt: "进行商业合同的谈判", source: "Negotiate business contracts" },
  {
    index: 18, origin: "onet-mini",
    dimension: "C",
    reverseScored: false,
    prompt: "记录货物的收货与发货情况",
    source: "Keep shipping and receiving records",
  },
  {
    index: 19, origin: "onet-mini",
    dimension: "R",
    reverseScored: false,
    prompt: "开卡车把包裹送到办公楼和住户家中",
    source: "Drive a truck to deliver packages to offices and homes",
  },
  {
    index: 20, origin: "onet-mini",
    dimension: "I",
    reverseScored: false,
    prompt: "用显微镜检查血液样本",
    source: "Examine blood samples using a microscope",
  },
  { index: 21, origin: "onet-mini", dimension: "A", reverseScored: false, prompt: "为舞台剧绘制布景", source: "Paint sets for plays" },
  {
    index: 22, origin: "onet-mini",
    dimension: "S",
    reverseScored: false,
    prompt: "在非营利组织做志愿服务",
    source: "Do volunteer work at a non-profit organization",
  },
  {
    index: 23, origin: "onet-mini",
    dimension: "E",
    reverseScored: false,
    prompt: "为新款服装做营销推广",
    source: "Market a new line of clothing",
  },
  {
    index: 24, origin: "onet-mini",
    dimension: "C",
    reverseScored: false,
    prompt: "用手持设备盘点库存",
    source: "Inventory supplies using a hand-held computer",
  },
  {
    index: 25, origin: "onet-mini",
    dimension: "R",
    reverseScored: false,
    prompt: "在发货前检验零件质量",
    source: "Test the quality of parts before shipment",
  },
  {
    index: 26, origin: "onet-mini",
    dimension: "I",
    reverseScored: false,
    prompt: "研究更准确地预报天气的方法",
    source: "Develop a way to better predict the weather",
  },
  {
    index: 27, origin: "onet-mini",
    dimension: "A",
    reverseScored: false,
    prompt: "为电影或电视剧写剧本",
    source: "Write scripts for movies or television shows",
  },
  { index: 28, origin: "onet-mini", dimension: "S", reverseScored: false, prompt: "给高中生上课", source: "Teach a high-school class" },
  {
    index: 29, origin: "onet-mini",
    dimension: "E",
    reverseScored: false,
    prompt: "在百货商场销售商品",
    source: "Sell merchandise at a department store",
  },
  {
    index: 30, origin: "onet-mini",
    dimension: "C",
    reverseScored: false,
    prompt: "为单位盖章、分拣并分发邮件",
    source: "Stamp, sort, and distribute mail for an organization",
  },
];

/** O*NET Interest Profiler Short Form 其余 30 题（题号 31–60，官方题面中译，见 docs/plan-assessment-120.md §6.2） */
const RIASEC_SF_QUESTIONS: QuestionSeed[] = [
  { index: 31, dimension: "R", origin: "onet-sf", reverseScored: false, prompt: "砌砖或铺贴瓷砖", source: "Lay brick or tile" },
  { index: 32, dimension: "R", origin: "onet-sf", reverseScored: false, prompt: "修理并安装门锁", source: "Repair and install locks" },
  { index: 33, dimension: "R", origin: "onet-sf", reverseScored: false, prompt: "在育苗场养殖鱼苗", source: "Raise fish in a fish hatchery" },
  { index: 34, dimension: "R", origin: "onet-sf", reverseScored: false, prompt: "调试并操作机器生产产品", source: "Set up and operate machines to make products" },
  { index: 35, dimension: "R", origin: "onet-sf", reverseScored: false, prompt: "扑灭森林火灾", source: "Put out forest fires" },
  { index: 36, dimension: "I", origin: "onet-sf", reverseScored: false, prompt: "调查一场火灾的起因", source: "Investigate the cause of a fire" },
  { index: 37, dimension: "I", origin: "onet-sf", reverseScored: false, prompt: "在生物实验室工作", source: "Work in a biology lab" },
  { index: 38, dimension: "I", origin: "onet-sf", reverseScored: false, prompt: "研究行星的运行规律", source: "Study the movement of planets" },
  { index: 39, dimension: "I", origin: "onet-sf", reverseScored: false, prompt: "发明一种糖的替代品", source: "Invent a replacement for sugar" },
  { index: 40, dimension: "I", origin: "onet-sf", reverseScored: false, prompt: "做化验以确诊疾病", source: "Do laboratory tests to identify diseases" },
  { index: 41, dimension: "A", origin: "onet-sf", reverseScored: false, prompt: "演奏一种乐器", source: "Play a musical instrument" },
  { index: 42, dimension: "A", origin: "onet-sf", reverseScored: false, prompt: "表演爵士舞或踢踏舞", source: "Perform jazz or tap dance" },
  { index: 43, dimension: "A", origin: "onet-sf", reverseScored: false, prompt: "绘制图画", source: "Draw pictures" },
  { index: 44, dimension: "A", origin: "onet-sf", reverseScored: false, prompt: "在乐队里唱歌", source: "Sing in a band" },
  { index: 45, dimension: "A", origin: "onet-sf", reverseScored: false, prompt: "剪辑影片", source: "Edit movies" },
  { index: 46, dimension: "S", origin: "onet-sf", reverseScored: false, prompt: "教一个人做健身操", source: "Teach an individual an exercise routine" },
  { index: 47, dimension: "S", origin: "onet-sf", reverseScored: false, prompt: "教孩子做体育运动", source: "Teach children how to play sports" },
  { index: 48, dimension: "S", origin: "onet-sf", reverseScored: false, prompt: "教听障人士手语", source: "Teach sign language to people who are deaf or hard of hearing" },
  { index: 49, dimension: "S", origin: "onet-sf", reverseScored: false, prompt: "协助开展团体心理辅导", source: "Help conduct a group therapy session" },
  { index: 50, dimension: "S", origin: "onet-sf", reverseScored: false, prompt: "在托幼机构照顾孩子", source: "Take care of children at a day-care center" },
  { index: 51, dimension: "E", origin: "onet-sf", reverseScored: false, prompt: "买卖股票和债券", source: "Buy and sell stocks and bonds" },
  { index: 52, dimension: "E", origin: "onet-sf", reverseScored: false, prompt: "管理一家零售门店", source: "Manage a retail store" },
  { index: 53, dimension: "E", origin: "onet-sf", reverseScored: false, prompt: "在诉讼中代理当事人", source: "Represent a client in a lawsuit" },
  { index: 54, dimension: "E", origin: "onet-sf", reverseScored: false, prompt: "经营一家美容院或理发店", source: "Operate a beauty salon or barber shop" },
  { index: 55, dimension: "E", origin: "onet-sf", reverseScored: false, prompt: "管理一家服装店", source: "Manage a clothing store" },
  { index: 56, dimension: "C", origin: "onet-sf", reverseScored: false, prompt: "用表格软件制作电子表格", source: "Develop a spreadsheet using computer software" },
  { index: 57, dimension: "C", origin: "onet-sf", reverseScored: false, prompt: "核算员工工资", source: "Calculate the wages of employees" },
  { index: 58, dimension: "C", origin: "onet-sf", reverseScored: false, prompt: "校对记录或表单", source: "Proofread records or forms" },
  { index: 59, dimension: "C", origin: "onet-sf", reverseScored: false, prompt: "登记房租收缴情况", source: "Record rent payments" },
  { index: 60, dimension: "C", origin: "onet-sf", reverseScored: false, prompt: "保存库存记录", source: "Keep inventory records" },
];

/** 本项目原创 60 题（题号 61–120，锚定职业见 docs/plan-assessment-120.md §6.3；anchor 只留种子、不入库） */
const RIASEC_CN_QUESTIONS: QuestionSeed[] = [
  { index: 61, dimension: "R", origin: "cn-original", reverseScored: false, prompt: "拆装并保养自行车", source: "Disassemble, repair and maintain bicycles", anchor: "Bicycle Repairers" },
  { index: 62, dimension: "R", origin: "cn-original", reverseScored: false, prompt: "用 3D 打印机制作零件", source: "Make parts with a 3D printer", anchor: "Computer Numerically Controlled Tool Operators" },
  { index: 63, dimension: "R", origin: "cn-original", reverseScored: false, prompt: "布设并调试智能家居线路", source: "Install and debug smart-home wiring", anchor: "Electricians" },
  { index: 64, dimension: "R", origin: "cn-original", reverseScored: false, prompt: "在果园里修剪果树", source: "Prune fruit trees in an orchard", anchor: "Farmworkers and Laborers, Crop, Nursery, and Greenhouse" },
  { index: 65, dimension: "R", origin: "cn-original", reverseScored: false, prompt: "操作挖掘机进行土方作业", source: "Operate an excavator for earthwork", anchor: "Operating Engineers and Other Construction Equipment Operators" },
  { index: 66, dimension: "R", origin: "cn-original", reverseScored: false, prompt: "测绘地形并绘制施工图", source: "Survey terrain and draw construction plans", anchor: "Surveying and Mapping Technicians" },
  { index: 67, dimension: "R", origin: "cn-original", reverseScored: false, prompt: "组装并试飞无人机", source: "Assemble and test-fly a drone", anchor: "Robotics Technicians" },
  { index: 68, dimension: "R", origin: "cn-original", reverseScored: false, prompt: "在车间焊接金属构件", source: "Weld metal parts in a workshop", anchor: "Welders, Cutters, Solderers, and Brazers" },
  { index: 69, dimension: "R", origin: "cn-original", reverseScored: false, prompt: "维护风力发电设备", source: "Maintain wind turbine equipment", anchor: "Wind Turbine Service Technicians" },
  { index: 70, dimension: "R", origin: "cn-original", reverseScored: false, prompt: "训练犬只完成指定动作", source: "Train dogs to perform commands", anchor: "Animal Trainers" },
  { index: 71, dimension: "I", origin: "cn-original", reverseScored: false, prompt: "分析问卷数据并写出研究结论", source: "Analyze survey data and write up the findings", anchor: "Data Scientists" },
  { index: 72, dimension: "I", origin: "cn-original", reverseScored: false, prompt: "用编程语言实现一个算法", source: "Implement an algorithm in a programming language", anchor: "Computer and Information Research Scientists" },
  { index: 73, dimension: "I", origin: "cn-original", reverseScored: false, prompt: "观察并记录鸟类的迁徙行为", source: "Observe and record bird migration", anchor: "Zoologists and Wildlife Biologists" },
  { index: 74, dimension: "I", origin: "cn-original", reverseScored: false, prompt: "推导一道数学难题的多种解法", source: "Derive several solutions to a hard math problem", anchor: "Mathematicians" },
  { index: 75, dimension: "I", origin: "cn-original", reverseScored: false, prompt: "研究新型电池材料的充放电性能", source: "Study the charge-discharge performance of new battery materials", anchor: "Materials Scientists" },
  { index: 76, dimension: "I", origin: "cn-original", reverseScored: false, prompt: "用望远镜观测并记录星体变化", source: "Observe and log changes in celestial bodies with a telescope", anchor: "Astronomers" },
  { index: 77, dimension: "I", origin: "cn-original", reverseScored: false, prompt: "用传染病数据建立传播预测模型", source: "Build an epidemic-spread model from case data", anchor: "Epidemiologists" },
  { index: 78, dimension: "I", origin: "cn-original", reverseScored: false, prompt: "在实验室培养细胞并观察其变化", source: "Culture cells and observe their changes in a lab", anchor: "Microbiologists" },
  { index: 79, dimension: "I", origin: "cn-original", reverseScored: false, prompt: "研究城市交通拥堵的成因并提出改进方案", source: "Study the causes of urban traffic congestion and propose fixes", anchor: "Urban and Regional Planners" },
  { index: 80, dimension: "I", origin: "cn-original", reverseScored: false, prompt: "对比测试不同材料的隔热性能", source: "Comparatively test the thermal insulation of different materials", anchor: "Chemical Technicians" },
  { index: 81, dimension: "A", origin: "cn-original", reverseScored: false, prompt: "为一款产品设计外观造型", source: "Design the form and look of a product", anchor: "Commercial and Industrial Designers" },
  { index: 82, dimension: "A", origin: "cn-original", reverseScored: false, prompt: "用摄影作品讲一个完整的故事", source: "Tell a complete story through photographs", anchor: "Photographers" },
  { index: 83, dimension: "A", origin: "cn-original", reverseScored: false, prompt: "设计一套服装的款式与配色", source: "Design the cut and colour scheme of an outfit", anchor: "Fashion Designers" },
  { index: 84, dimension: "A", origin: "cn-original", reverseScored: false, prompt: "为动画角色设计形象与动作", source: "Design the look and movement of an animated character", anchor: "Special Effects Artists and Animators" },
  { index: 85, dimension: "A", origin: "cn-original", reverseScored: false, prompt: "排练并登台演出话剧", source: "Rehearse and perform in a stage play", anchor: "Actors" },
  { index: 86, dimension: "A", origin: "cn-original", reverseScored: false, prompt: "策划一场校园音乐会或文艺展演", source: "Program a campus concert or arts showcase", anchor: "Producers and Directors" },
  { index: 87, dimension: "A", origin: "cn-original", reverseScored: false, prompt: "用陶土或木材制作手工艺品", source: "Make handicrafts out of clay or wood", anchor: "Craft Artists" },
  { index: 88, dimension: "A", origin: "cn-original", reverseScored: false, prompt: "设计字体或手写艺术字", source: "Design typefaces or hand-lettering", anchor: "Graphic Designers" },
  { index: 89, dimension: "A", origin: "cn-original", reverseScored: false, prompt: "在舞台上完成一段即兴表演", source: "Perform an improvised scene on stage", anchor: "Actors" },
  { index: 90, dimension: "A", origin: "cn-original", reverseScored: false, prompt: "为展览布置灯光与参观动线", source: "Light an exhibition and plan its visitor flow", anchor: "Set and Exhibit Designers" },
  { index: 91, dimension: "S", origin: "cn-original", reverseScored: false, prompt: "给低年级同学讲解不会做的题目", source: "Explain problems that younger students cannot solve", anchor: "Tutors" },
  { index: 92, dimension: "S", origin: "cn-original", reverseScored: false, prompt: "陪伴并照顾独居老人", source: "Keep company with and care for an elderly person living alone", anchor: "Personal Care Aides" },
  { index: 93, dimension: "S", origin: "cn-original", reverseScored: false, prompt: "为新生做入学适应引导", source: "Help new students settle into school", anchor: "Educational, Guidance, and Career Counselors and Advisors" },
  { index: 94, dimension: "S", origin: "cn-original", reverseScored: false, prompt: "组织一场社区公益活动", source: "Organize a community service event", anchor: "Community Health Workers" },
  { index: 95, dimension: "S", origin: "cn-original", reverseScored: false, prompt: "在病房里安慰并照护病人", source: "Comfort and care for patients on a ward", anchor: "Nursing Assistants" },
  { index: 96, dimension: "S", origin: "cn-original", reverseScored: false, prompt: "为有学习困难的学生做个别辅导", source: "Give one-to-one tutoring to students with learning difficulties", anchor: "Special Education Teachers, Elementary School" },
  { index: 97, dimension: "S", origin: "cn-original", reverseScored: false, prompt: "调解同学之间的矛盾与冲突", source: "Mediate conflicts between classmates", anchor: "Social and Human Service Assistants" },
  { index: 98, dimension: "S", origin: "cn-original", reverseScored: false, prompt: "为留守儿童开设兴趣课堂", source: "Run an interest class for left-behind children", anchor: "Teaching Assistants, Preschool, Elementary, Middle, and Secondary School, Except Special Education" },
  { index: 99, dimension: "S", origin: "cn-original", reverseScored: false, prompt: "在夏令营里带小组活动", source: "Lead small-group activities at a summer camp", anchor: "Recreation Workers" },
  { index: 100, dimension: "S", origin: "cn-original", reverseScored: false, prompt: "接听心理援助热线并倾听来电者", source: "Listen to callers on a psychological helpline", anchor: "Mental Health Counselors" },
  { index: 101, dimension: "E", origin: "cn-original", reverseScored: false, prompt: "为社团活动拉赞助", source: "Raise sponsorship for a club event", anchor: "Fundraisers" },
  { index: 102, dimension: "E", origin: "cn-original", reverseScored: false, prompt: "策划一场直播带货并担任主播", source: "Plan and host a live-commerce stream", anchor: "Advertising and Promotions Managers" },
  { index: 103, dimension: "E", origin: "cn-original", reverseScored: false, prompt: "带领团队完成创业项目路演", source: "Lead a team through a startup pitch", anchor: "Chief Executives" },
  { index: 104, dimension: "E", origin: "cn-original", reverseScored: false, prompt: "说服别人接受自己的方案", source: "Persuade others to accept your proposal", anchor: "Public Relations Specialists" },
  { index: 105, dimension: "E", origin: "cn-original", reverseScored: false, prompt: "为一个品牌谈下代言合作", source: "Land a brand endorsement deal", anchor: "Marketing Managers" },
  { index: 106, dimension: "E", origin: "cn-original", reverseScored: false, prompt: "竞选学生会主席并做竞选演说", source: "Run for student-union president and give a campaign speech", anchor: "Legislators" },
  { index: 107, dimension: "E", origin: "cn-original", reverseScored: false, prompt: "制定一家门店的月度促销计划", source: "Draft a store's monthly promotion plan", anchor: "Marketing Managers" },
  { index: 108, dimension: "E", origin: "cn-original", reverseScored: false, prompt: "为客户介绍理财产品并促成签约", source: "Present financial products to clients and close the deal", anchor: "Securities, Commodities, and Financial Services Sales Agents" },
  { index: 109, dimension: "E", origin: "cn-original", reverseScored: false, prompt: "招募并面试新的团队成员", source: "Recruit and interview new team members", anchor: "Human Resources Specialists" },
  { index: 110, dimension: "E", origin: "cn-original", reverseScored: false, prompt: "为一个新产品开拓销售渠道", source: "Open sales channels for a new product", anchor: "Sales Managers" },
  { index: 111, dimension: "C", origin: "cn-original", reverseScored: false, prompt: "把纸质档案整理归档并编号", source: "Sort, file and number paper records", anchor: "File Clerks" },
  { index: 112, dimension: "C", origin: "cn-original", reverseScored: false, prompt: "核对报销单据是否齐全合规", source: "Check reimbursement documents for completeness and compliance", anchor: "Bookkeeping, Accounting, and Auditing Clerks" },
  { index: 113, dimension: "C", origin: "cn-original", reverseScored: false, prompt: "用表格登记班级每天的考勤", source: "Log the class's daily attendance in a spreadsheet", anchor: "Payroll and Timekeeping Clerks" },
  { index: 114, dimension: "C", origin: "cn-original", reverseScored: false, prompt: "按固定模板整理会议纪要", source: "Write up meeting minutes using a fixed template", anchor: "Secretaries and Administrative Assistants, Except Legal, Medical, and Executive" },
  { index: 115, dimension: "C", origin: "cn-original", reverseScored: false, prompt: "盘点并登记实验室器材的借还", source: "Count and log the lending of lab equipment", anchor: "Library Assistants, Clerical" },
  { index: 116, dimension: "C", origin: "cn-original", reverseScored: false, prompt: "编制一份月度收支明细表", source: "Compile a monthly income-and-expense statement", anchor: "Bookkeeping, Accounting, and Auditing Clerks" },
  { index: 117, dimension: "C", origin: "cn-original", reverseScored: false, prompt: "为一批文件建立索引和检索目录", source: "Build an index and catalogue for a batch of documents", anchor: "Library Technicians" },
  { index: 118, dimension: "C", origin: "cn-original", reverseScored: false, prompt: "按排班表安排成员的值班顺序", source: "Arrange duty shifts from a rota", anchor: "Production, Planning, and Expediting Clerks" },
  { index: 119, dimension: "C", origin: "cn-original", reverseScored: false, prompt: "录入并校验一批客户信息", source: "Key in and verify a batch of customer records", anchor: "Data Entry Keyers" },
  { index: 120, dimension: "C", origin: "cn-original", reverseScored: false, prompt: "整理并维护标准操作流程文档", source: "Maintain standard operating procedure documents", anchor: "Document Management Specialists" },
];

/** 120 题题库：现有 Mini-IP 30 题 + SF 30 题 + 原创 60 题，顺序即题号 */
export const RIASEC_QUESTIONS: QuestionSeed[] = [
  ...RIASEC_MINI_QUESTIONS,
  ...RIASEC_SF_QUESTIONS,
  ...RIASEC_CN_QUESTIONS,
];

/** 五大人格维度顺序：计分结果与后续结果卡都按此序展示 */
export const IPIP_DIMENSIONS: { key: string; label: string }[] = [
  { key: "N", label: "神经质" },
  { key: "E", label: "外向性" },
  { key: "O", label: "开放性" },
  { key: "A", label: "宜人性" },
  { key: "C", label: "尽责性" },
];

export const IPIP_NEO_FFI_CODE = "ipip-neo-ffi";
export const IPIP_NEO_FFI_SCALE_VERSION = "IPIP NEO-FFI 1.0";

export const IPIP_ATTRIBUTION =
  "题目取自 International Personality Item Pool（IPIP）五大人格题池；IPIP 条目属于公有领域。" +
  "中文翻译由本项目提供。";

export const IPIP_LICENSE_TEXT =
  "IPIP 条目属于公有领域，可自由复制、修改并用于商业或非商业用途。来源：" +
  "https://ipip.ori.org/newNEODomainsKey.htm 。本量表使用 IPIP 公有领域条目，" +
  "不等同于 PAR 公司受版权保护的商业 NEO-FFI 原版。";

/** 免责声明：与其他教育测评共用同一口径，不构成心理诊断或录用依据 */
export const IPIP_DISCLAIMER =
  "测评结果用于生涯探索与自我认识，不作为心理诊断或招生、就业的录用依据。";

export const IPIP_ASSESSMENT: AssessmentSeed = {
  code: IPIP_NEO_FFI_CODE,
  name: "五大人格测评（IPIP NEO-FFI 精简版）",
  questionCount: 50,
  // 50 题每维 10 题，本期按全量作答（#282 的分层抽题只对霍兰德 120 题库启用）
  itemsPerAttempt: 0,
  dimensions: IPIP_DIMENSIONS,
  scoringMode: "dimensional",
  scaleVersion: IPIP_NEO_FFI_SCALE_VERSION,
  attribution: IPIP_ATTRIBUTION,
  licenseText: IPIP_LICENSE_TEXT,
  disclaimer: IPIP_DISCLAIMER,
};

/**
 * IPIP 五大人格 50 题短式：每维 10 题，5 正 5 反，共 25 道反向题。
 *
 * 英文原文与计分方向逐题对照 IPIP NEO Domains Key；中文翻译由本项目提供。
 * 完整题面与来源说明见 `docs/plan-ipip-neo-ffi.md`。
 */
export const IPIP_QUESTIONS: QuestionSeed[] = [
  { index: 1, dimension: "N", origin: "ipip", reverseScored: false, prompt: "经常感到忧郁", source: "Often feel blue." },
  { index: 2, dimension: "N", origin: "ipip", reverseScored: false, prompt: "不喜欢自己", source: "Dislike myself." },
  { index: 3, dimension: "N", origin: "ipip", reverseScored: false, prompt: "常常情绪低落", source: "Am often down in the dumps." },
  { index: 4, dimension: "N", origin: "ipip", reverseScored: false, prompt: "情绪起伏频繁", source: "Have frequent mood swings." },
  { index: 5, dimension: "N", origin: "ipip", reverseScored: false, prompt: "容易惊慌", source: "Panic easily." },
  { index: 6, dimension: "N", origin: "ipip", reverseScored: true, prompt: "很少被激怒", source: "Rarely get irritated." },
  { index: 7, dimension: "N", origin: "ipip", reverseScored: true, prompt: "很少感到忧郁", source: "Seldom feel blue." },
  { index: 8, dimension: "N", origin: "ipip", reverseScored: true, prompt: "对自己感到自在", source: "Feel comfortable with myself." },
  {
    index: 9,
    dimension: "N",
    origin: "ipip",
    reverseScored: true,
    prompt: "不容易被事情烦扰",
    source: "Am not easily bothered by things.",
  },
  { index: 10, dimension: "N", origin: "ipip", reverseScored: true, prompt: "对自己非常满意", source: "Am very pleased with myself." },
  {
    index: 11,
    dimension: "E",
    origin: "ipip",
    reverseScored: false,
    prompt: "在人群中感到自在",
    source: "Feel comfortable around people.",
  },
  { index: 12, dimension: "E", origin: "ipip", reverseScored: false, prompt: "能轻松交到朋友", source: "Make friends easily." },
  {
    index: 13,
    dimension: "E",
    origin: "ipip",
    reverseScored: false,
    prompt: "善于应对社交场合",
    source: "Am skilled in handling social situations.",
  },
  { index: 14, dimension: "E", origin: "ipip", reverseScored: false, prompt: "在聚会上很活跃", source: "Am the life of the party." },
  {
    index: 15,
    dimension: "E",
    origin: "ipip",
    reverseScored: false,
    prompt: "知道如何吸引别人",
    source: "Know how to captivate people.",
  },
  { index: 16, dimension: "E", origin: "ipip", reverseScored: true, prompt: "常常没什么话说", source: "Have little to say." },
  { index: 17, dimension: "E", origin: "ipip", reverseScored: true, prompt: "喜欢待在幕后", source: "Keep in the background." },
  {
    index: 18,
    dimension: "E",
    origin: "ipip",
    reverseScored: true,
    prompt: "觉得自己的经历有些乏味",
    source: "Would describe my experiences as somewhat dull.",
  },
  {
    index: 19,
    dimension: "E",
    origin: "ipip",
    reverseScored: true,
    prompt: "不喜欢引人注目",
    source: "Don't like to draw attention to myself.",
  },
  { index: 20, dimension: "E", origin: "ipip", reverseScored: true, prompt: "平时话不多", source: "Don't talk a lot." },
  { index: 21, dimension: "O", origin: "ipip", reverseScored: false, prompt: "想象力丰富", source: "Have a vivid imagination." },
  {
    index: 22,
    dimension: "O",
    origin: "ipip",
    reverseScored: false,
    prompt: "重视艺术的价值",
    source: "Believe in the importance of art.",
  },
  { index: 23, dimension: "O", origin: "ipip", reverseScored: false, prompt: "喜欢听新观点", source: "Enjoy hearing new ideas." },
  {
    index: 24,
    dimension: "O",
    origin: "ipip",
    reverseScored: false,
    prompt: "能把对话引向更深层次",
    source: "Carry the conversation to a higher level.",
  },
  {
    index: 25,
    dimension: "O",
    origin: "ipip",
    reverseScored: false,
    prompt: "会花时间思考问题",
    source: "Spend time reflecting on things.",
  },
  {
    index: 26,
    dimension: "O",
    origin: "ipip",
    reverseScored: true,
    prompt: "对抽象观念不感兴趣",
    source: "Am not interested in abstract ideas.",
  },
  { index: 27, dimension: "O", origin: "ipip", reverseScored: true, prompt: "不喜欢艺术", source: "Do not like art." },
  {
    index: 28,
    dimension: "O",
    origin: "ipip",
    reverseScored: true,
    prompt: "回避哲学讨论",
    source: "Avoid philosophical discussions.",
  },
  {
    index: 29,
    dimension: "O",
    origin: "ipip",
    reverseScored: true,
    prompt: "不喜欢去美术馆",
    source: "Do not enjoy going to art museums.",
  },
  {
    index: 30,
    dimension: "O",
    origin: "ipip",
    reverseScored: true,
    prompt: "难以理解抽象概念",
    source: "Have difficulty understanding abstract ideas.",
  },
  {
    index: 31,
    dimension: "A",
    origin: "ipip",
    reverseScored: false,
    prompt: "总愿意说别人的好话",
    source: "Have a good word for everyone.",
  },
  {
    index: 32,
    dimension: "A",
    origin: "ipip",
    reverseScored: false,
    prompt: "相信别人心怀善意",
    source: "Believe that others have good intentions.",
  },
  { index: 33, dimension: "A", origin: "ipip", reverseScored: false, prompt: "尊重他人", source: "Respect others." },
  {
    index: 34,
    dimension: "A",
    origin: "ipip",
    reverseScored: false,
    prompt: "接受别人本来的样子",
    source: "Accept people as they are.",
  },
  {
    index: 35,
    dimension: "A",
    origin: "ipip",
    reverseScored: false,
    prompt: "让别人感到自在",
    source: "Make people feel at ease.",
  },
  { index: 36, dimension: "A", origin: "ipip", reverseScored: true, prompt: "说话尖刻", source: "Have a sharp tongue." },
  { index: 37, dimension: "A", origin: "ipip", reverseScored: true, prompt: "把别人批评得体无完肤", source: "Cut others to pieces." },
  {
    index: 38,
    dimension: "A",
    origin: "ipip",
    reverseScored: true,
    prompt: "怀疑别人有隐藏动机",
    source: "Suspect hidden motives in others.",
  },
  { index: 39, dimension: "A", origin: "ipip", reverseScored: true, prompt: "想方设法报复别人", source: "Get back at others." },
  { index: 40, dimension: "A", origin: "ipip", reverseScored: true, prompt: "侮辱别人", source: "Insult people." },
  { index: 41, dimension: "C", origin: "ipip", reverseScored: false, prompt: "总是做好准备", source: "Am always prepared." },
  { index: 42, dimension: "C", origin: "ipip", reverseScored: false, prompt: "注重细节", source: "Pay attention to details." },
  {
    index: 43,
    dimension: "C",
    origin: "ipip",
    reverseScored: false,
    prompt: "马上完成该做的事",
    source: "Get chores done right away.",
  },
  { index: 44, dimension: "C", origin: "ipip", reverseScored: false, prompt: "能执行自己的计划", source: "Carry out my plans." },
  {
    index: 45,
    dimension: "C",
    origin: "ipip",
    reverseScored: false,
    prompt: "制定计划并坚持执行",
    source: "Make plans and stick to them.",
  },
  { index: 46, dimension: "C", origin: "ipip", reverseScored: true, prompt: "浪费时间", source: "Waste my time." },
  {
    index: 47,
    dimension: "C",
    origin: "ipip",
    reverseScored: true,
    prompt: "很难开始工作",
    source: "Find it difficult to get down to work.",
  },
  {
    index: 48,
    dimension: "C",
    origin: "ipip",
    reverseScored: true,
    prompt: "只做最低限度的工作",
    source: "Do just enough work to get by.",
  },
  { index: 49, dimension: "C", origin: "ipip", reverseScored: true, prompt: "做事有始无终", source: "Don't see things through." },
  { index: 50, dimension: "C", origin: "ipip", reverseScored: true, prompt: "逃避自己的责任", source: "Shirk my duties." },
];

/** 全部量表种子：顺序同时决定安装时的创建顺序 */
export const ASSESSMENT_SEEDS: AssessmentSeed[] = [RIASEC_ASSESSMENT, IPIP_ASSESSMENT];

/** 按量表 code 取题库种子；未注册的 code 返回 undefined */
export function getQuestionSeeds(code: string): QuestionSeed[] | undefined {
  if (code === RIASEC_CODE) return RIASEC_QUESTIONS;
  if (code === IPIP_NEO_FFI_CODE) return IPIP_QUESTIONS;
  return undefined;
}

/** 作答链路按量表 code 下发锚点；两套量表均为 1–5 分但语义不同 */
export const ASSESSMENT_ANCHORS: Record<string, readonly AssessmentAnchor[]> = {
  [RIASEC_CODE]: [
    { value: 1, label: "非常不愿意" },
    { value: 2, label: "不愿意" },
    { value: 3, label: "不确定" },
    { value: 4, label: "愿意" },
    { value: 5, label: "非常愿意" },
  ],
  [IPIP_NEO_FFI_CODE]: [
    { value: 1, label: "非常不同意" },
    { value: 2, label: "不同意" },
    { value: 3, label: "不确定" },
    { value: 4, label: "同意" },
    { value: 5, label: "非常同意" },
  ],
};

/**
 * 按量表 code 取作答锚点（#289）：两套量表共用 1–5 量程，但语义不同
 * （兴趣问「愿不愿意」，人格问「同不同意」），锚点随量表下发而不是页面写死。
 * 未登记的 code 回退到兴趣量表锚点，只保证历史库里的量表仍可作答；
 * 新增量表必须在 `ASSESSMENT_ANCHORS` 登记语义（种子测试会拦住漏登记）。
 */
export function getAssessmentAnchors(code: string): readonly AssessmentAnchor[] {
  return ASSESSMENT_ANCHORS[code] ?? ASSESSMENT_ANCHORS[RIASEC_CODE];
}

/**
 * 近重复题组（#281）：同一张卷子至多抽到组内一题。
 *
 * 抽题逻辑在后续 Issue（每次 30 题的分层随机抽题）实现，本期只落常量并由
 * `validateAssessmentSeed` 校验「所有实测近重复题对都已被某个组覆盖」，
 * 避免以后加题时悄悄引入两道几乎一样的题。
 *
 * 实测口径：题干归一化后的字符二元组 Jaccard（见 `promptSimilarity`）。
 * - 0.60：管理一家零售门店 / 管理一家服装店（E）
 * - 0.33：记录货物的收货与发货情况 / 保存库存记录（C）
 * - 0.30：用手持设备盘点库存 / 用表格软件制作电子表格（C，词面撞 computer / using）
 * 后两对归入同一个「库存台账」组，因为卷内同时出现任意两题都会强化同一种作答倾向。
 */
export const NEAR_DUPLICATE_GROUPS: readonly (readonly number[])[] = [
  [52, 55],
  [18, 24, 56, 60],
];

/** 近重复判定阈值：达到这个相似度的题对必须被 `NEAR_DUPLICATE_GROUPS` 覆盖 */
export const NEAR_DUPLICATE_THRESHOLD = 0.45;

/** 题干汉字数范围（现有题最短 4 字、最长 20 字；上限留到 24 字，超了就该拆） */
export const PROMPT_MIN_HAN = 4;
export const PROMPT_MAX_HAN = 24;

/** 每维度最少官方题 / 原创题数量：分层抽样（每维官方 2–3 + 原创 2–3）的可行性前提 */
export const MIN_OFFICIAL_PER_DIMENSION = 3;
export const MIN_ORIGINAL_PER_DIMENSION = 3;

/**
 * 收入 / 学历 / 地位线索禁词（命题规则「不要考虑需要多少学历或能赚多少钱」）。
 *
 * 刻意不收单字「元」与「工资」：「组装电子元件」「核算员工工资」里的「元件 / 工资」是工作对象
 * 而不是收入线索，一刀切会把已授权题面判死。只拦具体金额与薪资/学历口径的说法。
 */
const FORBIDDEN_PROMPT_PATTERNS: readonly RegExp[] = [
  /\d+\s*元/,
  /薪资|薪水|薪酬|月薪|年薪|待遇|报酬/,
  /学历|文凭|学位|本科|硕士|博士/,
];

/** 题干归一化：全半角归一后只留汉字与数字字母（判重、近重复统一用这个口径） */
export function normalizePrompt(prompt: string): string {
  return prompt.normalize("NFKC").replace(/[^\p{Script=Han}0-9a-zA-Z]/gu, "");
}

/** 题干汉字数（用于长度规则） */
export function promptHanLength(prompt: string): number {
  return (prompt.match(/\p{Script=Han}/gu) ?? []).length;
}

/** 题干字符二元组集合 */
export function promptBigrams(prompt: string): Set<string> {
  const text = normalizePrompt(prompt);
  const grams = new Set<string>();
  if (text.length < 2) {
    if (text) grams.add(text);
    return grams;
  }
  for (let i = 0; i < text.length - 1; i += 1) grams.add(text.slice(i, i + 2));
  return grams;
}

/** 两个题干的字符二元组 Jaccard 相似度：0 = 无交集，1 = 完全一致 */
export function promptSimilarity(a: string, b: string): number {
  const left = promptBigrams(a);
  const right = promptBigrams(b);
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const gram of left) if (right.has(gram)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

/** 锚定职业 → 官方兴趣高码的查询函数（服务端用 `onet-data.ts` 实现；不传则只做「anchor 非空」检查） */
export type OnetInterestCodeLookup = (occupationTitle: string) => string | undefined;

/**
 * 种子自检：结构性规则 + #281 扩容后的新增规则。两适配器在落库/升级前调用，
 * 坏数据宁可在安装时报错，也不留半截题库（同一个函数保证两种数据库的校验口径完全一致）。
 *
 * 规则清单（反例单测见 `assessment-items.test.ts`）：
 * 1. 题数一致、题号 1..n 连续、维度归属合法、题干与英文原文非空（#221 既有）；
 * 2. 每个维度题数相等；
 * 3. 霍兰德每维度 `origin` 分布：官方题（`onet-*`）≥ 3 且原创题 ≥ 3（分层抽样的可行性前提）；
 * 4. 题干归一化后全局唯一；
 * 5. 题干 4–24 汉字、不含收入/学历/地位线索禁词；
 * 6. 原创题必须有 `anchor`，传了 `onetInterestCodeOf` 时还要命中 O*NET 快照且维度在兴趣高码前两位；
 * 7. 霍兰德同维度相似度 ≥ `NEAR_DUPLICATE_THRESHOLD` 的题对必须被 `NEAR_DUPLICATE_GROUPS` 覆盖；
 * 8. `itemsPerAttempt`（#282）：0 = 全量作答，或为正值、能被维度数整除（每维抽固定题数的前提）且不超过题库总量。
 *
 * 3 / 6 / 7 是霍兰德题库的专属规则；IPIP 大五只走通用结构、题面、维度均衡与 `itemsPerAttempt` 校验，
 * 不会因为缺少 O*NET 职业锚点或使用 IPIP 来源而误报。
 *
 * `onetInterestCodeOf` 由服务端注入（`onet.ts` 的 `onetInterestCodeOf`），避免把 92KB 的
 * O*NET 快照拖进客户端 bundle——两个学生端页面只 import `RIASEC_CODE`。
 */
export function validateAssessmentSeed(
  definition: AssessmentSeed,
  questions: readonly QuestionSeed[],
  onetInterestCodeOf?: OnetInterestCodeLookup
): void {
  if (!definition.code) throw new Error("测评种子缺少 code");
  if (definition.questionCount <= 0) throw new Error(`${definition.code} 的题数必须为正`);
  if (definition.questionCount !== questions.length) {
    throw new Error(`${definition.code} 声明的题数与题库不符：${definition.questionCount} vs ${questions.length}`);
  }
  // #282：每次作答量要么 0（全量作答），要么能被维度数整除（分层抽题每维抽固定题数）
  if (definition.itemsPerAttempt < 0) {
    throw new Error(`${definition.code} 的 itemsPerAttempt 不能为负：${definition.itemsPerAttempt}`);
  }
  if (
    definition.itemsPerAttempt > 0 &&
    (!Number.isInteger(definition.itemsPerAttempt) ||
      definition.itemsPerAttempt % definition.dimensions.length !== 0)
  ) {
    throw new Error(
      `${definition.code} 的 itemsPerAttempt（${definition.itemsPerAttempt}）必须能被维度数（${definition.dimensions.length}）整除`
    );
  }
  if (definition.itemsPerAttempt > definition.questionCount) {
    throw new Error(
      `${definition.code} 的 itemsPerAttempt（${definition.itemsPerAttempt}）不能超过题库总量（${definition.questionCount}）`
    );
  }

  const dimensionKeys = new Set<string>();
  for (const dimension of definition.dimensions) {
    if (!dimension.key || !dimension.label) throw new Error(`${definition.code} 的维度定义缺少 key 或 label`);
    if (dimensionKeys.has(dimension.key)) throw new Error(`${definition.code} 的维度 key 重复：${dimension.key}`);
    dimensionKeys.add(dimension.key);
  }

  const indexes = new Set<number>();
  const usedDimensions = new Set<string>();
  const byDimension = new Map<string, QuestionSeed[]>();
  const normalizedPrompts = new Map<string, number>();
  const isRiasec = definition.code === RIASEC_CODE;
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
    if (!["onet-mini", "onet-sf", "cn-original", "ipip"].includes(question.origin)) {
      throw new Error(`${definition.code} 第 ${question.index} 题的 origin 非法：${String(question.origin)}`);
    }

    const list = byDimension.get(question.dimension);
    if (list) list.push(question);
    else byDimension.set(question.dimension, [question]);

    // 题干归一化后全局唯一：翻译/创作撞题会让同一道题重复计分
    const normalized = normalizePrompt(question.prompt);
    if (!normalized) throw new Error(`${definition.code} 第 ${question.index} 题题干归一化后为空`);
    const duplicate = normalizedPrompts.get(normalized);
    if (duplicate !== undefined) {
      throw new Error(`${definition.code} 第 ${question.index} 题与第 ${duplicate} 题题干重复`);
    }
    normalizedPrompts.set(normalized, question.index);

    const hanLength = promptHanLength(question.prompt);
    if (hanLength < PROMPT_MIN_HAN || hanLength > PROMPT_MAX_HAN) {
      throw new Error(
        `${definition.code} 第 ${question.index} 题题干汉字数 ${hanLength} 超出 ${PROMPT_MIN_HAN}–${PROMPT_MAX_HAN}`
      );
    }
    for (const pattern of FORBIDDEN_PROMPT_PATTERNS) {
      if (pattern.test(question.prompt)) {
        throw new Error(`${definition.code} 第 ${question.index} 题题干含收入/学历/地位线索：${question.prompt}`);
      }
    }

    // 原创题必须可追溯：没有锚定职业就无法做维度归属的效度校验
    if (isRiasec && question.origin === "cn-original") {
      const anchor = question.anchor?.trim();
      if (!anchor) throw new Error(`${definition.code} 第 ${question.index} 题（原创）缺少锚定职业`);
      if (onetInterestCodeOf) {
        const interestCode = onetInterestCodeOf(anchor);
        if (!interestCode) {
          throw new Error(`${definition.code} 第 ${question.index} 题的锚定职业不在 O*NET 快照中：${anchor}`);
        }
        if (!interestCode.slice(0, 2).includes(question.dimension)) {
          throw new Error(
            `${definition.code} 第 ${question.index} 题的维度 ${question.dimension} 不在锚定职业 ${anchor} 的兴趣高码 ${interestCode} 前两位`
          );
        }
      }
    }
  }
  // 题号必须 1..n 连续：作答接口按题号存答案，跳号会让「已答 n 题 / 总 n 题」进度与实际不符
  for (let expected = 1; expected <= questions.length; expected += 1) {
    if (!indexes.has(expected)) throw new Error(`${definition.code} 题号不连续，缺少第 ${expected} 题`);
  }
  // 每个声明的维度都要有题：零题维度在计分里恒为 0 分，会把未作答与真实低分混为一谈
  for (const key of dimensionKeys) {
    if (!usedDimensions.has(key)) throw new Error(`${definition.code} 的维度 ${key} 没有对应题目`);
  }

  // 每维度题数相等 + origin 分布：两者共同决定「每张卷每维固定抽 5 题」能否成立
  const perDimensionCounts = new Set<number>();
  for (const dimension of definition.dimensions) {
    const list = byDimension.get(dimension.key) ?? [];
    perDimensionCounts.add(list.length);
    if (isRiasec) {
      const official = list.filter((question) => question.origin !== "cn-original").length;
      const original = list.filter((question) => question.origin === "cn-original").length;
      if (official < MIN_OFFICIAL_PER_DIMENSION) {
        throw new Error(
          `${definition.code} 的维度 ${dimension.key} 官方题不足 ${MIN_OFFICIAL_PER_DIMENSION} 道（实际 ${official}）`
        );
      }
      if (original < MIN_ORIGINAL_PER_DIMENSION) {
        throw new Error(
          `${definition.code} 的维度 ${dimension.key} 原创题不足 ${MIN_ORIGINAL_PER_DIMENSION} 道（实际 ${original}）`
        );
      }
    }
  }
  if (perDimensionCounts.size > 1) {
    throw new Error(
      `${definition.code} 各维度题数不相等：${definition.dimensions
        .map((dimension) => `${dimension.key}=${(byDimension.get(dimension.key) ?? []).length}`)
        .join(" / ")}`
    );
  }

  if (isRiasec) {
    // 近重复覆盖：阈值以上必须被 NEAR_DUPLICATE_GROUPS 包住，否则同卷可能抽到两道近乎一样的题
    const groupedPairs = new Set<string>();
    for (const group of NEAR_DUPLICATE_GROUPS) {
      for (let i = 0; i < group.length; i += 1) {
        for (let j = i + 1; j < group.length; j += 1) {
          groupedPairs.add(pairKey(group[i], group[j]));
        }
      }
    }
    const byIndex = new Map(questions.map((question) => [question.index, question]));
    for (const [dimensionKey, list] of byDimension) {
      for (let i = 0; i < list.length; i += 1) {
        for (let j = i + 1; j < list.length; j += 1) {
          const similarity = promptSimilarity(list[i].prompt, list[j].prompt);
          if (similarity < NEAR_DUPLICATE_THRESHOLD) continue;
          if (!groupedPairs.has(pairKey(list[i].index, list[j].index))) {
            throw new Error(
              `${definition.code} 维度 ${dimensionKey} 的第 ${list[i].index} / ${list[j].index} 题近重复（相似度 ${similarity.toFixed(2)}），` +
                `请并入 NEAR_DUPLICATE_GROUPS`
            );
          }
        }
      }
    }
    // 近重复组里的题号必须真实存在（抽取逻辑会按题号取值，写错就是运行时丢题）
    for (const group of NEAR_DUPLICATE_GROUPS) {
      for (const index of group) {
        if (!byIndex.has(index)) throw new Error(`${definition.code} 的近重复组包含不存在的题号：${index}`);
      }
    }
  }
}

function pairKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

