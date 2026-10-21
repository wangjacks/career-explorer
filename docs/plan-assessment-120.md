# 霍兰德题库扩容到 120 题 + 每次 30 题随机抽题 — 实施方案

> 状态：**方案待确认**，未开工。本文是实现前的设计说明；落地后「题库」的权威来源仍是 `src/lib/assessment-data.ts`，「抽题机制」的权威来源写进 `docs/architecture.md`（遵循「一条信息一个家」）。
> 关联现状：线上量表是 O*NET Mini-IP 30 题中文改编版（`riasec` / `Mini-IP-CN 1.0`），三表 `assessments` / `assessment_questions` / `assessment_results`，计分引擎 `assessment-scoring.ts`，作答链路 `src/app/api/shared/assessment/{start,answer,submit,results}`。

---

## 1. 目标与硬约束

| # | 目标 | 约束来源 |
|---|---|---|
| 1 | 题库 30 → **120 题**，每维度 **20 题** | 用户要求 |
| 2 | 每次测验**随机抽 30 题**，每维度 **5 题** | 保持与 Mini-IP 同口径（每维 5 题、原始分 5–25 → 0–100 标准分），教师端统计与三字码语义不变 |
| 3 | 新题与现有 30 题**不重合**（含语义近重复） | 用户要求；下方 §3 给出脚本核验证据 |
| 4 | 题目**真实可用、结果尽量准确** | 用户要求；§4 给出命题规则，§7 给出上线后区分度回收 |
| 5 | 按**数据库格式**入库（种子 + 两适配器行为一致） | 项目铁律：`db-sqlite.ts` / `db-mysql.ts` 必须同步 |
| 6 | 授权合规 | O*NET Tools Developer License（署名 + 「USDOL/ETA 未审核修改」声明 + 自行验证义务）；**不得**引入 SDS / Strong 等商业量表题面 |
| 7 | 不新增路由 | 因此 `src/proxy.ts` 的 `TEACHER_ALLOWED`、`docs/architecture.md` 权限表与两处「对账」路由计数注释**无需改动** |

**为什么是「120 题池 + 每次 30 题」而不是「120 题全做」**：全做要 16 分钟以上，学生完成率会掉；30 题保持现有 4 分钟体验，同时 4 倍题池能支撑**轮换**（重测不复用上一轮的题）与**平行卷**（不同学生拿到不同卷子，降低互相抄答案的可能）。

**为什么不直接上 CAT / IRT 自适应**：需要大样本标定数据，我们现在一次真实作答都没有；先做「分层随机 + 抽题快照落库」，等 §7 的数据攒够再谈自适应。

---

## 2. 题库构成（120 = 30 + 30 + 60）

| 来源 | 题号 | 数量 | 每维度 | 授权 |
|---|---|---|---|---|
| A. O*NET **Mini-IP**（现有，不动） | 1–30 | 30 | 5 | O*NET Tools Developer License（已署名） |
| B. O*NET **Interest Profiler Short Form** 的另外 30 题 | 31–60 | 30 | 5 | 同上（同一份官方 PDF，同一授权） |
| C. **本项目原创**中文题 | 61–120 | 60 | 10 | 本项目原创；职业信息锚定 O*NET Database 30.2（CC BY 4.0，已署名） |

**为什么 B 用官方 SF 而不是全部自己写**：Mini-IP 的 30 题本来就是 SF 60 题的子集（§3 已核验），另外 30 题是**同一套经过信效度检验的量表**、同一个 1–5「愿意做」量程、同一命题风格，直接补进来就能让「O*NET 官方题」占到题池一半，原创题的风险被稀释；每维度官方题 10 道，抽 5 题时可强制「官方题 2–3 道 + 原创题 2–3 道」，把不同卷子之间的难度差控制在可解释范围内（§5）。

**为什么 C 必须原创**：官方可用材料到 SF 60 题为止（Long Form / Computerized Interest Profiler 已退役，SDS、Strong 是商业量表，不得搬题）。要凑到 120 题，剩下的 60 题只能自己命题；为保证「真的在测那个维度」，每道原创题都**锚定一个真实 O*NET 职业**，并要求该职业的官方兴趣高码前两位包含该题维度（§4.3，可用单测自动校验）。

---

## 3. 去重核验（已跑脚本，非口头承诺）

做法：把官方 SF 60 题从 `Interest_Profiler.pdf`（v1，National Center for O*NET Development）逐字提取，与 `assessment-data.ts` 里 30 道题的 `source`（英文原文）做归一化比对（小写 + 去标点 + 折叠空白）。

结果：

- 现有 30 题**全部命中** SF 60 题，无一条对不上（`bank items not matched: 0`）→ 证实 Mini-IP ⊂ SF，也证实我们的翻译底本没走样；
- SF 中**未在现有题库出现**的正好 **30 题，每维度 5 题** → 即 §6.2 的 31–60；
- 原创 60 题与全部 60 道 O*NET 题做近重复扫描（中文按字符二元组 Jaccard、英文按词 Jaccard，同维度两两比），**相似度 ≥ 0.30 的只有 3 对，且全部落在 O*NET 内部**，原创题与任何现有题都不构成近重复：

| 相似度 | 维度 | 题目 A | 题目 B | 处理 |
|---|---|---|---|---|
| 0.60 | E | Manage a retail store（管理一家零售门店） | Manage a clothing store（管理一家服装店） | 同一张卷子**至多抽一题** |
| 0.33 | C | Keep shipping and receiving records（记录货物的收货与发货情况） | Keep inventory records（保存库存记录） | 同上 |
| 0.30 | C | Inventory supplies using a hand-held computer（用手持设备盘点库存） | Develop a spreadsheet…（词面撞 `computer`/`using`，中文不近） | 与上一条合并为一个「库存台账组」，同卷至多抽一题 |

