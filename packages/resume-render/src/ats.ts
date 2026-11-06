import type { ResumeContent } from "@talksume/core";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { canonicalHan, RADICAL_CHARS } from "./pdf-text.ts";

export interface AtsReport {
  ok: boolean;
  /** 给用户和模型看的中文短句，没问题时为空。 */
  issues: string[];
  checks: {
    textLayer: boolean;
    charset: boolean;
    contacts: boolean;
    headings: boolean;
    order: boolean;
    items: boolean;
  };
}

// 文字量与字符重合率的下限；低于它就当作没有可用的文字层（图片、转曲、乱码）
const MIN_TEXT_RATIO = 0.7;
const MIN_CHAR_OVERLAP = 0.85;
const MAX_OCCURRENCES = 200;
const EDGE = 6;

const fold = (s: string) => Array.from(s.normalize("NFKC"), canonicalHan).join("");

/** 只留字母数字：全角/半角标点、装饰符号、空白、康熙部首等兼容字形的差异都不影响比较。 */
const norm = (s: string) =>
  fold(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
const compact = (s: string) => fold(s).toLowerCase().replace(/\s/gu, "");

interface Stream {
  text: string;
  /** 每个文字片段在 text 里的 [start, end)。 */
  bounds: [number, number][];
  compact: string;
  /** 归一化之前提取到的部首区/兼容区字符。 */
  radicals: string[];
}

async function extract(pdf: Uint8Array): Promise<Stream> {
  const task = getDocument({
    data: new Uint8Array(pdf),
    useSystemFonts: false,
    verbosity: 0,
  });
  try {
    const doc = await task.promise;
    let text = "";
    let loose = "";
    const radicals: string[] = [];
    const bounds: [number, number][] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const { items } = await page.getTextContent();
      for (const item of items) {
        if (!("str" in item)) continue;
        for (const ch of item.str) if (RADICAL_CHARS.test(ch)) radicals.push(ch);
        const piece = norm(item.str);
        loose += compact(item.str);
        if (!piece) continue;
        bounds.push([text.length, text.length + piece.length]);
        text += piece;
      }
    }
    return { text, bounds, compact: loose, radicals };
  } finally {
    await task.destroy();
  }
}

function findAll(haystack: string, needle: string): number[] {
  const at: number[] = [];
  if (!needle) return at;
  for (
    let i = haystack.indexOf(needle);
    i >= 0 && at.length < MAX_OCCURRENCES;
    i = haystack.indexOf(needle, i + 1)
  )
    at.push(i);
  return at;
}

const nearest = (candidates: number[], target: number) =>
  candidates.reduce((best, c) => (Math.abs(c - target) < Math.abs(best - target) ? c : best));

function charOverlap(a: string, b: string): number {
  const counts = new Map<string, number>();
  for (const ch of a) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let hit = 0;
  for (const ch of b) {
    const left = counts.get(ch) ?? 0;
    if (left > 0) {
      hit++;
      counts.set(ch, left - 1);
    }
  }
  return b.length === 0 ? 1 : hit / b.length;
}

const clip = (s: string, n = 14) => {
  const chars = [...s.trim()];
  return chars.length > n ? `${chars.slice(0, n).join("")}…` : chars.join("");
};

interface Piece {
  norm: string;
  label: string;
}

interface Placed {
  piece: Piece;
  start: number;
  end: number;
}

interface PlacedItem {
  section: number;
  label: string;
  placed: Placed[];
}

function itemPieces(item: ResumeContent["sections"][number]["items"][number]): Piece[] {
  const parts: Piece[] = [];
  const add = (raw: string | undefined, label: string) => {
    const n = norm(raw ?? "");
    if (n) parts.push({ norm: n, label });
  };
  add(item.heading, "标题");
  add(item.subheading, "副标题");
  add(item.period, "时间");
  add(item.meta, "地点");
  for (const b of item.bullets) add(`${b.lead ?? ""}${b.text}`, `要点「${clip(b.lead || b.text, 10)}」`);
  return parts;
}

function contentText(content: ResumeContent): string {
  const { basics, sections } = content;
  const all = [basics.name, basics.headline, basics.summary, ...basics.contacts];
  for (const s of sections) {
    all.push(s.title);
    for (const it of s.items) {
      all.push(it.heading, it.subheading, it.period, it.meta, ...(it.techStack ?? []));
      for (const b of it.bullets) all.push(b.lead, b.text);
    }
  }
  return norm(all.filter(Boolean).join(""));
}

function checkContacts(content: ResumeContent, stream: Stream, issues: string[]): boolean {
  const { name, contacts } = content.basics;
  let ok = true;
  const fail = (msg: string) => {
    ok = false;
    issues.push(msg);
  };
  if (norm(name) && !stream.text.includes(norm(name))) fail("姓名在 PDF 文字层里读不到");
  for (const raw of contacts) {
    const c = raw.trim();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c)) {
      if (!stream.compact.includes(compact(c))) fail(`邮箱在 PDF 文字层里读不到（${c}）`);
    } else if (/^\+?[\d\s-]{7,}$/.test(c)) {
      if (!stream.text.includes(c.replace(/\D/g, ""))) fail(`电话在 PDF 文字层里读不到（${c}）`);
    }
  }
  return ok;
}

