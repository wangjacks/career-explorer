import { describe, it, expect } from "vitest";
import {
  ASSESSMENT_HELP_LINKS,
  ASSESSMENT_TIPS,
  BIG_FIVE_INTRO,
  BIG_FIVE_RIASEC_NOTE,
  DISCLAIMER_FALLBACK,
  EXTERNAL_LINK_REL,
  IPIP_SOURCE_URL,
  ONET_TOOLS_LICENSE_URL,
  RIASEC_INTRO,
  resolveDisclaimer,
} from "../lib/assessment-center-content";
import { IPIP_DIMENSIONS, RIASEC_DISCLAIMER } from "../lib/assessment-data";
import { RIASEC_KEYS } from "../lib/assessment-match";

/**
 * 内容卡（#225）的文案与链接不变量：
 * 六型齐全且顺序稳定、外链只走 https 且指向学职平台、授权/免责文案与库里的种子同源。
 * 这些是「界面没 DOM 测试」时唯一能锁住的东西（文案被误删/链接被改成 http 会在这里红）。
 */
describe("RIASEC 六型科普文案（#225）", () => {
  it("六型齐全、顺序 R→I→A→S→E→C（与三字码权重顺序一致）", () => {
    expect(RIASEC_INTRO.map((type) => type.key)).toEqual([...RIASEC_KEYS]);
  });

  it("每一型都有中文名、英文名、一段介绍与 2–3 个关键词", () => {
    for (const type of RIASEC_INTRO) {
      expect(type.label.trim(), `${type.key} 缺中文名`).not.toBe("");
      expect(type.english.trim(), `${type.key} 缺英文名`).not.toBe("");
      expect(type.summary.trim().length, `${type.key} 介绍太短`).toBeGreaterThan(20);
      expect(type.keywords.length, `${type.key} 关键词缺失`).toBeGreaterThanOrEqual(2);
      expect(type.keywords.length).toBeLessThanOrEqual(3);
      expect(type.keywords.every((keyword) => keyword.trim() !== "")).toBe(true);
    }
  });

  it("英文名与 O*NET 的六类名称一致（方便学生对照外部资料）", () => {
    expect(RIASEC_INTRO.map((type) => type.english)).toEqual([
      "Realistic",
      "Investigative",
      "Artistic",
      "Social",
      "Enterprising",
      "Conventional",
    ]);
  });

  it("不复述商业量表的名称/题面（版权红线，见 docs/plan-assessment.md 第 2 节）", () => {
    const forbidden = ["MBTI", "Myers", "Strong", "SDS", "Self-Directed", "Clifton", "16Personalities", "DISC"];
    const allText = [...RIASEC_INTRO.map((type) => `${type.label}${type.english}${type.summary}${type.keywords.join("")}`), ...ASSESSMENT_TIPS].join(
      " "
    );
    for (const word of forbidden) {
      expect(allText.toLowerCase(), `文案里不应出现商业量表名：${word}`).not.toContain(word.toLowerCase());
    }
  });

  it("作答提示覆盖「没有对错 / 自动保存 / 结果用途」三个关键口径", () => {
    const tips = ASSESSMENT_TIPS.join(" ");
    expect(tips).toContain("没有对错");
    expect(tips).toContain("保存");
    expect(tips).toContain("职业兴趣探索");
  });
});

