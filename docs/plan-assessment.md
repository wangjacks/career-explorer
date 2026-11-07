# 生涯测评模块 — 方案与选型报告

> 写给项目组：本文是「给 Career Explorer 新增生涯测评功能」的方案文档，包含**选哪些测评、权威免费网址、版权能不能用、怎么落到本项目、分几期做**。
> 所有网址已于 2026-10-11 实测可达（见文末附录）。若本方案被采纳，路线图请同步更新到 `docs/overview.md`（它才是路线图的权威来源）。

---

## 0. 一页速览（先看这里）

**一句话结论：** 兴趣测评用美国劳工部 O*NET 的**霍兰德 RIASEC** 量表（唯一「权威 + 免费 + 明确允许我们改写进系统」的选择），性格测评用**大五人格**（IPIP 公有领域题库），价值观/能力走国内**学职平台**。**MBTI 一律不能用**——它是商业量表，我们无权把题目搬进系统。

**四层测评体系（建议最终形态）：**

| 层次 | 回答学生的什么问题 | 选用的测评 | 免费 | 能否自建进本系统 |
|---|---|---|---|---|
| ① 兴趣 | 我喜欢做什么？ | 霍兰德 RIASEC（O*NET Interest Profiler） | ✅ | ✅ 可（走 Developer License） |
| ② 性格 | 我是什么样的人？ | 大五人格（IPIP-NEO）/ VIA 优势 | ✅ | ✅ 可 / ⚠️ 有条件 |
| ③ 价值观 | 我看重什么？ | 职业价值观测评（学职平台） | ✅ | ⚠️ 建议外链 |
| ④ 能力与准备度 | 我能做什么？我准备好了吗？ | 学职平台能力测评 + 生涯适应力 CAAS | ✅ | ⚠️ 建议外链 |

**三条红线（务必先看第 2 节）：**

1. **不用 MBTI**：名称和题目都是 The Myers-Briggs Company 的商标与版权资产。
2. **O*NET 有两种授权，选错了就侵权**：原样转载用 CC BY-ND；要**翻译成中文并改题目**必须走 **O*NET Tools Developer License**（免费、需署名）。
3. **推荐职业要用 O*NET 数据库**（CC BY 4.0，可自由使用），它里面有 900+ 职业的六型兴趣分数。

---

## 1. 测评清单（按层次，含权威免费网址）

### ① 兴趣类 —— 最核心，也是本项目的主线

#### 1.1 霍兰德职业兴趣测评 / O*NET Interest Profiler ⭐ 首选

- **测什么**：六个兴趣类型 —— 现实型 R / 研究型 I / 艺术型 A / 社会型 S / 企业型 E / 常规型 C（即 RIASEC 六边形）。
- **权威性**：美国劳工部就业与培训署（USDOL/ETA）开发，有完整的信效度报告与使用手册，是国际生涯辅导的主流工具。
- **题量与耗时**：共两版 ——
  - **Mini-IP：30 题**（网页/手机端，约 10 分钟）
  - **IP Short Form：60 题**（纸笔版 PDF，约 20 分钟）
- **本项目落地（#281）**：题库已扩到 **120 题**（现有 Mini-IP 30 题一字不改 + SF 其余 30 题中译 + 本项目原创 60 题）；**当前每次作答仍是全库 120 题**，「每次 30 题」的分层随机抽题属后续 Issue（#282），题量文案展示见 #283。题库构成、只增不改的升级路径与种子校验规则见 `docs/architecture.md`「职业测评数据层（#221）」，题面与命题规则见 `docs/plan-assessment-120.md`（不在此重复）。
- **结果能干什么**：六型得分 → 生成**霍兰德三字码**（如 SIA）→ 直接对照 O*NET 里 900+ 个职业。
- **网址**：
  - 官方介绍页（含两版对比）：https://www.onetcenter.org/IPSF.html
  - 在线免费作答（学生可直接试）：https://www.mynextmove.org/explore/ip
  - 60 题纸笔版 PDF：https://www.onetcenter.org/dl_tools/ipsf/Interest_Profiler.pdf
  - 六型 × 职业对照表 PDF：https://www.onetcenter.org/dl_tools/ipsf/IP_Career_Listings.pdf
  - 授权说明页：https://www.onetcenter.org/license_tools.html
  - 开发者注册页：https://www.onetcenter.org/developers.html

