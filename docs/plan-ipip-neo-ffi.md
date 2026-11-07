# IPIP NEO-FFI 50 题短式方案（#290）

## 1. 目标与边界

本项目第二套量表采用国际人格项目库（International Personality Item Pool，IPIP）中的
五大人格 50 题短式：5 个维度 × 10 题，每维 5 道正向题、5 道反向题，共 25 道反向题。

本 Issue 只负责题面文档与数据层种子：

- 新增 `ipip-neo-ffi` 量表定义与 50 题种子；
- 两套数据库在全新安装时得到完全一致的量表与题库；
- 保持 `validateAssessmentSeed` 的量表无关结构校验，不允许霍兰德专属规则误伤 IPIP；
- 不接入作答页、测评中心或档案页，学生端暂时不出现第二套量表入口。

计分复用现有 `dimensional` 模式。反向题按 `6 - 原始作答` 翻转，之后沿用现有标准分逻辑；
不生成霍兰德三字码，也不把 IPIP 维度送入 RIASEC 匹配或视图函数。

## 2. 来源与授权

- 条目来源：IPIP 的 NEO 五大人格条目与计分键
  <https://ipip.ori.org/newNEODomainsKey.htm>
- IPIP 官方说明：IPIP 条目属于**公有领域**，可复制、修改并用于商业或非商业用途。
  <https://ipip.ori.org/>
- 中文题干：本项目根据英文原题翻译，翻译与中文措辞由本项目维护。
- 边界说明：本量表使用 IPIP 公有领域题池，不等同于 PAR 公司受版权保护的商业
  NEO-FFI 原版，也不得替换成其专有题面。

## 3. 维度与作答锚点

维度顺序固定为：

| key | 中文名 | 英文名 |
|---|---|---|
| N | 神经质 | Neuroticism |
| E | 外向性 | Extraversion |
| O | 开放性 | Openness |
| A | 宜人性 | Agreeableness |
| C | 尽责性 | Conscientiousness |

作答使用 5 点同意度：

| value | 锚点 |
|---:|---|
| 1 | 非常不同意 |
| 2 | 不同意 |
| 3 | 不确定 |
| 4 | 同意 |
| 5 | 非常同意 |

`E`、`A`、`C` 与霍兰德字母同名但含义不同。任何结果分流都必须在量表入口按 `code` 或
`scoringMode` 完成，不能让 IPIP 结果进入 `assessment-match.ts`、`parseTypeCodeParts`
或其他 RIASEC 视图函数。

## 4. 50 题清单与计分键

“反向”为“是”表示计分时使用 `6 - 作答值`。题号会作为
`assessment_questions.question_index` 落库，中文题干使用 `prompt`，英文原文只保留在种子中，
不写入数据库。