→ 落地为常量 `NEAR_DUPLICATE_GROUPS`（§5.4），并写进单测：同维度相似度 ≥ 0.45 的题目对必须出现在该常量里，否则测试失败。这样**将来再加题也会自动被拦**。

---

## 4. 命题规则（保证「题目真的适用」）

### 4.1 形式规则（与现有 30 题保持一致）

1. **动宾短语**，无主语、无「我喜欢／我愿意」前缀（作答端统一问「你愿意做这件事吗」，1–5：非常不愿意 → 非常愿意）。
2. 长度 **6–20 个汉字**（现有题最短 4 字「作曲或编曲」，最长 20 字），一屏能读完，不需要滚动。
3. **一题一事**：不写「设计并销售一款产品」这类双动作题（会同时压 A 和 E，污染维度归属）。
4. **不用否定式、不用双重否定**（Mini-IP 原始量表没有反向题，`reverse_scored` 保持全 0）。
5. 不出现**收入、学历、社会地位**线索（官方指导语明确要求「不要考虑需要多少学历或能赚多少钱」），避免学生按「体面程度」而不是「兴趣」作答。
6. **中学生／大学生能想象**：优先校园生活、兼职、日常可见的职业场景；避免需要从业经验才能理解的表述（如「主持一次董事会」）。
7. 无性别／地域／民族刻板印象（例：不写「当护士照顾病人」这类隐含性别的表述，写「在病房里安慰并照护病人」）。

### 4.2 覆盖规则（保证维度内部不偏科）

每个维度的 20 题必须横跨该型的**活动族**，避免「20 题都在讲同一件事」：

| 维度 | 活动族（每族 2–4 题） |
|---|---|
| R 现实型 | 机械维修 / 建筑与工程 / 农林养殖 / 电子与制造 / 运输驾驶 / 户外与能源 / 手作工艺 / 动物 |
| I 研究型 | 自然科学实验 / 生命与医学 / 数理与算法 / 数据与建模 / 材料与工程研究 / 野外观察 / 社会问题研究 |
| A 艺术型 | 视觉与平面 / 造型与工艺 / 表演 / 音乐 / 影像 / 文字 / 设计与策展 |
| S 社会型 | 教学 / 辅导与咨询 / 照护 / 公益与社区 / 团队活动带领 |
| E 企业型 | 销售与推广 / 经营管理 / 谈判与说服 / 组织领导 / 金融 / 人力 |
| C 常规型 | 档案与记录 / 核对与审计 / 数据录入与整理 / 排程 / 流程与规范 |

### 4.3 效度规则（原创题必须可追溯）

- 每道原创题带一个 **`anchor`：真实 O*NET 职业名**（取自本地快照 `src/lib/onet-data.ts`，923 个职业，含官方兴趣高码）。
- 校验规则：**该职业 `interestCode` 的前两位必须包含该题维度**（例如「用摄影作品讲一个完整的故事」锚 `Photographers [RA]`，A 在第二位 → 通过；若锚到 `Legislators [ESC]` 的 S 题就会失败）。
- 这条规则由单测自动执行（读 `onet-data.ts` 比对），**命题人写错维度归属会直接红**，不靠人工自觉。
- `anchor` 与英文 `source` 一样**只留在种子文件里、不入库**（沿用现有约定：`source` 是译审与回溯用的原文，不进 `assessment_questions`）。

### 4.4 评审规则（上线前的人工把关）

1. 三人独立评审（指导教师 + 2 名同学）：每题判「维度归属是否认同」「中学生能否看懂」「是否愿意做」，三票里 ≥2 票认同归属才保留；
2. 争议题先入池但标 `origin='cn-original'`，靠 §7 的区分度数据决定去留；
3. 试测一个班（约 30–40 人）做**平行卷一致性**：同一批人间隔两周各做一次（抽到不同卷子），三字码首位一致率目标 ≥ 80%，六维标准分相关目标 ≥ 0.70。这一步同时满足 O*NET Developer License 的「自行验证」义务（见 `docs/plan-assessment.md` §2）。

> **执行状态（#284，2026-10-21）**：评审与试测均未开展，四项指标无数据，判据未通过。按 issue 的回退路径，60 道原创题整批排除在抽题池外（`SAMPLING_EXCLUDED_ORIGINS`），线上只抽 60 道 O*NET 官方题。逐题记录、指标结果、放行结论与复核日期见 `docs/assessment-validation.md`（权威落档处，本节不再复制数字）。

---

## 5. 抽题机制

### 5.1 核心决策：**确定性派生**，不是「每次随机」

抽题必须是**同一学生在同一轮作答里稳定不变**的，否则：`POST /answer` 收到一个题号时无从判断它属不属于这一轮（现有实现是 `bankIndexes.includes(questionIndex)`，题库变 120 后必须换成「本轮抽中的 30 题」）。

两种可选：

| 方案 | 优点 | 缺点 |
|---|---|---|
| A. 进页面就随机抽 + 立刻落草稿行 | 实现直观 | **破坏现有不变量**「`GET /start` 只读、不建空草稿行」（只点开又离开的学生会留下 `in_progress` 记录，教师端完成率与「进行中」判定都会被污染） |
| B. **确定性派生**：`draw = f(userId, assessmentId, poolFingerprint, attemptNo)` | `GET /start` 保持只读；任何路由各自重算都得到同一份卷子；可单测；轮换天然靠 `attemptNo` | 需要一个纯函数抽样器 + 指纹计算 |