> **为什么是它**：它是本案唯一同时满足「权威机构出品 + 完全免费 + 授权明确允许二次开发」的量表，其余同级别工具（SDS、Strong）都是付费商业量表。

#### 1.2 O*NET 职业数据库（做「职业推荐」的数据底座）

- **是什么**：美国劳工部的职业信息数据库，31.0 版覆盖 900+ 职业，其中 `Interests` 表给出每个职业的 **RIASEC 六型分数**。
- **用途**：学生测出三字码后，本地算匹配度 → 推荐职业 / 专业方向，**不需要联网调 API**（国内网络下这一点很关键）。
- **授权**：**CC BY 4.0**，可自由复制和改编，署名即可。
- **网址**：
  - 数据库下载页：https://www.onetcenter.org/database.html
  - 数据库授权页：https://www.onetcenter.org/license_db.html

#### 1.3 国内权威渠道：学职平台（教育部学信网）

- **是什么**：教育部学生服务与素质发展中心建设的「全国大学生学业与职业发展平台」，含**职业兴趣测评、职业价值观测评、批判性思维测评、科学研究能力测评**等，面向在校大学生免费。
- **用法建议**：做成**外链推荐**（学校已有权威渠道，不必自己复刻），作为我们系统的补充。
- **网址**：
  - 测评入口：https://xz.chsi.com.cn/survey/index.action
  - 职业探索：https://xz.chsi.com.cn/occupation/index.action
  - 平台首页：https://xz.chsi.com.cn/

#### 1.4 商业量表（了解即可，**不要搬题**）

| 量表 | 全称 | 状态 |
|---|---|---|
| SDS | Self-Directed Search（自我指导搜索，Holland 本人编制） | 商业，PAR 出版，需购买 |
| Strong | Strong Interest Inventory | 商业，需认证施测师 |

### ② 性格类

#### 2.1 大五人格 / Big Five（IPIP 题库）⭐ 性格层首选

- **测什么**：开放性、尽责性、外向性、宜人性、神经质。当代人格心理学公认的主流模型。
- **权威性与授权**：**IPIP（国际人格题库）为公有领域**，可自由使用；IPIP-NEO-120 是常用的 120 题版本。
- **网址**：
  - IPIP 官方题库（Oregon Research Institute）：https://ipip.ori.org/
  - IPIP-NEO 计分键：https://ipip.ori.org/newNEOKey.htm
  - SAPA 项目（可免费在线测大五）：https://www.personality-project.org/
  - BFI-2（大五问卷第二版，作者主页）：https://www.ocf.berkeley.edu/~johnlab/
- **注意**：`ipip.ori.org` 的 TLS 证书配置较旧，部分浏览器/网络会报警告；实测可访问。

#### 2.2 VIA 性格优势测评

- **测什么**：24 项性格优势（积极心理学取向，Martin Seligman 团队）。
- **授权**：个人使用免费；**商业集成需另行授权**，适合外链而非自建。
- **网址**：https://www.viacharacter.org/survey/account/register

#### 2.3 HEXACO 人格问卷（备选）

- **测什么**：在五大之外多一个「诚实—谦逊」维度。
- **授权**：非商业/研究用途免费，官网注册获取。
- **网址**：https://hexaco.org/hexaco-inventory

#### 2.4 MBTI —— ❌ 明确不采用

- MBTI 是**商标 + 版权双保护**的商业量表，官方明确限制未经授权的复制与再分发；网上流传的「免费版 MBTI」几乎都无授权。
- 如果学校心理健康中心已购买正版，可以**引导学生去学校渠道做**，但我们的系统里不能出现 MBTI 题目或自称「MBTI 测评」。
- 官方信息：https://www.myersbriggs.org/ ｜ 商业公司：https://www.themyersbriggs.com/
- 同类注意：**16Personalities 免费但非权威心理测量工具**（商业公司的娱乐化产品），可作为学生自娱，不应写进教学环节。https://www.16personalities.com/

