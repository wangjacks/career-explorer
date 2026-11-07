/**
 * 他人评价文字与词云词表（#162）。
 *
 * 纯函数、无 Node 依赖：服务端校验/提词与学生端实时预览共用同一套规则。
 * 三条评价按“提及人数”计权：同一条评价内重复只算一次，避免一条长评价刷屏。
 */
import type { WordCloudItem } from "@/types";

export const EVALUATION_COUNT = 3;
export const MAX_EVALUATION_TEXT_LENGTH = 300;
export const MAX_EVALUATION_WORDS = 30;

export type NormalizeEvaluationTextsResult =
  | { ok: true; texts: string[] }
  | { ok: false; message: string };

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** 中文常见虚词/代词/泛称；保留“认真/沟通/帮助/负责”等评价性词汇 */
const STOPWORDS = new Set([
  "的", "了", "是", "我", "你", "他", "她", "它", "我们", "你们", "他们", "她们", "它们",
  "这", "那", "这个", "那个", "这些", "那些", "一个", "一些", "一种", "一位", "三位",
  "我的", "你的", "他的", "她的", "它的", "我们的", "你们的", "他们的",
  "自己", "觉得", "感觉", "认为", "知道", "看到", "感到", "希望", "应该", "需要",
  "非常", "很", "比较", "还", "也", "都", "就", "和", "与", "及", "或", "但是", "但",
  "因为", "所以", "而且", "可以", "能够", "会", "要", "有", "在", "对", "给", "让",
  "把", "被", "从", "到", "中", "上", "下", "里", "外", "着", "过", "地", "得", "之",
  "其", "于", "为", "以", "而", "则", "等", "一样", "这样", "那样", "什么", "怎么",
  "如何", "还有", "以及", "如果", "虽然", "然后", "已经", "一直", "总是", "有时",
  "时候", "方面", "挺", "太", "更", "最", "能", "不能", "不会", "没有", "不是",
  "就是", "只是", "还是", "也是", "都是", "真的", "确实", "是个", "别人", "他人",
  "大家", "朋友", "同学", "老师", "一位", "几位",
  "the", "and", "are", "was", "were", "been", "being", "is", "be", "a", "an", "to",
  "of", "in", "on", "at", "for", "with", "by", "from", "as", "it", "this", "that",
  "these", "those", "i", "you", "he", "she", "they", "we", "my", "your", "his",
  "her", "their", "our", "me", "him", "them", "us", "not", "no", "yes", "very",
  "really", "just", "so", "but", "or", "if", "then", "than", "too", "also", "can",
  "could", "should", "would", "will", "may", "might", "have", "has", "had", "do",
  "does", "did", "doing", "about", "into", "over", "under", "again", "more", "most",
  "some", "any", "all", "both", "each", "few", "many", "much", "such", "only", "own",
  "same", "other", "another", "http", "https", "www", "com", "cn", "org", "net",
]);

const URL_LIKE = /^(https?|www|com|cn|org|net)$/i;

function normalizeOneText(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(CONTROL_CHARS, "").trim();
}

/**
 * 校验并归一化三条评价。
 * - 必须是长度 3 的字符串数组；
 * - 每条最多 300 字；
 * - 允许三条全空（由路由决定是否保留历史图片），但不允许只填一两条。
 */
export function normalizeEvaluationTexts(input: unknown): NormalizeEvaluationTextsResult {
  if (!Array.isArray(input) || input.length !== EVALUATION_COUNT) {
    return { ok: false, message: `请填写${EVALUATION_COUNT}条他人评价` };
  }
  const texts: string[] = [];
  for (let i = 0; i < input.length; i += 1) {
    const value = input[i];
    if (typeof value !== "string") {
      return { ok: false, message: "评价格式不正确" };
    }
    const text = normalizeOneText(value);
    if (Array.from(text).length > MAX_EVALUATION_TEXT_LENGTH) {
      return { ok: false, message: `第${i + 1}条评价不能超过${MAX_EVALUATION_TEXT_LENGTH}字` };
    }
    texts.push(text);
  }
  const filled = texts.filter(Boolean).length;
  if (filled !== 0 && filled !== EVALUATION_COUNT) {
    return { ok: false, message: `请完整填写${EVALUATION_COUNT}条他人评价` };
  }
  return { ok: true, texts };
}

/** 读取数据库中的 JSON 数组；非法值按空数组处理（不阻断档案展示） */
export function parseStoredEvaluationTexts(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .slice(0, EVALUATION_COUNT)
        .map((value) => (typeof value === "string" ? normalizeOneText(value) : ""));
    }
  } catch (err) {
    console.error("Failed to parse stored evaluation text:", err);
  }
  return [];
}

/** 三条全空返回 null，避免数据库里出现 "[]" 这种无意义值 */
export function serializeEvaluationTexts(texts: readonly string[]): string | null {
  if (texts.length !== EVALUATION_COUNT) return null;
  const normalized = texts.map(normalizeOneText);
  if (normalized.every((text) => !text)) return null;
  return JSON.stringify(normalized);
}

function tokenKey(token: string): string {
  return token.trim().toLocaleLowerCase();
}

function isMeaningfulToken(token: string): boolean {
  const key = tokenKey(token);
  if (!key || STOPWORDS.has(key) || URL_LIKE.test(key)) return false;
  if (/^\d+$/.test(key)) return false;
  if (Array.from(key).length < 2) return false;
  return /\p{L}/u.test(key);
}

function fallbackSegments(text: string): string[] {
  return text.split(/[\s,，。.!！?？;；:：、"'“”‘’()（）[\]【】{}<>《》/\\|+*=~`@#$%^&_-]+/u);
}

function segmentText(text: string): string[] {
  if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    try {
      const segmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });
      return Array.from(segmenter.segment(text))
        .filter((part) => part.isWordLike)
        .map((part) => part.segment);
    } catch (err) {
      console.error("Intl.Segmenter failed, falling back to delimiter split:", err);
    }
  }
  return fallbackSegments(text);
}

/**
 * 从三条评价提取词云词表。
 * weight = 提及该词的评价人数（1–3）；同权重按总频次降序、再按文本升序，结果可复现。
 */
export function extractEvaluationWords(
  texts: readonly string[],
  limit = MAX_EVALUATION_WORDS
): WordCloudItem[] {
  const mentionCount = new Map<string, number>();
  const totalCount = new Map<string, number>();
  const displayText = new Map<string, string>();

  for (const text of texts) {
    if (!text.trim()) continue;
    const seenInThisText = new Set<string>();
    for (const rawToken of segmentText(text)) {
      const token = rawToken.trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
      if (!isMeaningfulToken(token)) continue;
      const key = tokenKey(token);
      totalCount.set(key, (totalCount.get(key) ?? 0) + 1);
      if (!seenInThisText.has(key)) {
        seenInThisText.add(key);
        mentionCount.set(key, (mentionCount.get(key) ?? 0) + 1);
      }
      if (!displayText.has(key)) displayText.set(key, key);
    }
  }

  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  return Array.from(mentionCount.entries())
    .map(([key, weight]) => ({
      text: displayText.get(key) ?? key,
      weight,
      total: totalCount.get(key) ?? 0,
    }))
    .sort(
      (a, b) =>
        b.weight - a.weight ||
        b.total - a.total ||
        a.text.localeCompare(b.text, "zh-CN")
    )
    .slice(0, safeLimit)
    .map(({ text, weight }) => ({ text, weight }));
}