**选 B**。派生种子用 `mulberry32`（纯函数、可注入 rng，便于测试），指纹 `poolFingerprint = 短哈希(排序后的 "index:version" 列表 + scale_version + 放行门排除来源)`——题库一改（加题、改题面版本、换量表版本、调整放行门），指纹变，卷子自动重派，不会拿旧卷子配新题库。

### 5.2 分层抽样规则（每张卷子的形状）

```
每维度 5 题（30 / 6），且：
  0) 放行门：只从 SAMPLING_EXCLUDED_ORIGINS 以外的来源抽题
     （#284 回退期排除 cn-original → 每维 10 道官方题，不适用来源配比）
  1) 排除集：上一轮已完成作答用过的题（读上一条 completed 结果的 items_json；无则空集）
  2) 来源配比：官方题（onet-mini + onet-sf，每维 10 道）抽 2 或 3 道，
     原创题（cn-original，每维 10 道）抽剩下的 3 或 2 道 —— 由 rng 决定，期望各半
     （仅在原创题已放行、进入抽题池时生效）
  3) 近重复组：同一组内至多抽 1 道（§3 的三对）
  4) 拼成 30 题后整体洗牌
  5) 顺序修整：不出现 3 题及以上连续同维度（做有限次交换，修不动就接受）
```

**降级阶梯**（池子不够时按序放宽，并打 warning 日志）：来源配比 → 排除集 → 近重复组。未启用放行门时每维池 20 题、排除上一轮 5 题后仍有 15 题，正常永远走不到降级；写出来是为了「题库被后台删题」时不至于 500。**#284 回退期每维只有 10 道官方题**：排除上一轮 5 题后，C / E 两维剩余题仍被近重复组挤占，第二轮起会稳定走到「放宽排除集」，这两维允许个别重题（其余四维仍完全换新），属预期行为。

### 5.3 抽题快照落库

`assessment_results` 新增 `items_json`：

- 草稿：**第一次 `POST /answer` 时**随草稿一起写入（`GET /start` 仍不落库）；
- 完成记录：提交时写入，作为**快照**的一部分——半年后回看，能确切知道当时做的是哪 30 题（与本项目「结果是快照而非实时计算」的既有原则一致），也是 §7 题目质量分析的唯一数据来源；
- 内容：`{"v":1,"pool":"<指纹>","indexes":[31,7,88,...]}`（**presentation 顺序**），解析与序列化函数落在 `assessment-sampling.ts`（#282 落地时的选择：抽样器与快照同文件，`assessment-flow.ts` 不参与解析，全仓只此一处），容忍 `null` / `'[]'` / 脏 JSON（旧数据一律视为「全库即本轮」），并**对索引去重**——脏快照里的重复题号会让计分引擎判定「题目序号重复」而抛错。

### 5.4 近重复组常量

```ts
/** 同卷至多抽一题（近重复，见方案 §3 的相似度扫描） */
export const NEAR_DUPLICATE_GROUPS: readonly (readonly number[])[] = [
  [/* 管理一家零售门店 */ 52, /* 管理一家服装店 */ 55],
  [/* 记录货物的收货与发货情况 */ 18, /* 用手持设备盘点库存 */ 24,
   /* 用表格软件制作电子表格 */ 56, /* 保存库存记录 */ 60],
];
```

（题号已随 #281 种子定稿固化在 `assessment-data.ts`；单测断言「同维度相似度 ≥ 0.45 的题对必须被某个组覆盖」。后两题与「库存台账」语义相关的三题归入同一组，因为卷内同时出现任意两题都会强化同一种作答倾向。）

### 5.5 重测与防抄

- **轮换**：`attemptNo` 递增 + 排除上一轮的 30 题 → 重测拿到的是另一张卷子（每维仍有 15 题可选，配比与近重复约束都还成立）。
- **防抄**：同班同一时刻不同学生的卷子不同（种子含 `userId`），照抄邻座答案会大面积落空；`GET /start` 依然**不下发 `dimension`**（现有口径，保留），学生看不出题目归属哪一型。

---

## 6. 完整题目清单

> `来源`：`mini` = 现有 Mini-IP（不改）｜`sf` = O*NET SF 新增 30 题｜`cn` = 本项目原创。
> `sf` 题的英文列是官方原文（逐字取自 `Interest_Profiler.pdf`）；`cn` 题的英文列是我们写的译注（供 `source` 字段做溯源与后续跨语言校验），`锚定职业` 是 §4.3 的 `anchor`（已通过 `onet-data.ts` 校验，60/60 命中且维度在兴趣高码前两位内）。

### 6.1 现有 30 题（题号 1–30，**一字不改**）

保持现状，仅补 `origin='onet-mini'`。题面见 `src/lib/assessment-data.ts`（权威来源），本文不重复抄录，避免两处漂移。

### 6.2 新增：O*NET SF 另外 30 题（题号 31–60）