### ③ 价值观类

| 测评 | 说明 | 状态 / 网址 |
|---|---|---|
| 职业价值观测评（学职平台） | 中文、权威、免费 | https://xz.chsi.com.cn/survey/index.action |
| O*NET Work Importance Locator | 美国劳工部工作价值观工具 | ⚠️ **已退役**（仅存档），不建议作为新建基础 |
| 舒伯工作价值观量表 WVI / 明尼苏达 MIQ | 学术经典 | 商业，需购买 |
| 职业锚（Career Anchors, Schein） | 8 种职业锚，管理学界经典 | 需购买问卷手册；网上自评版非官方 |

### ④ 能力与生涯准备度

| 测评 | 说明 | 状态 / 网址 |
|---|---|---|
| 批判性思维测评 / 科学研究能力测评（学职平台） | 中文、免费 | https://xz.chsi.com.cn/survey/index.action |
| O*NET Ability Profiler | 能力倾向测评 | ⚠️ **已退役**（仅存档） |
| 生涯适应力量表 CAAS | Savickas & Porfeli (2012)，测「生涯关注/控制/好奇/自信」 | 学术研究免费，中文版有修订，需引用原文 |
| 生涯决策困难问卷 CDDQ | 测「我为什么选不出来」 | 学术研究免费 |
| 生涯成熟度 CMI | 商业 |
| CliftonStrengths（盖洛普优势） | 商业 |

---

## 2. 版权与合规红线（**这一节决定技术选型，务必先读**）

把量表搬进自己的系统，法律风险和做题一样重要。下表是每个候选工具的真实授权状态（均查证自官方授权页）：

| 工具 | 授权状态 | 我们能不能自建题库？ |
|---|---|---|
| **O*NET Interest Profiler** | 原样转载：CC BY-ND 4.0；**改写/翻译/扩展：O*NET Tools Developer License** | ✅ 能，但必须走 Developer License |
| **O*NET 数据库** | CC BY 4.0 | ✅ 能，署名即可 |
| **IPIP（大五题库）** | 公有领域 | ✅ 能，无限制 |
| HEXACO-PI-R | 免费（非商业/研究），官网注册 | ⚠️ 需按其条款，建议先确认 |
| VIA-IS 性格优势 | 个人免费，商业集成需授权 | ⚠️ 建议外链 |
| BFI-2 | 科研免费，需向作者申请 | ⚠️ 需申请 |
| 学职平台各测评 | 官方免费，但**内容版权归平台** | ⚠️ 只能外链，不能复制题目 |
| **MBTI / Strong / SDS / WVI / MIQ / CliftonStrengths** | 商业版权 + 商标 | ❌ 不得自行复刻题目，也不得使用其名称 |

**使用 O*NET 的两条硬性要求（摘自官方授权页）：**

1. **署名**：必须注明原始出处为「O*NET Career Exploration Tools, U.S. Department of Labor, Employment and Training Administration」，并链接到授权页；推荐格式：
   > 本测评题目改编自 O*NET Career Exploration Tools（美国劳工部就业与培训署），依据 O*NET Tools Developer License 使用。O*NET® 是 USDOL/ETA 的商标。本系统对原始材料进行了中文翻译与本土化修改，USDOL/ETA 未对这些修改进行审核、认可或测试。
2. **自行验证**：Developer License 要求「validate all products incorporating content from the Tools」，即**中文版上线前需要做信效度验证**（小样本施测 + 与英文原版对照），这一点建议写进课程实践环节，正好可以作为学生的研究方法训练。执行方案见 `docs/assessment-validation-plan.md`（整表信效度与常模）；120 题库新增题的专家评审与班级试测判据、逐题记录与放行结论见 `docs/assessment-validation.md`（#284；当前未放行原创题，抽题池只含 60 道 O\*NET 官方题）。

