export interface Span {
  text: string;
  strong: boolean;
}

const CJK = "\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff";
const CJK_RE = new RegExp(`[${CJK}]`);
const HALF_TO_FULL: Record<string, string> = { ",": "，", ";": "；", ":": "：", "!": "！", "?": "？" };

/** 含中文的句子里半角逗号、分号换成全角（千分位除外），冒号等只在紧跟中文时换；纯英文不动。 */
export function fullWidthPunctuation(text: string): string {
  const cjk = CJK_RE.test(text);
  return (
    cjk
      ? text.replace(
          /\s*([,;])(?!\d)\s*|(?<!\d)\s*([,;])\s*/g,
          (_m, a?: string, b?: string) => HALF_TO_FULL[a ?? b ?? ""] ?? "",
        )
      : text
  )
    .replace(new RegExp(`(?<=[${CJK}])\\s*([,;:!?])(?!//)\\s*`, "g"), (_m, p: string) => HALF_TO_FULL[p] ?? p)
    .replace(new RegExp(`\\s*([,;!?])\\s*(?=[${CJK}])`, "g"), (_m, p: string) => HALF_TO_FULL[p] ?? p)
    .replace(new RegExp(`\\(([^()]*[${CJK}][^()]*)\\)`, "g"), "（$1）");
}

const LATIN = "A-Za-z0-9";

const OPEN = "\u0001";
const CLOSE = "\u0002";

/** 中文与英文、数字之间补一个空格，空格落在加粗标记外侧；紧挨全角标点的不补。 */
export function autoSpace(text: string): string {
  return text
    .replace(new RegExp(`([${CJK}][${CLOSE}]?)([${OPEN}]?[${LATIN}@#$&(\\[])`, "g"), "$1 $2")
    .replace(new RegExp(`([${LATIN}%)\\]+][${CLOSE}]?)([${OPEN}]?[${CJK}])`, "g"), "$1 $2");
}

export function typeset(text: string): string {
  return autoSpace(fullWidthPunctuation(text.trim()));
}

// 数字后必须跟量级、约数或单位之一，版本号、年份、纯序号不加粗
const UNIT =
  "%|‰|倍|毫秒|ms|秒|分钟|小时|天|周|个月|人次|名|人|位|次|条|单|笔|个|行|台|元|篇|项|家|所|本|件|套|场|QPS|qps|TPS|tps|GB|MB|TB|[xX×]|s";
const NUM = "\\d[\\d,]*(?:\\.\\d+)?";
const WITH_UNIT = `(?<![A-Za-z0-9.\\-/])${NUM}(?:\\s?[万亿千kKwW](?:\\s?[+余多])?(?:\\s?(?:${UNIT}))?|\\s?[+余多](?:\\s?(?:${UNIT}))?|\\s?(?:${UNIT}))(?![A-Za-z])`;
// 「从 200 提升到 3000」这类变化量没有单位，靠前面的介词认出来
const AFTER_CHANGE = `(?<=(?:从|到|至|达|超过|突破)\\s?)\\d{2,}[\\d,]*(?:\\.\\d+)?(?![\\d.]|\\s?[年月日届级])`;
const METRIC = new RegExp(`${WITH_UNIT}|${AFTER_CHANGE}`, "g");

function split(text: string, pattern: RegExp, strong: (match: RegExpMatchArray) => string): Span[] {
  const spans: Span[] = [];
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    const at = m.index ?? 0;
    if (at > last) spans.push({ text: text.slice(last, at), strong: false });
    spans.push({ text: strong(m), strong: true });
    last = at + m[0].length;
  }
  if (last < text.length) spans.push({ text: text.slice(last), strong: false });
  return spans;
}

/** 有 **…** 显式标记时只加粗标记内容，否则自动加粗带单位的数字指标；先排版再切分，标记两侧也能补上空格。 */
export function richSpans(raw: string): Span[] {
  if (/\*\*.+?\*\*/.test(raw)) {
    const marked = typeset(raw.replace(/\*\*(.+?)\*\*/g, `${OPEN}$1${CLOSE}`));
    return split(marked, new RegExp(`${OPEN}\\s*(.+?)\\s*${CLOSE}`, "g"), (m) => m[1] ?? "");
  }
  return split(typeset(raw), METRIC, (m) => m[0]);
}

export const plainText = (raw: string): string => typeset(raw.replace(/\*\*(.+?)\*\*/g, "$1"));

export const hasCjk = (text: string): boolean => CJK_RE.test(text);