| # | 维度 | 中文题干 | 官方英文原文 |
|---|---|---|---|
| 31 | R | 砌砖或铺贴瓷砖 | Lay brick or tile |
| 32 | R | 修理并安装门锁 | Repair and install locks |
| 33 | R | 在育苗场养殖鱼苗 | Raise fish in a fish hatchery |
| 34 | R | 调试并操作机器生产产品 | Set up and operate machines to make products |
| 35 | R | 扑灭森林火灾 | Put out forest fires |
| 36 | I | 调查一场火灾的起因 | Investigate the cause of a fire |
| 37 | I | 在生物实验室工作 | Work in a biology lab |
| 38 | I | 研究行星的运行规律 | Study the movement of planets |
| 39 | I | 发明一种糖的替代品 | Invent a replacement for sugar |
| 40 | I | 做化验以确诊疾病 | Do laboratory tests to identify diseases |
| 41 | A | 演奏一种乐器 | Play a musical instrument |
| 42 | A | 表演爵士舞或踢踏舞 | Perform jazz or tap dance |
| 43 | A | 绘制图画 | Draw pictures |
| 44 | A | 在乐队里唱歌 | Sing in a band |
| 45 | A | 剪辑影片 | Edit movies |
| 46 | S | 教一个人做健身操 | Teach an individual an exercise routine |
| 47 | S | 教孩子做体育运动 | Teach children how to play sports |
| 48 | S | 教听障人士手语 | Teach sign language to people who are deaf or hard of hearing |
| 49 | S | 协助开展团体心理辅导 | Help conduct a group therapy session |
| 50 | S | 在托幼机构照顾孩子 | Take care of children at a day-care center |
| 51 | E | 买卖股票和债券 | Buy and sell stocks and bonds |
| 52 | E | 管理一家零售门店 | Manage a retail store |
| 53 | E | 在诉讼中代理当事人 | Represent a client in a lawsuit |
| 54 | E | 经营一家美容院或理发店 | Operate a beauty salon or barber shop |
| 55 | E | 管理一家服装店 | Manage a clothing store |
| 56 | C | 用表格软件制作电子表格 | Develop a spreadsheet using computer software |
| 57 | C | 核算员工工资 | Calculate the wages of employees |
| 58 | C | 校对记录或表单 | Proofread records or forms |
| 59 | C | 登记房租收缴情况 | Record rent payments |
| 60 | C | 保存库存记录 | Keep inventory records |

### 6.3 新增：本项目原创 60 题（题号 61–120）

| # | 维度 | 中文题干 | 英文译注（`source`） | 锚定职业（`anchor`，O*NET 兴趣高码） |
|---|---|---|---|---|
| 61 | R | 拆装并保养自行车 | Disassemble, repair and maintain bicycles | Bicycle Repairers |
| 62 | R | 用 3D 打印机制作零件 | Make parts with a 3D printer | Computer Numerically Controlled Tool Operators |
| 63 | R | 布设并调试智能家居线路 | Install and debug smart-home wiring | Electricians |
| 64 | R | 在果园里修剪果树 | Prune fruit trees in an orchard | Farmworkers and Laborers, Crop, Nursery, and Greenhouse |
| 65 | R | 操作挖掘机进行土方作业 | Operate an excavator for earthwork | Operating Engineers and Other Construction Equipment Operators |
| 66 | R | 测绘地形并绘制施工图 | Survey terrain and draw construction plans | Surveying and Mapping Technicians |
| 67 | R | 组装并试飞无人机 | Assemble and test-fly a drone | Robotics Technicians |
| 68 | R | 在车间焊接金属构件 | Weld metal parts in a workshop | Welders, Cutters, Solderers, and Brazers |
| 69 | R | 维护风力发电设备 | Maintain wind turbine equipment | Wind Turbine Service Technicians |
| 70 | R | 训练犬只完成指定动作 | Train dogs to perform commands | Animal Trainers |
| 71 | I | 分析问卷数据并写出研究结论 | Analyze survey data and write up the findings | Data Scientists |
| 72 | I | 用编程语言实现一个算法 | Implement an algorithm in a programming language | Computer and Information Research Scientists |
| 73 | I | 观察并记录鸟类的迁徙行为 | Observe and record bird migration | Zoologists and Wildlife Biologists |
| 74 | I | 推导一道数学难题的多种解法 | Derive several solutions to a hard math problem | Mathematicians |
| 75 | I | 研究新型电池材料的充放电性能 | Study the charge-discharge performance of new battery materials | Materials Scientists |
| 76 | I | 用望远镜观测并记录星体变化 | Observe and log changes in celestial bodies with a telescope | Astronomers |
| 77 | I | 用传染病数据建立传播预测模型 | Build an epidemic-spread model from case data | Epidemiologists |
| 78 | I | 在实验室培养细胞并观察其变化 | Culture cells and observe their changes in a lab | Microbiologists |
| 79 | I | 研究城市交通拥堵的成因并提出改进方案 | Study the causes of urban traffic congestion and propose fixes | Urban and Regional Planners |
| 80 | I | 对比测试不同材料的隔热性能 | Comparatively test the thermal insulation of different materials | Chemical Technicians |
| 81 | A | 为一款产品设计外观造型 | Design the form and look of a product | Commercial and Industrial Designers |
| 82 | A | 用摄影作品讲一个完整的故事 | Tell a complete story through photographs | Photographers（RA） |
| 83 | A | 设计一套服装的款式与配色 | Design the cut and colour scheme of an outfit | Fashion Designers |
| 84 | A | 为动画角色设计形象与动作 | Design the look and movement of an animated character | Special Effects Artists and Animators |
| 85 | A | 排练并登台演出话剧 | Rehearse and perform in a stage play | Actors |
| 86 | A | 策划一场校园音乐会或文艺展演 | Program a campus concert or arts showcase | Producers and Directors |
| 87 | A | 用陶土或木材制作手工艺品 | Make handicrafts out of clay or wood | Craft Artists |
| 88 | A | 设计字体或手写艺术字 | Design typefaces or hand-lettering | Graphic Designers |
| 89 | A | 在舞台上完成一段即兴表演 | Perform an improvised scene on stage | Actors |
| 90 | A | 为展览布置灯光与参观动线 | Light an exhibition and plan its visitor flow | Set and Exhibit Designers |
| 91 | S | 给低年级同学讲解不会做的题目 | Explain problems that younger students cannot solve | Tutors |
| 92 | S | 陪伴并照顾独居老人 | Keep company with and care for an elderly person living alone | Personal Care Aides |
| 93 | S | 为新生做入学适应引导 | Help new students settle into school | Educational, Guidance, and Career Counselors and Advisors |
| 94 | S | 组织一场社区公益活动 | Organize a community service event | Community Health Workers |
| 95 | S | 在病房里安慰并照护病人 | Comfort and care for patients on a ward | Nursing Assistants（SRC） |
| 96 | S | 为有学习困难的学生做个别辅导 | Give one-to-one tutoring to students with learning difficulties | Special Education Teachers, Elementary School |
| 97 | S | 调解同学之间的矛盾与冲突 | Mediate conflicts between classmates | Social and Human Service Assistants |
| 98 | S | 为留守儿童开设兴趣课堂 | Run an interest class for left-behind children | Teaching Assistants, Preschool, Elementary, Middle, and Secondary School, Except Special Education |
| 99 | S | 在夏令营里带小组活动 | Lead small-group activities at a summer camp | Recreation Workers |
| 100 | S | 接听心理援助热线并倾听来电者 | Listen to callers on a psychological helpline | Mental Health Counselors |
| 101 | E | 为社团活动拉赞助 | Raise sponsorship for a club event | Fundraisers |
| 102 | E | 策划一场直播带货并担任主播 | Plan and host a live-commerce stream | Advertising and Promotions Managers |
| 103 | E | 带领团队完成创业项目路演 | Lead a team through a startup pitch | Chief Executives |
| 104 | E | 说服别人接受自己的方案 | Persuade others to accept your proposal | Public Relations Specialists |
| 105 | E | 为一个品牌谈下代言合作 | Land a brand endorsement deal | Marketing Managers |
| 106 | E | 竞选学生会主席并做竞选演说 | Run for student-union president and give a campaign speech | Legislators |
| 107 | E | 制定一家门店的月度促销计划 | Draft a store's monthly promotion plan | Marketing Managers |
| 108 | E | 为客户介绍理财产品并促成签约 | Present financial products to clients and close the deal | Securities, Commodities, and Financial Services Sales Agents |
| 109 | E | 招募并面试新的团队成员 | Recruit and interview new team members | Human Resources Specialists |
| 110 | E | 为一个新产品开拓销售渠道 | Open sales channels for a new product | Sales Managers |
| 111 | C | 把纸质档案整理归档并编号 | Sort, file and number paper records | File Clerks |
| 112 | C | 核对报销单据是否齐全合规 | Check reimbursement documents for completeness and compliance | Bookkeeping, Accounting, and Auditing Clerks |
| 113 | C | 用表格登记班级每天的考勤 | Log the class's daily attendance in a spreadsheet | Payroll and Timekeeping Clerks |
| 114 | C | 按固定模板整理会议纪要 | Write up meeting minutes using a fixed template | Secretaries and Administrative Assistants, Except Legal, Medical, and Executive |
| 115 | C | 盘点并登记实验室器材的借还 | Count and log the lending of lab equipment | Library Assistants, Clerical |
| 116 | C | 编制一份月度收支明细表 | Compile a monthly income-and-expense statement | Bookkeeping, Accounting, and Auditing Clerks |
| 117 | C | 为一批文件建立索引和检索目录 | Build an index and catalogue for a batch of documents | Library Technicians |
| 118 | C | 按排班表安排成员的值班顺序 | Arrange duty shifts from a rota | Production, Planning, and Expediting Clerks |
| 119 | C | 录入并校验一批客户信息 | Key in and verify a batch of customer records | Data Entry Keyers |
| 120 | C | 整理并维护标准操作流程文档 | Maintain standard operating procedure documents | Document Management Specialists |