**另外两点：**

- 网上流传的「中文修订版霍兰德量表」多为高校或学者持有版权，直接使用有风险；**自行翻译 O*NET 版本反而更干净**。
- 在系统里加一句免责声明：「测评结果用于生涯探索与自我认识，不作为心理诊断或招生就业的录用依据。」

---

## 3. 技术落地方案（怎么接进现有项目）

### 3.1 现有家底（可以直接复用的部分）

| 已有能力 | 复用方式 |
|---|---|
| 三角色用户体系 + 班级 | 测评结果天然按 `user_id` / 班级归属，教师看本班统计 |
| Recharts（已是依赖） | 六型 / 五维雷达图、班级分布柱状图，零新增依赖 |
| ExcelJS + JSZip | 教师端导出班级测评汇总表 |
| `profile_submissions` 版本快照思路 | 测评结果同样做「一次一版本 + 快照」，可追溯 |
| `configs_profile` 配置表思路 | 新增测评开关、截止时间等配置项 |
| `audit.ts` 审计 | 测评结果属个人数据，查询与导出记审计 |
| 学生面板（自鉴权） | 测评作答放在学生面板，不进 proxy matcher |

### 3.2 建议新增的数据表（3 张，从 8 张变 11 张）

| 表名 | 职责 | 关键字段 |
|---|---|---|
| `assessments` | 测评定义 | `code`（如 `riasec`）、名称、题目数、维度定义 JSON、计分类型、量表版本、授权与署名文本、是否启用 |
| `assessment_questions` | 题库 | `assessment_id`、序号、题干、所属维度、是否反向计分、版本 |
| `assessment_results` | 一次作答 + 结果快照 | `user_id`、`assessment_id`、作答 JSON、得分 JSON、霍兰德三字码、是否当前版本、`created_at` |

**设计要点：**

- 两张适配器（`db-sqlite.ts` / `db-mysql.ts`）必须**同步新增**，行为一致（项目铁律）。
- 日期时间字段沿用 TEXT（`datetime('now','localtime')`）。
- 题库进数据库而不是写死在代码里，方便后续扩充第二套量表、以及**后台维护中文题面**。
- 「结果快照」而不是「实时计算」，保证学生半年后回看仍是当时的结论。

### 3.3 计分与职业推荐逻辑

```
学生作答 → 每题按维度累加（反向题取反）→ 六个维度原始分
        → 换算成 0-100 标准分 → 排序取前三位 = 霍兰德三字码（如 SIA）
        → 与 O*NET 数据库 Interests 表逐职业算匹配度（余弦/差值距离）
        → 取 Top N 职业 → 展示职业名称、简介、所需教育水平
```

- 六型分数可同时展示**雷达图 + 条状排名**，学生更好理解。
- 职业推荐结果要写明「**匹配程度**，不是能力判定」，避免误导。
- O*NET 数据库建议**离线导入**（一张 `onet_occupations` 表），避免依赖国外 API 的可用性。

### 3.4 学生侧与教师侧界面

**学生侧（测评中心 → 作答 → 报告）**

1. 测评中心：卡片列表（兴趣 / 性格 / 价值观 / 能力），标注题量、预计耗时、是否已完成。
2. 作答页：单题单屏或一屏多题、进度条、可中断续答、提交前二次确认。
3. 结果报告：雷达图 + 六型解读 + 霍兰德三字码 + 推荐职业 + 「这些结果说明什么」的通俗说明 + 后续行动建议。
4. 报告可**一键写入个人档案**，与现有职业探索档案打通。

**教师侧（课程对接）**

1. 向班级**布置测评**（设定截止时间，复用现有提交截止的思路）。
2. 班级完成度看板 + 六型分布统计（条形图）。
3. 导出班级汇总 Excel（学生姓名、三字码、六维分数、完成时间）。
4. 查看单个学生的报告，用于**一对一生涯谈话**。

### 3.5 权限与接口归属

