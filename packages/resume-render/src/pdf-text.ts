import { decodePDFRawStream, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef } from "pdf-lib";

// CJK 部首补充区没有 NFKC 映射，这里按 Unicode 字符名逐项对应到常用字
const SUPPLEMENT = new Map<number, string>([
  [0x2e81, "厂"],
  [0x2e82, "乙"],
  [0x2e83, "乚"],
  [0x2e8e, "兀"],
  [0x2e8f, "尢"],
  [0x2e90, "尢"],
  [0x2e91, "尣"],
  [0x2e85, "亻"],
  [0x2e86, "冂"],
  [0x2e87, "几"],
  [0x2e88, "刀"],
  [0x2e89, "刂"],
  [0x2e8a, "卜"],
  [0x2e8b, "卩"],
  [0x2e92, "巳"],
  [0x2e93, "幺"],
  [0x2e94, "彐"],
  [0x2e95, "彐"],
  [0x2e96, "忄"],
  [0x2e97, "忄"],
  [0x2e98, "扌"],
  [0x2e99, "攵"],
  [0x2e9b, "旡"],
  [0x2e9c, "日"],
  [0x2e9d, "月"],
  [0x2e9e, "歹"],
  [0x2e9f, "母"],
  [0x2ea0, "民"],
  [0x2ea1, "氵"],
  [0x2ea2, "水"],
  [0x2ea3, "灬"],
  [0x2ea4, "爫"],
  [0x2ea5, "爫"],
  [0x2ea6, "丬"],
  [0x2ea7, "牜"],
  [0x2ea8, "犭"],
  [0x2ea9, "王"],
  [0x2eaa, "疋"],
  [0x2eab, "目"],
  [0x2eac, "礻"],
  [0x2ead, "礻"],
  [0x2eae, "竹"],
  [0x2eaf, "糸"],
  [0x2eb0, "纟"],
  [0x2eb2, "罒"],
  [0x2eb3, "罒"],
  [0x2eb4, "网"],
  [0x2eb6, "羊"],
  [0x2eb7, "羊"],
  [0x2eb8, "羊"],
  [0x2eb9, "耂"],
  [0x2eba, "肀"],
  [0x2ebb, "聿"],
  [0x2ebc, "肉"],
  [0x2ebd, "臼"],
  [0x2ebe, "艹"],
  [0x2ebf, "艹"],
  [0x2ec0, "艹"],
  [0x2ec1, "虎"],
  [0x2ec2, "衤"],
  [0x2ec3, "西"],
  [0x2ec4, "西"],
  [0x2ec5, "见"],
  [0x2ec6, "角"],
  [0x2ec7, "角"],
  [0x2ec8, "讠"],
  [0x2ec9, "贝"],
  [0x2eca, "足"],
  [0x2ecb, "车"],
  [0x2ecc, "辶"],
  [0x2ecd, "辶"],
  [0x2ece, "辶"],
  [0x2ecf, "阝"],
  [0x2ed0, "钅"],
  [0x2ed1, "長"],
  [0x2ed2, "長"],
  [0x2ed3, "长"],
  [0x2ed4, "门"],
  [0x2ed5, "阝"],
  [0x2ed6, "阝"],
  [0x2ed7, "雨"],
  [0x2ed8, "青"],
  [0x2ed9, "韦"],
  [0x2eda, "页"],
  [0x2edb, "风"],
  [0x2edc, "飞"],
  [0x2edd, "食"],
  [0x2ede, "食"],
  [0x2edf, "食"],
  [0x2ee0, "饣"],
  [0x2ee1, "頁"],
  [0x2ee2, "马"],
  [0x2ee3, "骨"],
  [0x2ee4, "鬼"],
  [0x2ee5, "鱼"],
  [0x2ee6, "鸟"],
  [0x2ee7, "卤"],
  [0x2ee8, "麦"],
  [0x2ee9, "黄"],
  [0x2eea, "黾"],
  [0x2eeb, "齐"],
  [0x2eec, "齐"],
  [0x2eed, "齿"],
  [0x2eee, "齿"],
  [0x2eef, "龙"],
  [0x2ef0, "龙"],
  [0x2ef1, "龜"],
  [0x2ef2, "龟"],
  [0x2ef3, "龟"],
]);

/** 部首补充区、康熙部首、兼容汉字：PDF 文字层里不该出现、ATS 按字符匹配会失败的码位。 */
export const RADICAL_CHARS = /[\u2e80-\u2fdf\u3038-\u303a\uf900-\ufaff]/u;

// 康熙部首「⼾」NFKC 后是繁体「戶」，而字体画出来的是简体「户」
const simplified = (ch: string) => (ch === "戶" || ch === "戸" ? "户" : ch);

export function canonicalHan(ch: string): string {
  const code = ch.codePointAt(0) ?? 0;
  if (code >= 0x2e80 && code <= 0x2eff) return SUPPLEMENT.get(code) ?? ch;
  if (
    (code >= 0x2f00 && code <= 0x2fdf) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0x3038 && code <= 0x303a)
  )
    return simplified(ch.normalize("NFKC"));
  return ch;
}