**原创题的本土化取向**（相对 O*NET 的美国职场语境）：91/98/99/106/113 直接用校园与假期场景，62/67/102 覆盖 3D 打印、无人机、直播带货这类学生熟悉的新业态，92/94/98 覆盖中国语境下的养老、社区公益与留守儿童——这些是官方 60 题完全没有覆盖、但对学生真实可感的活动，也是「题目真正适用」的主要增益点。

---

## 7. 上线后的题目质量回收（保证「结果尽量准确」的长期机制）

抽题快照落库后，每张卷子的「哪 30 题 + 各题作答 + 六维得分」都可复原，于是可以做真正的题目分析（只读，不改学生数据）：

| 指标 | 口径 | 处置阈值 |
|---|---|---|
| 题目均值 / 标准差 | 单题 1–5 作答 | 均值 < 1.6 或 > 4.4（天花板／地板题）→ 换题 |
| 校正题目-总分相关 r_it | 单题 vs 同维度其余 4 题总分（点二列） | r_it < 0.30 → 换题 |
| 维度内部一致性 α | 每维度 5 题（按卷子分组） | α < 0.55 的卷子形态 → 复查该维度题池 |
| 来源差异 | 官方题 vs 原创题的同维度均值差 | 差 > 0.5 分 → 该批原创题整体复评 |

- 样本量门槛：单题累计作答 ≥ 50 次才纳入判定（否则噪声大于信号）。
- #284 回退期原创题不进抽题池，单题分析只覆盖官方题；复评原创题前须先按 §4.4 恢复放行（否则全量作答也抽不到原创题）。
- 落地形式：`scripts/assessment-item-stats.mjs`（只读脚本，输出 CSV）；要不要做管理端页面等数据量起来再议。
- 换题走「新增题号 + 停用旧题」而不是改题面：`assessment_questions.version` 自增、旧题号保留，历史快照永远可解释。
- 每次换题都要重跑 §3 的近重复扫描与 §4.3 的锚定校验（单测已覆盖）。

