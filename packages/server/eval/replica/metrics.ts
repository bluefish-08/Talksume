import { PNG } from "pngjs";

export interface Img {
  w: number;
  h: number;
  data: Uint8Array;
}

export function decode(png: Uint8Array): Img {
  const p = PNG.sync.read(Buffer.from(png));
  return { w: p.width, h: p.height, data: p.data };
}

const luma = (r: number, g: number, b: number) => (0.299 * r + 0.587 * g + 0.114 * b) / 255;

/** 只看第一页（A4 比例）的上半部分以外也算：超出一页的内容不参与比较。 */
function firstPage(img: Img): { rows: number } {
  return { rows: Math.min(img.h, Math.round(img.w * Math.SQRT2)) };
}

/** 把第一页切成 cols×rows 格，取每格的平均亮度，反映色块、侧栏、留白的位置。 */
export function gridLuma(img: Img, cols = 8, rows = 12): number[] {
  const { rows: ph } = firstPage(img);
  const out: number[] = [];
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const x0 = Math.floor((gx * img.w) / cols);
      const x1 = Math.floor(((gx + 1) * img.w) / cols);
      const y0 = Math.floor((gy * ph) / rows);
      const y1 = Math.floor(((gy + 1) * ph) / rows);
      let sum = 0;
      let n = 0;
      for (let y = y0; y < y1; y += 2) {
        for (let x = x0; x < x1; x += 2) {
          const i = (y * img.w + x) * 4;
          sum += luma(img.data[i] as number, img.data[i + 1] as number, img.data[i + 2] as number);
          n++;
        }
      }
      out.push(n ? sum / n : 1);
    }
  }
  return out;
}

export function gridScore(a: Img, b: Img): number {
  const ga = gridLuma(a);
  const gb = gridLuma(b);
  const diff = ga.reduce((s, v, i) => s + Math.abs(v - (gb[i] as number)), 0) / ga.length;
  return Math.max(0, 1 - diff * 2.2);
}

export interface Accent {
  hex: string;
  /** 有彩色像素占第一页的比例。 */
  share: number;
  hue: number;
}

function hsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const h = d === 0 ? 0 : max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: max === 0 ? 0 : d / max, v: max / 255 };
}

/** 第一页里最主要的彩色（饱和度够高、不是近白），没有彩色返回 undefined。 */
export function dominantAccent(img: Img): Accent | undefined {
  const { rows } = firstPage(img);
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
  let chromatic = 0;
  let total = 0;
  for (let y = 0; y < rows; y += 2) {
    for (let x = 0; x < img.w; x += 2) {
      const i = (y * img.w + x) * 4;
      const [r, g, b] = [img.data[i] as number, img.data[i + 1] as number, img.data[i + 2] as number];
      total++;
      const { s, v } = hsv(r, g, b);
      if (s < 0.28 || v < 0.18) continue;
      chromatic++;
      const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
      const bin = bins.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
      bin.n++;
      bin.r += r;
      bin.g += g;
      bin.b += b;
      bins.set(key, bin);
    }
  }
  if (chromatic / total < 0.004) return undefined;
  const best = [...bins.values()].reduce((a, c) => (c.n > a.n ? c : a));
  const [r, g, b] = [best.r / best.n, best.g / best.n, best.b / best.n].map(Math.round) as [
    number,
    number,
    number,
  ];
  const hex = `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
  return { hex, share: chromatic / total, hue: hsv(r, g, b).h };
}

/** 主色相近程度：色相差 ≤ 15° 满分，≥ 90° 为 0；一边有彩色一边没有，只给 0.2。 */
export function paletteScore(a: Img, b: Img): number {
  const pa = dominantAccent(a);
  const pb = dominantAccent(b);
  if (!pa && !pb) return 1;
  if (!pa || !pb) return 0.2;
  const d = Math.abs(pa.hue - pb.hue);
  const hueDist = Math.min(d, 360 - d);
  return Math.max(0, Math.min(1, 1 - (hueDist - 15) / 75));
}

/** 抬头区（第一页最上面 12%）和正文的平均亮度差，用来判断是否有深色/彩色抬头色块。 */
export function headerBand(img: Img): boolean {
  const { rows } = firstPage(img);
  const band = Math.round(rows * 0.1);
  let top = 0;
  let nTop = 0;
  let rest = 0;
  let nRest = 0;
  for (let y = 4; y < rows; y += 3) {
    for (let x = 0; x < img.w; x += 3) {
      const i = (y * img.w + x) * 4;
      const l = luma(img.data[i] as number, img.data[i + 1] as number, img.data[i + 2] as number);
      if (y < band) {
        top += l;
        nTop++;
      } else {
        rest += l;
        nRest++;
      }
    }
  }
  return rest / nRest - top / nTop > 0.2;
}

export interface Similarity {
  grid: number;
  palette: number;
  headerBandMatch: boolean;
  /** 0–100 的版式相似度：版面灰度格 60% + 主色 40%，抬头色块不一致扣 10。 */
  layout: number;
  refAccent: string | undefined;
  repAccent: string | undefined;
}

export function similarity(ref: Img, rep: Img): Similarity {
  const grid = gridScore(ref, rep);
  const palette = paletteScore(ref, rep);
  const headerBandMatch = headerBand(ref) === headerBand(rep);
  const layout = Math.round(Math.max(0, (0.6 * grid + 0.4 * palette) * 100 - (headerBandMatch ? 0 : 10)));
  return {
    grid: Math.round(grid * 100) / 100,
    palette: Math.round(palette * 100) / 100,
    headerBandMatch,
    layout,
    refAccent: dominantAccent(ref)?.hex,
    repAccent: dominantAccent(rep)?.hex,
  };
}