describe("学职平台外链卡（#225）", () => {
  it("至少给出测评入口与职业探索两个官方入口，id 唯一", () => {
    expect(ASSESSMENT_HELP_LINKS.length).toBeGreaterThanOrEqual(2);
    const ids = ASSESSMENT_HELP_LINKS.map((link) => link.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ASSESSMENT_HELP_LINKS.map((link) => link.href)).toContain("https://xz.chsi.com.cn/survey/index.action");
    expect(ASSESSMENT_HELP_LINKS.map((link) => link.href)).toContain("https://xz.chsi.com.cn/occupation/index.action");
  });

  it("全部是 https 且只指向学职平台与 IPIP 题库（不混入站内路由或 http 链接）", () => {
    const allowedHosts = new Set(["xz.chsi.com.cn", "ipip.ori.org"]);
    for (const link of ASSESSMENT_HELP_LINKS) {
      expect(link.href, `${link.id} 必须是 https`).toMatch(/^https:\/\//);
      expect(allowedHosts.has(new URL(link.href).host), `${link.id} 指向了未登记的外站`).toBe(true);
      expect(link.title.trim()).not.toBe("");
      expect(link.description.trim()).not.toBe("");
      expect(link.source.trim()).not.toBe("");
    }
  });

  it("IPIP 题库外链（#291）指向公有领域来源并写明授权属性", () => {
    const ipip = ASSESSMENT_HELP_LINKS.find((link) => link.id === "ipip");
    expect(ipip?.href).toBe(IPIP_SOURCE_URL);
    expect(ipip?.href).toBe("https://ipip.ori.org/");
    expect(ipip?.source).toContain("公有领域");
    expect(ipip?.description).toContain("公有领域");
  });

  it("外链 rel 含 noopener（新窗口打开时不给 opener 反向控制本页）", () => {
    expect(EXTERNAL_LINK_REL).toContain("noopener");
  });
});

describe("大五人格科普文案（#291）", () => {
  it("五个方面齐全、顺序 N→E→O→A→C（与量表维度一致）", () => {
    expect(BIG_FIVE_INTRO.map((dimension) => dimension.key)).toEqual(IPIP_DIMENSIONS.map((dimension) => dimension.key));
    expect(BIG_FIVE_INTRO.map((dimension) => dimension.label)).toEqual(
      IPIP_DIMENSIONS.map((dimension) => dimension.label)
    );
  });

  it("每个方面都有英文名、一段通俗介绍与高低分各 2 个表现标签", () => {
    for (const dimension of BIG_FIVE_INTRO) {
      expect(dimension.english.trim(), `${dimension.key} 缺英文名`).not.toBe("");
      expect(dimension.summary.trim().length, `${dimension.key} 介绍太短`).toBeGreaterThan(20);
      expect(dimension.high.length, `${dimension.key} 高分表现不全`).toBeGreaterThanOrEqual(2);
      expect(dimension.low.length, `${dimension.key} 低分表现不全`).toBeGreaterThanOrEqual(2);
      expect([...dimension.high, ...dimension.low].every((keyword) => keyword.trim() !== "")).toBe(true);
    }
  });

  it("只描述两端表现、不评判哪种更好，也不复述商业量表名称", () => {
    const forbidden = ["MBTI", "Myers", "Strong", "SDS", "Self-Directed", "Clifton", "16Personalities", "DISC"];
    const allText = [
      ...BIG_FIVE_INTRO.map(
        (dimension) =>
          `${dimension.label}${dimension.english}${dimension.summary}${dimension.high.join("")}${dimension.low.join("")}`
      ),
      BIG_FIVE_RIASEC_NOTE,
    ].join(" ");
    for (const word of forbidden) {
      expect(allText.toLowerCase(), `文案里不应出现商业量表名：${word}`).not.toContain(word.toLowerCase());
    }
  });

  it("大五与霍兰德的关系卡住三组呼应（S↔宜人性、E↔外向性、C↔尽责性）且强调两套视角不同", () => {
    expect(BIG_FIVE_RIASEC_NOTE).toContain("社会型（S）");
    expect(BIG_FIVE_RIASEC_NOTE).toContain("企业型（E）");
    expect(BIG_FIVE_RIASEC_NOTE).toContain("常规型（C）");
    expect(BIG_FIVE_RIASEC_NOTE).toContain("宜人性");
    expect(BIG_FIVE_RIASEC_NOTE).toContain("外向性");
    expect(BIG_FIVE_RIASEC_NOTE).toContain("尽责性");
    expect(BIG_FIVE_RIASEC_NOTE).toContain("视角不同");
  });
});

describe("授权与免责（#225）", () => {
  it("O*NET 授权页链接是 https 且指向官方 license_tools 页", () => {
    expect(ONET_TOOLS_LICENSE_URL).toBe("https://www.onetcenter.org/license_tools.html");
    expect(new URL(ONET_TOOLS_LICENSE_URL).protocol).toBe("https:");
  });

  it("兜底免责声明与库里种子同一句（改口径两边一起改，这里会红）", () => {
    expect(DISCLAIMER_FALLBACK).toBe(RIASEC_DISCLAIMER);
    expect(DISCLAIMER_FALLBACK).toContain("不作为心理诊断");
  });

  it("resolveDisclaimer：接口给了文本就用接口的（去首尾空白），没有就兜底", () => {
    expect(resolveDisclaimer("  测评结果仅供参考。 ")).toBe("测评结果仅供参考。");
    for (const raw of [undefined, null, "", "   ", 42, {}]) {
      expect(resolveDisclaimer(raw)).toBe(DISCLAIMER_FALLBACK);
    }
  });
});