---

## 8. 数据库与迁移

### 8.1 新列（两适配器同步，遵循既有 `PRAGMA table_info` / `columnExists` 补列写法）

| 表 | 新列 | 默认 | 用途 |
|---|---|---|---|
| `assessments` | `items_per_attempt INTEGER NOT NULL DEFAULT 0` | `0` | 每次抽题数；**0 = 全量作答**（给后续 IPIP-120 这类量表留口子），`riasec` 设 30 |
| `assessment_questions` | `origin TEXT NOT NULL DEFAULT 'cn-original'` | `cn-original` | `onet-mini` / `onet-sf` / `cn-original`，分层抽样与 §7 分来源分析都靠它 |
| `assessment_results` | `items_json TEXT NOT NULL DEFAULT '[]'` | `'[]'` | 本轮抽题快照（presentation 顺序）；`[]` = 旧数据（全库即本轮） |

`assessments.question_count` 语义明确为**题库总量**（120），每次作答量由 `items_per_attempt`（30）表达——现在这两个概念是同一个列，扩库后必须拆开，否则测评中心会显示「120 题」。

### 8.2 种子升级路径（生产库已有 30 题，不能只靠「空库补种」）

现有 `seedAssessments()` 的口径是「题库非空一律不碰」，所以扩库必须加一条**只增不改**的升级：

```
upgradeAssessmentBank()：
  1. 对每个种子量表：按 question_index 找出库里缺失的题号 → INSERT（31–120）
  2. 已存在的题号：**只回填 origin**，绝不 UPDATE prompt（后台维护过的题面神圣不可侵犯）
  3. 定义级字段（name / question_count / scale_version / attribution /
     license_text / disclaimer）仅在 scale_version 与种子不一致时整体更新
  3b. items_per_attempt（#282）单独补齐：它与 scale_version 无关，而生产库在 #281
      时就已是 RIASEC-CN 2.0，走 3 的门永远不触发，不回填就停在补列默认值 0（整库作答）
  3c. license_text（#284）同版本库与种子不一致时只刷新这一列：授权/放行状态文案与版本号
      无关，但不能连带覆盖后台维护的 name / attribution
  4. 落库前跑 validateAssessmentSeed（新版校验，见 8.3）
  5. 全程一个事务；SQLite / MySQL 两适配器行为一致，用同一组测试覆盖
```

`scale_version`：`Mini-IP-CN 1.0` → **`RIASEC-CN 2.0`**（量表已不是纯 Mini-IP，名字也要改：`霍兰德职业兴趣测评（120 题库）`）。**名字里不写「每次 30 题」**：§5 的抽题与 #283 的题量文案落地前，学生作答的就是全库 120 题，把未实现的卷量写进量表名会与行为矛盾；等抽题落地再随下一个 `scale_version` 一起改。`license_text` 必须补两句：新增 30 题同样出自 O*NET SF；61–120 为本项目原创，其职业信息参照 O*NET Database（CC BY 4.0）。§4.4 的专家评审与班级试测是 #284 的上线判据，做完之前文案只能写「正式启用前**须**完成」，不得写成已经发生；判据未通过时另须写明原创题当前不参与抽题（现状与记录见 `docs/assessment-validation.md`）。

### 8.3 `validateAssessmentSeed` 校验升级

现有规则（题数一致、题号 1..n 连续、维度归属、题干非空、`source` 非空）保留，新增：

1. `questionCount === questions.length`（120）；`itemsPerAttempt > 0` 时必须能被维度数整除，且 `≤` 每维度题数 × 维度数；
2. **每维度题数相等**（20），且 `≥ itemsPerAttempt / 维度数 × 4`（保证轮换空间）；
3. 每维度 `origin` 分布：`onet-*` ≥ 3 且 `cn-original` ≥ 3（分层抽样的可行性前提）；
4. 题干归一化后**全局唯一**；同维度字符二元组 Jaccard ≥ 0.45 的题对必须被 `NEAR_DUPLICATE_GROUPS` 覆盖；
5. `cn-original` 题必须有 `anchor`，且 anchor 在 `ONET_OCCUPATIONS` 中存在、`interestCode` 前两位包含该题维度；
6. 题干长度 4–24 汉字，不含「元／薪资／学历／文凭」等 §4.1 第 5 条禁词。

### 8.4 备份 / 恢复与旧数据兼容

- `BackupData` 三张表的行类型加新列；恢复时旧备份缺字段 → `items_per_attempt ?? 0`、`origin ?? 'cn-original'`、`items_json ?? '[]'`（沿用现有「旧备份缺字段一律容忍」的口径）。**回填值取列默认值而不是种子的 30**：备份里没有这一列意味着它来自 #282 之前，当时的行为就是整库作答，先按 0 恢复、再由 `upgradeAssessmentBank()` 的 3b 补成种子口径，避免「恢复出一个从未存在过的卷量」；
- **在途草稿**（升级时还没答完的学生）：`items_json` 为空 → 本轮卷子 = 「已作答题号 ∪ 确定性补抽到每维 5 题」。计分引擎按各维度**实际已答题数**做 0–100 折算（`standardizeLinear` 已经是这个口径），所以即使某维度多答了几题也不会算错，学生已答的题一道都不作废；
- 历史完成记录不动：`items_json='[]'` 读作「当时做的是全库 30 题」，结果页与教师端统计照常。

---

## 9. 代码改动清单（逐文件）