export async function atsCheck(pdf: Uint8Array, content: ResumeContent): Promise<AtsReport> {
  const stream = await extract(pdf);
  const issues: string[] = [];
  const checks = { textLayer: true, charset: true, contacts: true, headings: true, order: true, items: true };
  const report = (): AtsReport => ({ ok: issues.length === 0, issues, checks });

  const expected = contentText(content);
  const ratio = expected.length === 0 ? 1 : stream.text.length / expected.length;
  if (ratio < MIN_TEXT_RATIO || charOverlap(stream.text, expected) < MIN_CHAR_OVERLAP) {
    issues.push(
      stream.text.length === 0
        ? "PDF 里没有文字层（像是图片或转曲文字），ATS 读不到任何内容"
        : "PDF 文字层里的文字量不足或有乱码，和简历内容对不上",
    );
    return {
      ok: false,
      issues,
      checks: {
        textLayer: false,
        charset: false,
        contacts: false,
        headings: false,
        order: false,
        items: false,
      },
    };
  }

  if (stream.radicals.length > 0) {
    checks.charset = false;
    issues.push(
      `PDF 文字层里有 ${stream.radicals.length} 个字被读成部首字符（如 ${stream.radicals[0]}），ATS 按字符匹配可能读不出`,
    );
  }

  checks.contacts = checkContacts(content, stream, issues);

  const sections = content.sections;
  const headingAt: (Placed | undefined)[] = [];
  const placedItems: PlacedItem[] = [];
  const itemIssues = new Set<string>();
  const orderIssues = new Set<string>();

  sections.forEach((section, s) => {
    section.items.forEach((item) => {
      const label = clip(item.heading || item.bullets[0]?.lead || section.title);
      const pieces = itemPieces(item);
      const found = pieces.map((piece) => ({ piece, at: findAll(stream.text, piece.norm) }));
      for (const { piece, at } of found) {
        if (at.length > 0) continue;
        const head = piece.norm.slice(0, EDGE);
        const tail = piece.norm.slice(-EDGE);
        const scattered =
          piece.norm.length > EDGE && stream.text.includes(head) && stream.text.includes(tail);
        itemIssues.add(
          scattered
            ? `条目「${label}」的${piece.label}被拆散，中间穿插了别的内容`
            : `条目「${label}」的${piece.label}在 PDF 文字层里读不到`,
        );
      }
      const resolved = found.filter((f) => f.at.length > 0);
      if (resolved.length === 0) {
        placedItems.push({ section: s, label, placed: [] });
        return;
      }
      const anchorEntry = resolved.reduce((a, b) =>
        b.at.length < a.at.length ||
        (b.at.length === a.at.length && b.piece.norm.length > a.piece.norm.length)
          ? b
          : a,
      );
      const anchor = anchorEntry.at[0] ?? 0;
      const placed = resolved.map(({ piece, at }) => {
        const start = piece === anchorEntry.piece ? anchor : nearest(at, anchor);
        return { piece, start, end: start + piece.norm.length };
      });
      placedItems.push({ section: s, label, placed });
    });

    const title = norm(section.title);
    const at = findAll(stream.text, title);
    if (at.length === 0) {
      checks.headings = false;
      issues.push(`分区标题「${section.title}」在 PDF 文字层里读不到`);
      headingAt.push(undefined);
      return;
    }
    const firstContent = Math.min(
      ...placedItems.filter((p) => p.section === s).flatMap((p) => p.placed.map((x) => x.start)),
    );
    const whole = at.filter((a) => stream.bounds.some(([b0, b1]) => b0 === a && b1 === a + title.length));
    const pool = whole.length > 0 ? whole : at;
    const before = pool.filter((a) => a <= firstContent);
    const start = Number.isFinite(firstContent)
      ? nearest(before.length > 0 ? before : pool, firstContent)
      : (pool[0] ?? 0);
    headingAt.push({ piece: { norm: title, label: section.title }, start, end: start + title.length });
  });

  const nameStart = stream.text.indexOf(norm(content.basics.name));
  const headingStarts = headingAt.flatMap((h) => (h ? [h.start] : []));
  if (nameStart >= 0 && headingStarts.length > 0 && nameStart > Math.min(...headingStarts)) {
    orderIssues.add("姓名没有排在文字流的最前面，ATS 可能读不出抬头");
  }

  const everything = [
    ...headingAt.flatMap((h, s) => (h ? [{ section: s, item: -1, start: h.start, end: h.end }] : [])),
    ...placedItems.flatMap((it, i) =>
      it.placed.map((p) => ({ section: it.section, item: i, start: p.start, end: p.end })),
    ),
  ];

  const intrudes = (lo: number, hi: number, mine: (e: (typeof everything)[number]) => boolean) =>
    everything.some((e) => !mine(e) && e.start > lo && e.start < hi);

  placedItems.forEach((it, i) => {
    if (it.placed.length < 2) return;
    const lo = Math.min(...it.placed.map((p) => p.start));
    const hi = Math.max(...it.placed.map((p) => p.end));
    if (intrudes(lo, hi, (e) => e.item === i || it.placed.some((p) => p.start === e.start))) {
      itemIssues.add(`条目「${it.label}」的各部分被别的条目或分区的文字隔开`);
    }
  });

  sections.forEach((section, s) => {
    const heading = headingAt[s];
    const own = placedItems.filter((p) => p.section === s).flatMap((p) => p.placed);
    if (!heading || own.length === 0) return;
    const hi = Math.max(...own.map((p) => p.end));
    if (own.some((p) => p.start < heading.start)) {
      orderIssues.add(`分区「${section.title}」的标题没有排在它的内容前面`);
    }
    if (intrudes(heading.start, hi, (e) => e.section === s)) {
      orderIssues.add(`分区「${section.title}」的内容被左右栏逐行交错打断`);
    }
  });

  if (orderIssues.size > 0) checks.order = false;
  if (itemIssues.size > 0) checks.items = false;
  issues.push(...orderIssues, ...itemIssues);
  return report();
}