type TextFix = (s: string) => string;

const defaultFix: TextFix = (s) => Array.from(s, canonicalHan).join("");
// macOS 宋体把「口」的字形也映射到了 U+2F1C（⼜），而它的「又」走的是 U+53C8
const songtiFix: TextFix = (s) => Array.from(s, (c) => (c === "\u2f1c" ? "口" : canonicalHan(c))).join("");

const hexToText = (hex: string) => {
  let out = "";
  for (let i = 0; i + 4 <= hex.length; i += 4)
    out += String.fromCharCode(Number.parseInt(hex.slice(i, i + 4), 16));
  return out;
};
const textToHex = (s: string) =>
  Array.from(s, (c) => c.charCodeAt(0).toString(16).padStart(4, "0").toUpperCase()).join("");
const hexNum = (hex: string) => Number.parseInt(hex, 16);
const padLike = (n: number, like: string) => n.toString(16).toUpperCase().padStart(like.length, "0");

type Entry = [lo: string, hi: string, dst: string | string[]];

function rewriteBlock(kind: "char" | "range", body: string, fixText: TextFix): string | null {
  const entries: Entry[] = [];
  let changed = false;
  const re =
    kind === "char"
      ? /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g
      : /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(\[[^\]]*\]|<[0-9a-fA-F]+>)/g;
  for (const m of body.matchAll(re)) {
    const [, a = "", b = "", c = ""] = m;
    if (kind === "char") {
      const fixed = textToHex(fixText(hexToText(b)));
      if (fixed !== b.toUpperCase()) changed = true;
      entries.push([a, a, fixed]);
      continue;
    }
    if (c.startsWith("[")) {
      const items = [...c.matchAll(/<([0-9a-fA-F]+)>/g)].map((x) => x[1] ?? "");
      const fixed = items.map((x) => textToHex(fixText(hexToText(x))));
      if (fixed.some((x, i) => x !== (items[i] ?? "").toUpperCase())) changed = true;
      entries.push([a, b, fixed]);
      continue;
    }
    const dst = c.slice(1, -1);
    const base = hexToText(dst);
    const lo = hexNum(a);
    const hi = hexNum(b);
    const last = base.length - 1;
    const sample = (i: number) => base.slice(0, last) + String.fromCharCode(base.charCodeAt(last) + i);
    let any = false;
    for (let i = 0; i <= hi - lo && !any; i++) any = fixText(sample(i)) !== sample(i);
    if (!any) {
      entries.push([a, b, dst]);
      continue;
    }
    changed = true;
    for (let i = 0; i <= hi - lo; i++)
      entries.push([padLike(lo + i, a), padLike(lo + i, a), textToHex(fixText(sample(i)))]);
  }
  if (!changed) return null;

  const out: string[] = [];
  for (let i = 0; i < entries.length; i += 100) {
    const chunk = entries.slice(i, i + 100);
    const tag = kind === "char" ? "bfchar" : "bfrange";
    const lines = chunk.map(([lo, hi, dst]) => {
      const to = Array.isArray(dst) ? `[${dst.map((d) => `<${d}>`).join("")}]` : `<${dst}>`;
      return kind === "char" ? `<${lo}> ${to}` : `<${lo}> <${hi}> ${to}`;
    });
    out.push(`${chunk.length} begin${tag}\n${lines.join("\n")}\nend${tag}`);
  }
  return out.join("\n");
}

export function fixToUnicodeCMap(cmap: string, fixText: TextFix = defaultFix): string | null {
  let changed = false;
  const next = cmap.replace(
    /\d+\s+begin(bfchar|bfrange)\s([\s\S]*?)end\1/g,
    (whole, kind: string, body: string) => {
      const replaced = rewriteBlock(kind === "bfchar" ? "char" : "range", body, fixText);
      if (replaced === null) return whole;
      changed = true;
      return replaced;
    },
  );
  return changed ? next : null;
}

/** 把字体 ToUnicode 里落在部首区的映射改回规范汉字；只动文字层，不动字形和版面。失败时原样返回。 */
export async function fixPdfText(pdf: Uint8Array): Promise<Uint8Array> {
  try {
    const doc = await PDFDocument.load(pdf, { updateMetadata: false });
    const { context } = doc;
    let touched = false;
    const seen = new Set<PDFRef>();
    for (const [, obj] of context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFDict) || obj.get(PDFName.of("Type")) !== PDFName.of("Font")) continue;
      const ref = obj.get(PDFName.of("ToUnicode"));
      if (!(ref instanceof PDFRef) || seen.has(ref)) continue;
      seen.add(ref);
      const stream = context.lookup(ref);
      if (!(stream instanceof PDFRawStream)) continue;
      const fixed = fixToUnicodeCMap(
        Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1"),
        /Songti|STSong/i.test(String(obj.get(PDFName.of("BaseFont")))) ? songtiFix : defaultFix,
      );
      if (fixed === null) continue;
      context.assign(ref, context.flateStream(Buffer.from(fixed, "latin1")));
      touched = true;
    }
    if (!touched) return pdf;
    return await doc.save({ useObjectStreams: false });
  } catch {
    return pdf;
  }
}