| 文件 | 改动 |
|---|---|
| `src/lib/assessment-data.ts` | 题库 30 → 120；`QuestionSeed` 加 `origin` / `anchor`；`RIASEC_ASSESSMENT` 加 `itemsPerAttempt: 30`、改 `questionCount: 120` / `name` / `scaleVersion` / `licenseText`；新增 `NEAR_DUPLICATE_GROUPS`；`validateAssessmentSeed` 升级（§8.3） |
| `src/lib/assessment-sampling.ts`（新） | 纯函数：`poolFingerprint()`、`deriveDrawSeed()`、`mulberry32()`、`drawItems()`、`parseItemsSnapshot()` / `buildItemsSnapshot()`、`planAttempt()`；无 I/O、可注入 rng。**`items_json` 的解析与序列化都只在这一处**（`assessment-flow.ts` 不加解析入口，避免两处漂移） |
| `src/lib/assessment-attempt.ts`（新） | 四个路由共用的「本轮口径」装载：一次读题库 + 草稿 + 历史结果，算出 `attemptNo`、排除集、`planAttempt` 结果、`itemsJson` 快照与本轮题目清单；路由不各写一套推导 |
| `src/lib/assessment-flow.ts` | **不改**：`answerProgress` / `firstUnansweredIndex` / `resumeIndex` 签名本来就是「传入题号集合 + 作答映射」，#282 只在调用方把全库题号换成本轮题号 |
| `src/lib/db.ts` | 三个 Row 接口加列；`upsertAssessmentDraft(userId, assessmentId, answersJson, itemsJson)` 加参；`completeAssessmentResult` 入参加 `itemsJson`；`BackupData` 三张表类型同步 |
| `src/lib/db-sqlite.ts` / `src/lib/db-mysql.ts` | 补列迁移（两库同写法）；`upgradeAssessmentBank()`；草稿/完成记录读写带 `items_json`；备份导出与恢复 INSERT 加列并容忍旧备份 |
| `src/app/api/shared/assessment/start/route.ts` | 派生本轮 30 题 → 下发 `questions`（presentation 顺序）+ `questionCount: 30` + 新增 `poolSize: 120`；草稿有有效 `items_json` 时以它为准；`resumeIndex` 按本轮算 |
| `src/app/api/shared/assessment/answer/route.ts` | 校验 `questionIndex ∈ 本轮抽题`（不再是全库）；首次作答把 `items_json` 一起写入草稿；进度按本轮 30 题 |
| `src/app/api/shared/assessment/submit/route.ts` | 缺答判定按本轮 30 题；计分时 `questions` 只传本轮抽中的题；快照写 `items_json`；审计 `metadata` 加 `attemptNo` 与抽题指纹（**不加作答内容**，沿用现有隐私口径） |
| `src/app/api/shared/assessment/results/route.ts` | 量表级 `questionCount` = 每次作答题数（30），新增 `poolSize`（120）与 `itemsPerAttempt`；每条记录带自己的 `questionCount`（快照索引长度，旧数据回退作答条数）；`inProgress` 按本轮题号算，避免「上次答到 12/120」 |
| `src/lib/assessment-center.ts` | **不改**：它的 `questionCount` / `inProgress.total` 全部来自 `/results`，接口换成 30 口径后卡片与 `estimateMinutes`（30 题 ≈ 4 分钟）自动跟着走 |
| `src/app/dashboard/student/assessment/page.tsx`、`.../quiz/page.tsx`、`AssessmentResultCard.tsx` | **本 Issue 不动**：页面显示的 30 来自接口，语义已正确；「每次 30 题 / 题库 120 题」的双口径文案与「本次题目为随机抽取」说明归 #283（题量口径展示），混在这里改会让抽题 Issue 的 diff 里出现文案与行为两类变更 |
| `scripts/validate-assessment.mjs` | #282 的连带修正：读 `items_per_attempt`（旧库/旧导出缺失按 0），抽样口径下 α / CITC 必然 0 样本，报告改为直接写明「不可计算 + 需全量作答数据」，不再输出一张全是「无法计算」的表 |
| `src/lib/demo-seed.ts`（#253 合并时对账） | 演示班级的测评数据改走同一套抽题：`buildAssessment` 用 `drawItems` 出本轮卷子、`buildItemsSnapshot` 写快照，completed 答满本轮、draft 只答本轮呈现顺序的前缀（可被真人续答），计分只传本轮抽中题。留成整库 120 题会让演示数据的题量与真实学生不一致 |
| `scripts/assessment-item-stats.mjs`（新，§7） | 只读统计脚本，输出 CSV |

**不动**：计分引擎（`assessment-scoring.ts` 已经与题量无关）、职业匹配（`assessment-match.ts` 按六维标准分算，与题目无关）、教师端统计与导出（读 `type_code` / `scores_json`）、`src/proxy.ts`、权限表、路由计数。

**与第二套量表（IPIP NEO-FFI，#290）的关系**：它以 `items_per_attempt = 0` 落库 = 整库 50 题一轮，`planAttempt` 在算每维题数之前就返回整库，抽题与降级逻辑对它空转；两套量表共用 `assessment_results`，而 `attemptNo` 与排除集都按 `(user_id, assessment_id)` 各自派生，做霍兰德的重测不影响大五的轮次，反之亦然。

---

## 10. 测试计划

新增：