- 学生作答与查看自己的报告：走 `/api/shared/*` 风格，**路由自鉴权**。
- 教师查看班级统计 / 布置测评 / 导出：走 `/api/manage/*`，需同步更新 `src/proxy.ts` 的 `TEACHER_ALLOWED` 表，**并同步更新 `docs/architecture.md` 的权限表**（项目铁律）。

---

## 4. 与「职业生涯规划」课程对接

这是本项目的最终目标，测评要能**嵌进教学流程**，而不是一个孤立的玩具。

| 教学模块 | 对应测评 | 学生产出 |
|---|---|---|
| 第 1 讲 自我认知（兴趣） | 霍兰德 RIASEC | 我的霍兰德三字码 + 六型解读 |
| 第 2 讲 自我认知（性格） | 大五人格 / VIA 优势 | 我的性格描述 + 优势清单 |
| 第 3 讲 价值观澄清 | 职业价值观测评 | 我最看重的 3 项工作价值 |
| 第 4 讲 职业世界探索 | O*NET 职业库 + 职业人物 | 3 个目标职业调研卡 |
| 第 5 讲 生涯决策与行动 | 生涯适应力 / 决策困难 | 我的生涯规划书（测评结果自动带入） |
| 课程总结 | 全部测评汇总 | 个人生涯发展报告（可导出） |

**对教师的额外价值**：班级测评分布可以反过来帮助教师了解学情（例如某班研究型 I 占比特别高），用于调整教学案例。

**课程作业闭环建议**：让学生把「测评结果 → 职业调研 → 生涯规划书」串成一份作业，系统直接生成报告初稿，学生补充反思。

---

## 5. 分期路线图与验收标准

**阶段 0：准备（约 1 周）**

- 确定量表（建议：霍兰德 60 题 + 大五）、下载 O*NET 数据库与量表 PDF。
- 完成中文翻译初稿，写清每题的维度归属与反向计分规则。
- 注册 O*NET Developer（可选但建议），确认署名文案；请指导教师过一遍授权条款。
- 验收：产出《量表清单 + 计分规则 + 署名文案》文档一份。

**阶段 1：MVP — 霍兰德兴趣测评（约 2-3 周）**

- 三张新表 + 预置 60 题中文题库；学生端作答页 + 续答；结果页雷达图 + 三字码 + 六型解读。
- 验收：学生登录后可完成测评，结果可保存、可重看，两种数据库适配器行为一致，有对应单元测试。

**阶段 2：职业推荐 + 教师端（约 2-3 周）**

- 导入 O*NET 职业数据，实现匹配算法与职业推荐列表。
- 教师布置测评、班级完成度看板、Excel 导出；更新权限表与文档。
- 验收：教师能为班级布置测评并导出汇总；推荐结果与 O*NET 官方对照表一致。

**阶段 3：第二套量表 + 课程闭环（约 3 周）**

- 接入大五人格（IPIP）或 VIA 优势；打通「测评 → 档案 → 生涯报告导出」。
- 上线中文版信效度小样本验证（正好作为课程实践/论文素材）。
- 验收：可导出个人生涯发展报告；完成一轮真实班级试测并收集反馈。

**排期提醒**：项目规范要求「功能集完成即发布，禁止积压」，建议阶段 1 完成就发一个 minor 版本。

---

## 6. 理论依据速查（写报告/答辩时会用到）

| 理论 | 提出者 | 一句话 | 对应测评 |
|---|---|---|---|
| 特质因素论 | Parsons (1909) | 认识自己、认识职业、二者匹配 | 全部 |
| 类型学 / RIASEC | Holland (1959/1997) | 人格与职业环境分为六型，匹配度越高越满意 | 霍兰德测评 |
| 生涯发展理论 | Super (1957) | 生涯是终身发展的过程，生涯彩虹图 | 生涯阶段、价值观 |
| 限定与妥协理论 | Gottfredson (1981) | 职业抱负随年龄被社会认知逐步限定 | 职业期望调研 |
| 社会学习理论 | Krumboltz (1979) | 生涯选择受学习经验影响，拥抱偶然 | 生涯信念 |
| 社会认知生涯理论 | Lent, Brown & Hackett (1994) | 自我效能感驱动兴趣与选择 | 自我效能评估 |
| 生涯建构理论 | Savickas (2005) | 生涯适应力（关注/控制/好奇/自信） | CAAS |
| 职业锚 | Schein (1978) | 8 种职业锚主导职业选择 | 职业锚访谈 |