| # | 维度 | IPIP 英文原文 | 中文题干 | 反向 |
|---:|---|---|---|:---:|
| 1 | N | Often feel blue. | 经常感到忧郁 | 否 |
| 2 | N | Dislike myself. | 不喜欢自己 | 否 |
| 3 | N | Am often down in the dumps. | 常常情绪低落 | 否 |
| 4 | N | Have frequent mood swings. | 情绪起伏频繁 | 否 |
| 5 | N | Panic easily. | 容易惊慌 | 否 |
| 6 | N | Rarely get irritated. | 很少被激怒 | 是 |
| 7 | N | Seldom feel blue. | 很少感到忧郁 | 是 |
| 8 | N | Feel comfortable with myself. | 对自己感到自在 | 是 |
| 9 | N | Am not easily bothered by things. | 不容易被事情烦扰 | 是 |
| 10 | N | Am very pleased with myself. | 对自己非常满意 | 是 |
| 11 | E | Feel comfortable around people. | 在人群中感到自在 | 否 |
| 12 | E | Make friends easily. | 能轻松交到朋友 | 否 |
| 13 | E | Am skilled in handling social situations. | 善于应对社交场合 | 否 |
| 14 | E | Am the life of the party. | 在聚会上很活跃 | 否 |
| 15 | E | Know how to captivate people. | 知道如何吸引别人 | 否 |
| 16 | E | Have little to say. | 常常没什么话说 | 是 |
| 17 | E | Keep in the background. | 喜欢待在幕后 | 是 |
| 18 | E | Would describe my experiences as somewhat dull. | 觉得自己的经历有些乏味 | 是 |
| 19 | E | Don't like to draw attention to myself. | 不喜欢引人注目 | 是 |
| 20 | E | Don't talk a lot. | 平时话不多 | 是 |
| 21 | O | Have a vivid imagination. | 想象力丰富 | 否 |
| 22 | O | Believe in the importance of art. | 重视艺术的价值 | 否 |
| 23 | O | Enjoy hearing new ideas. | 喜欢听新观点 | 否 |
| 24 | O | Carry the conversation to a higher level. | 能把对话引向更深层次 | 否 |
| 25 | O | Spend time reflecting on things. | 会花时间思考问题 | 否 |
| 26 | O | Am not interested in abstract ideas. | 对抽象观念不感兴趣 | 是 |
| 27 | O | Do not like art. | 不喜欢艺术 | 是 |
| 28 | O | Avoid philosophical discussions. | 回避哲学讨论 | 是 |
| 29 | O | Do not enjoy going to art museums. | 不喜欢去美术馆 | 是 |
| 30 | O | Have difficulty understanding abstract ideas. | 难以理解抽象概念 | 是 |
| 31 | A | Have a good word for everyone. | 总愿意说别人的好话 | 否 |
| 32 | A | Believe that others have good intentions. | 相信别人心怀善意 | 否 |
| 33 | A | Respect others. | 尊重他人 | 否 |
| 34 | A | Accept people as they are. | 接受别人本来的样子 | 否 |
| 35 | A | Make people feel at ease. | 让别人感到自在 | 否 |
| 36 | A | Have a sharp tongue. | 说话尖刻 | 是 |
| 37 | A | Cut others to pieces. | 把别人批评得体无完肤 | 是 |
| 38 | A | Suspect hidden motives in others. | 怀疑别人有隐藏动机 | 是 |
| 39 | A | Get back at others. | 想方设法报复别人 | 是 |
| 40 | A | Insult people. | 侮辱别人 | 是 |
| 41 | C | Am always prepared. | 总是做好准备 | 否 |
| 42 | C | Pay attention to details. | 注重细节 | 否 |
| 43 | C | Get chores done right away. | 马上完成该做的事 | 否 |
| 44 | C | Carry out my plans. | 能执行自己的计划 | 否 |
| 45 | C | Make plans and stick to them. | 制定计划并坚持执行 | 否 |
| 46 | C | Waste my time. | 浪费时间 | 是 |
| 47 | C | Find it difficult to get down to work. | 很难开始工作 | 是 |
| 48 | C | Do just enough work to get by. | 只做最低限度的工作 | 是 |
| 49 | C | Don't see things through. | 做事有始无终 | 是 |
| 50 | C | Shirk my duties. | 逃避自己的责任 | 是 |

## 5. 种子与数据库口径

- `code`: `ipip-neo-ffi`
- `name`: `五大人格测评（IPIP NEO-FFI 精简版）`
- `questionCount`: 50
- `scoringMode`: `dimensional`
- `scaleVersion`: `IPIP NEO-FFI 1.0`
- `origin`: 50 题均为 `ipip`
- `reverse_scored`: 表中 25 道“是”
- `attribution`: 题目取自 IPIP 公有人格题库，中文翻译由本项目提供
- `licenseText`: 说明 IPIP 条目属于公有领域，并区分商业 NEO-FFI 原版
- `disclaimer`: 沿用现有教育用途免责口径

SQLite 与 MySQL 都通过同一组 `ASSESSMENT_SEEDS`、`getQuestionSeeds` 和
`validateAssessmentSeed` 初始化，不另写 IPIP 专属建库逻辑。

## 6. 校验规则

两套量表共用以下基础规则：

- 定义题数与实际题数一致；
- 题号从 1 连续到总数；
- 每道题的维度必须已声明；
- 各维度题数相等；
- 题干与英文原文非空；
- 题干归一化后全局唯一；
- `origin` 合法。

以下规则只适用于霍兰德 120 题库，不得应用到 IPIP：

- 每维官方题与原创题的数量门槛；
- 原创题的 O*NET `anchor` 与兴趣高码校验；
- `NEAR_DUPLICATE_GROUPS` 及其题号存在性校验。

IPIP 的额外约束由种子测试锁定：50 题、每维 10 题、每维 5 正 5 反、总计 25 道反向题、
中文题干与文档逐题一致。