- `src/__tests__/assessment-items.test.ts`：120 题 / 每维 20 题 / 题号 1–120 连续；题干归一化唯一；同维度近重复扫描（≥0.45 必须在 `NEAR_DUPLICATE_GROUPS` 里）；`origin` 分布（mini 30 / sf 30 / cn 60，每维 onet ≥ 8、cn ≥ 10）；`cn` 题 anchor 存在于 `onet-data.ts` 且维度在兴趣高码前两位；题干长度与禁词；**现有 30 题的题面与维度逐题快照比对**（防止误改已授权题面）
- `src/__tests__/assessment-sampling.test.ts`：每卷 30 题、每维 5 题、无重复；来源配比 ∈ {2,3}；近重复组同卷至多一题；同种子确定性、不同 `userId` / `attemptNo` 得到不同卷子；1000 次抽样每维每题被抽中频率均匀（±3σ）；排除集生效（重测不复发上一轮题目）；无 3 连同维度；降级阶梯（人为缩小池子）不抛错

修改：

- `assessment-api.test.ts`：30 → 抽中 30/120；`answer` 拒绝**本轮之外**的合法题号（新边界）；两个学生拿到不同卷子；重测卷子不含上一轮题目；旧草稿（`items_json='[]'`）续答与提交不丢已答题
- `assessment-db.test.ts`：两适配器一致的升级路径——库里已有 30 题（含被「后台改过」的题面）时，升级后变 120 题、`prompt` 未被覆盖、`origin` 回填正确、`question_count`/`items_per_attempt`/`scale_version` 同步；备份含新列往返一致；旧备份缺列可恢复
- `assessment-center.test.ts`：`questionCount=30` + `poolSize=120`，耗时估算仍 4 分钟

门禁：`npm test` + `npm run lint` + `npm run build` 全绿（CI 的 `check` 任务）。

---

## 11. 文档与铁律检查点

- `docs/architecture.md`：三张表的列说明加新列；「量表进库」那段改写为**120 题库 / 每次 30 题 / 分层确定性抽题 / 近重复组 / 只增不改的升级路径**；备份段落补「新列缺字段容忍」；表结构与题库种子的「对账」注释同步（`src/lib/assessment-data.ts` ↔ `assessment-db.test.ts` ↔ `assessment-items.test.ts`）
- `docs/overview.md`：`assessment-*` 模块描述补「随机抽题」
- `docs/plan-assessment.md`：§1.1 补一行「已扩到 120 题库；每次作答仍是全库 120 题，每次 30 题待 §5 抽题落地」，指向 architecture.md（不复制细节）
- 路由计数 / `TEACHER_ALLOWED`：**无变化**（不新增路由），提交前仍要复核两处对账注释
- 授权：结果页与作答页继续展示 `attribution` / `licenseText` / `disclaimer`（文案随 §8.2 更新），O*NET 署名与「未经审核」声明不得删

---

## 12. 分期与 Issue 拆分（milestone `v3.0.0`，标签按 `docs/issue-standard.md`）

| 期 | Issue 标题 | 标签 | 内容 | 依赖 |
|---|---|---|---|---|
| 1 | `[P1-B] 霍兰德题库扩容到 120 题与只增不改的种子升级` | `type:feature` `priority:P1` `area:student` | 90 道新题 + `origin` 列 + 校验升级 + 两适配器升级路径 + 题目质量单测 + 文档 | — |
| 2 | `[P1-B] 每次 30 题的分层随机抽题与作答口径` | `type:feature` `priority:P1` `area:student` | `assessment-sampling.ts` + `items_per_attempt` / `items_json` + 四个路由改造 + 旧草稿兼容 + 抽题单测 | 期 1 |
| 3 | `[P2-F] 测评中心与作答页展示「每次 30 题 / 题库 120 题」` | `type:feature` `priority:P2` `area:student` | 文案与题量展示（可与期 2 合并提交，若拆开则单独验收） | 期 2 |
| 4 | `[P2-B] 题目质量回收：按抽题快照做区分度分析并淘汰弱题` | `type:feature` `priority:P2` `area:student` | 只读统计脚本 + 阈值 + 换题流程；需要真实作答量，上线后运营 | 期 2 |

期 1 与期 2 可以合成一个 PR（改动集中在同一批文件），但**必须分两个 commit**：题库数据与抽题机制的评审关注点完全不同。期 3、4 单独走。

**排期估算**：期 1 约 1.5 天（题目已在本文定稿，主要是种子格式 + 校验 + 升级路径 + 测试）；期 2 约 1.5 天（抽样器 + 四路由 + 兼容 + 测试）；期 3 半天；期 4 半天（脚本）+ 上线后持续。

---

## 13. 风险与取舍

| 风险 | 影响 | 处置 |
|---|---|---|
| 抽题带来的**形式差异**（不同卷子难度不同） | 六维标准分有 ±几分抖动，极端情况下三字码第 3 位可能翻 | 每维固定 5 题、来源配比 2–3、近重复组约束；§7 区分度回收淘汰弱题；可选增强：前两位标准分差 < 5 时在结果页提示「这两个类型很接近」（**建议单开 Issue，不在本期**） |
| 60 道原创题**未经实证标定** | 个别题可能测不准 | 全部标 `origin='cn-original'`，可单独统计与整批替换；§4.4 试测 + §7 阈值 |
| 生产库升级时**在途草稿** | 学生已答的题可能不在新卷子里 | 「已答 ∪ 补抽」兼容规则（§8.4），一道不作废；计分按实际已答数折算 |
| 授权合规 | O*NET Developer License 要求署名 + 自行验证 | 署名与免责声明继续随量表下发；`license_text` 增补原创题声明；§4.4 的试测即「自行验证」动作 |
| 题面被后台改坏 | 维度归属失真 | 升级路径**只增不改**；单测对现有 30 题做题面快照比对；`version` 列自增可追溯 |

**明确不做**：不新增管理端题库维护页（题库仍由种子维护，避免权限表与对账注释连锁改动）；不改计分引擎与职业匹配算法；不动教师端统计口径；不上 CAT / IRT（数据量不足）；不引入任何商业量表题面。
