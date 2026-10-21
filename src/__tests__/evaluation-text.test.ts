import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_EVALUATION_TEXT_LENGTH,
  extractEvaluationWords,
  normalizeEvaluationTexts,
  parseStoredEvaluationTexts,
  serializeEvaluationTexts,
} from "../lib/evaluation-text";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("normalizeEvaluationTexts（#162）", () => {
  it("接受三条评价，trim 并统一换行", () => {
    const result = normalizeEvaluationTexts(["  评价一\r\n第二行  ", "评价二", " 评价三 "]);
    expect(result).toEqual({
      ok: true,
      texts: ["评价一\n第二行", "评价二", "评价三"],
    });
  });

  it("数量不是 3 / 非字符串 → 拒绝", () => {
    expect(normalizeEvaluationTexts(null).ok).toBe(false);
    expect(normalizeEvaluationTexts(["一", "二"]).ok).toBe(false);
    expect(normalizeEvaluationTexts(["一", "二", "三", "四"]).ok).toBe(false);
    expect(normalizeEvaluationTexts(["一", 2, "三"]).ok).toBe(false);
  });

  it(`单条超过 ${MAX_EVALUATION_TEXT_LENGTH} 字 → 拒绝`, () => {
    const result = normalizeEvaluationTexts(["长".repeat(MAX_EVALUATION_TEXT_LENGTH + 1), "二", "三"]);
    expect(result).toEqual({ ok: false, message: `第1条评价不能超过${MAX_EVALUATION_TEXT_LENGTH}字` });
  });

  it("三条全空允许（由路由决定是否保留历史图片）", () => {
    expect(normalizeEvaluationTexts(["", "  ", "\n"])).toEqual({ ok: true, texts: ["", "", ""] });
  });

  it("只填一两条 → 拒绝，避免半份评价入库", () => {
    expect(normalizeEvaluationTexts(["一", "", ""]).ok).toBe(false);
    expect(normalizeEvaluationTexts(["一", "二", ""]).ok).toBe(false);
  });

  it("控制字符被剥离，正文其余内容保留", () => {
    const result = normalizeEvaluationTexts(["评价\u0001一", "评价二", "评价三"]);
    expect(result).toEqual({ ok: true, texts: ["评价一", "评价二", "评价三"] });
  });
});

describe("存储读写（#162）", () => {
  it("parse/serialize 往返三条评价；全空序列化为 null", () => {
    const texts = ["评价一", "评价二", "评价三"];
    expect(parseStoredEvaluationTexts(serializeEvaluationTexts(texts))).toEqual(texts);
    expect(serializeEvaluationTexts(["", " ", ""])).toBeNull();
    expect(serializeEvaluationTexts(["一", "二"])).toBeNull();
  });

  it("空值与非法 JSON 按空数组处理，非法 JSON 留错误日志", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(parseStoredEvaluationTexts(null)).toEqual([]);
    expect(parseStoredEvaluationTexts("")).toEqual([]);
    expect(parseStoredEvaluationTexts("not-json")).toEqual([]);
    expect(error).toHaveBeenCalledTimes(1);
  });
});

describe("extractEvaluationWords（#162）", () => {
  const texts = [
    "你做事很认真，遇到问题会主动沟通，也愿意帮助同学。",
    "认真负责，沟通清楚，团队合作很可靠。",
    "很有耐心，愿意帮助别人，沟通时很真诚。",
  ];

  it("按提及人数计权：三位都提到 → 3，两位 → 2", () => {
    const words = extractEvaluationWords(texts);
    const weight = new Map(words.map((word) => [word.text, word.weight]));
    expect(weight.get("沟通")).toBe(3);
    expect(weight.get("认真")).toBe(2);
    expect(weight.get("帮助")).toBe(2);
  });

  it("停用词与泛称不进入词表（同学/别人/我/很）", () => {
    const words = extractEvaluationWords(texts);
    const keys = new Set(words.map((word) => word.text));
    expect(keys.has("同学")).toBe(false);
    expect(keys.has("别人")).toBe(false);
    expect(keys.has("我")).toBe(false);
    expect(keys.has("很")).toBe(false);
  });

  it("同一条评价内重复只算一次；跨人再出现才加权重", () => {
    const words = extractEvaluationWords(["认真，认真，认真", "认真"]);
    const target = words.find((word) => word.text === "认真");
    expect(target?.weight).toBe(2);
  });

  it("过滤纯数字、单字与标点；结果确定可复现", () => {
    expect(extractEvaluationWords(["我的了是123，a"])).toEqual([]);
    expect(extractEvaluationWords(texts)).toEqual(extractEvaluationWords(texts));
    expect(extractEvaluationWords(texts, 2).length).toBeLessThanOrEqual(2);
  });

  it("Intl.Segmenter 不可用时退化为分隔符切分而不抛错", () => {
    vi.stubGlobal("Intl", { ...Intl, Segmenter: undefined });
    const words = extractEvaluationWords(["认真负责，沟通清楚"]);
    expect(words.length).toBeGreaterThan(0);
  });
});