---

## 7. 组员分工建议

| 角色 | 负责内容 | 交付物 |
|---|---|---|
| A：量表与理论 | 选型、翻译、计分规则、理论依据、授权合规 | 量表清单 + 计分规则文档 |
| B：前端 | 测评中心、作答页、结果雷达图、报告页 | 可交互页面 |
| C：后端与数据 | 三张新表、作答/结果接口、O*NET 数据导入与匹配算法、权限 | 接口 + 适配器测试 |
| D：教师端与课程 | 布置测评、班级看板、Excel 导出、课程对接材料 | 教师端功能 + 课程教案 |
| 指导教师 | 授权条款确认、中文版信效度把关 | 合规确认与修订意见 |

---

## 8. 网址总表（全部已实测）

| # | 名称 | 网址 | 状态 |
|---|---|---|---|
| 1 | O*NET Interest Profiler 介绍 | https://www.onetcenter.org/IPSF.html | ✅ 200 |
| 2 | O*NET 兴趣测评在线免费作答 | https://www.mynextmove.org/explore/ip | ✅ 200 |
| 3 | O*NET 60 题纸笔版 PDF | https://www.onetcenter.org/dl_tools/ipsf/Interest_Profiler.pdf | ✅ 200 (PDF) |
| 4 | O*NET 六型职业对照表 | https://www.onetcenter.org/dl_tools/ipsf/IP_Career_Listings.pdf | ✅ 200 (PDF) |
| 5 | O*NET 工具授权页 | https://www.onetcenter.org/license_tools.html | ✅ 200 |
| 6 | O*NET 开发者页 | https://www.onetcenter.org/developers.html | ✅ 200 |
| 7 | O*NET 数据库下载 | https://www.onetcenter.org/database.html | ✅ 200 |
| 8 | O*NET 数据库授权（CC BY 4.0） | https://www.onetcenter.org/license_db.html | ✅ 200 |
| 9 | 学职平台 测评入口 | https://xz.chsi.com.cn/survey/index.action | ✅ 200 |
| 10 | 学职平台 职业探索 | https://xz.chsi.com.cn/occupation/index.action | ✅ 200 |
| 11 | IPIP 官方题库（大五） | https://ipip.ori.org/ | ⚠️ 200（证书较旧） |
| 12 | SAPA 大五在线测试 | https://www.personality-project.org/ | ✅ 200 |
| 13 | VIA 性格优势测评 | https://www.viacharacter.org/survey/account/register | ✅ 200 |
| 14 | HEXACO 问卷 | https://hexaco.org/hexaco-inventory | ✅ 200 |
| 15 | MBTI 官方（仅供确认授权边界） | https://www.myersbriggs.org/ | ✅ 200 |
| 16 | 全国大学生职业规划大赛（教育部） | https://www.ncss.cn/ | ✅ 200 |
| 17 | O*NET 职业信息库 | https://www.onetonline.org/ | ✅ 200 |

---

## 附录：本次核查记录

- 核查日期：2026-10-11（Asia/Shanghai）。
- 核查方式：逐条 HTTP 请求验证可达性与内容类型；授权条款直接读取官方授权页原文。
- 已确认**退役**、不建议作为新建基础的工具：O*NET Work Importance Locator/Profiler、O*NET Ability Profiler、Interest Profiler Long Form、Computerized Interest Profiler（官方标注 retired，材料仅存档）。
- 未能访问的网站：`https://www.parinc.com/`（对脚本访问返回 403，浏览器可正常打开；SDS/Strong 均属商业量表，非本方案采用项）。
