const STOP_BIGRAMS = new Set([
  "负责",
  "优先",
  "具备",
  "能力",
  "相关",
  "经验",
  "岗位",
  "职责",
  "要求",
  "任职",
  "熟悉",
  "工作",
  "良好",
  "沟通",
  "团队",
  "公司",
  "以上",
  "学历",
  "专业",
  "加分",
  "具有",
  "进行",
  "以及",
  "能够",
  "了解",
  "熟练",
  "掌握",
  "参与",
  "提升",
  "理解",
  "实习",
  "本科",
  "硕士",
  "我们",
  "你将",
  "如果",
  "可以",
  "同时",
  "通过",
  "包括",
  "不限",
  "热爱",
  "善于",
  "有责",
  "责任",
  "感强",
  "极强",
  "较强",
  "优秀",
  "扎实",
  "一定",
  "基础",
  "知识",
]);
const STOP_WORDS = new Set(["and", "the", "for", "with", "you", "our", "are", "to", "of", "in", "or"]);

/** 英文/数字词按词切，中文连续片段切成二元组，丢弃通用招聘套话。 */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  const lower = text.toLowerCase();
  for (const m of lower.matchAll(/[a-z][a-z0-9+#.]*|\d+(?:\.\d+)?|[一-鿿]+/g)) {
    const piece = m[0];
    if (/^[一-鿿]+$/.test(piece)) {
      if (piece.length === 1) continue;
      for (let i = 0; i < piece.length - 1; i++) {
        const bi = piece.slice(i, i + 2);
        if (!STOP_BIGRAMS.has(bi)) out.push(bi);
      }
    } else if (!/^\d/.test(piece)) {
      const word = piece.replace(/\.+$/, "");
      if (word.length >= 2 && !STOP_WORDS.has(word)) out.push(word);
    }
  }
  return out;
}

export function termFrequency(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  return tf;
}

export function buildIdf(docs: string[][]): Map<string, number> {
  const df = new Map<string, number>();
  for (const doc of docs) for (const t of new Set(doc)) df.set(t, (df.get(t) ?? 0) + 1);
  const n = docs.length;
  const idf = new Map<string, number>();
  for (const [t, d] of df) idf.set(t, Math.log(1 + (n - d + 0.5) / (d + 0.5)));
  return idf;
}

export class Bm25 {
  readonly #tfs: Map<string, number>[];
  readonly #lengths: number[];
  readonly #avgLength: number;
  readonly #idf: Map<string, number>;
  readonly #k1 = 1.2;
  readonly #b = 0.75;

  constructor(docs: string[][]) {
    this.#tfs = docs.map(termFrequency);
    this.#lengths = docs.map((d) => d.length);
    this.#avgLength = this.#lengths.reduce((a, b) => a + b, 0) / Math.max(1, docs.length);
    this.#idf = buildIdf(docs);
  }

  score(query: string[], docIndex: number): number {
    const tf = this.#tfs[docIndex];
    const length = this.#lengths[docIndex];
    if (!tf || length === undefined) return 0;
    let total = 0;
    for (const term of new Set(query)) {
      const f = tf.get(term);
      if (!f) continue;
      const idf = this.#idf.get(term) ?? 0;
      const norm = f + this.#k1 * (1 - this.#b + (this.#b * length) / (this.#avgLength || 1));
      total += (idf * f * (this.#k1 + 1)) / norm;
    }
    return total;
  }
}

export const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
