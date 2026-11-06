import { getBrowser } from "./chromium.ts";

export interface PaletteColor {
  hex: string;
  /** 占画面的比例，0–1。 */
  share: number;
  /** 饱和度够高才算彩色；灰、黑、白不算。 */
  chromatic: boolean;
}

const SCRIPT = `(async (src) => {
  const img = new Image();
  img.src = src;
  await img.decode();
  const w = 200, h = Math.max(1, Math.round(200 * img.naturalHeight / img.naturalWidth));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  const bins = new Map();
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    const key = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
    const b = bins.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    b.n++; b.r += d[i]; b.g += d[i + 1]; b.b += d[i + 2];
    bins.set(key, b);
  }
  const bg = [...bins.values()].reduce((a, b) => (b.n > a.n ? b : a));
  const bgc = [bg.r / bg.n, bg.g / bg.n, bg.b / bg.n];
  const dev = (x, y) => {
    const i = (y * w + x) * 4;
    return Math.hypot(d[i] - bgc[0], d[i + 1] - bgc[1], d[i + 2] - bgc[2]) > 70;
  };
  const pageH = Math.min(h, Math.round(w * 1.4142));
  const mean = (x0, x1, y0, y1) => {
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * w + x) * 4; r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
    return n ? [r / n, g / n, b / n] : [0, 0, 0];
  };
  // 抬头色块：从顶往下，整行大部分像素都不是底色
  let bandRows = 0;
  for (let y = 0; y < pageH * 0.45; y++) {
    let c = 0;
    for (let x = 0; x < w; x++) if (dev(x, y)) c++;
    if (c / w < 0.8) break;
    bandRows++;
  }
  // 侧栏：从左（右）往里，整列大部分像素都不是底色
  const sideWidth = (fromLeft) => {
    let cols = 0;
    for (let k = 0; k < w * 0.5; k++) {
      const x = fromLeft ? k : w - 1 - k;
      let c = 0;
      const y0 = Math.floor(pageH * 0.3), y1 = Math.floor(pageH * 0.9);
      for (let y = y0; y < y1; y++) if (dev(x, y)) c++;
      if (c / (y1 - y0) < 0.8) break;
      cols++;
    }
    return cols;
  };
  const left = sideWidth(true), right = sideWidth(false);
  const band = bandRows / pageH >= 0.05 ? { ratio: bandRows / pageH, color: mean(0, w, 1, Math.max(2, bandRows - 1)) } : null;
  const sideCols = Math.max(left, right);
  const side = sideCols / w >= 0.15 ? { ratio: sideCols / w, left: left >= right, color: mean(left >= right ? 1 : w - sideCols, left >= right ? sideCols : w - 1, Math.floor(pageH * 0.3), Math.floor(pageH * 0.9)) } : null;
  return { total: w * h, bg: bgc, band, side, bins: [...bins.values()].map((b) => [b.n, b.r / b.n, b.g / b.n, b.b / b.n]) };
})`;

const hex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;

function sat(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  return max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
}

/**
 * 参考图的主要颜色。让模型自己从图里估色值很不准，把量出来的色值一并给它。
 * 解码放在断网、不带页面脚本的浏览器里做，图片以 data URI 传入。
 */
export interface ImageAnalysis {
  colors: PaletteColor[];
  /** 用文字描述的版式事实：页面底色、抬头色块、侧栏。 */
  facts: string[];
}

export async function analyzeImage(data: Uint8Array, mimeType: string, limit = 6): Promise<ImageAnalysis> {
  const browser = await getBrowser();
  const context = await browser.newContext({ offline: true, serviceWorkers: "block" });
  try {
    await context.route("**/*", (route) => route.abort("blockedbyclient"));
    const page = await context.newPage();
    await page.setContent("<!doctype html><meta charset=utf-8><body></body>");
    const src = `data:${mimeType};base64,${Buffer.from(data).toString("base64")}`;
    const { total, bins, bg, band, side } = (await page.evaluate(`(${SCRIPT})(${JSON.stringify(src)})`)) as {
      total: number;
      bins: [number, number, number, number][];
      bg: [number, number, number];
      band: { ratio: number; color: [number, number, number] } | null;
      side: { ratio: number; left: boolean; color: [number, number, number] } | null;
    };
    const merged: { n: number; r: number; g: number; b: number }[] = [];
    for (const [n, r, g, b] of [...bins].sort((a, b) => b[0] - a[0])) {
      const near = merged.find((m) => Math.hypot(m.r - r, m.g - g, m.b - b) < 36);
      if (near) {
        const sum = near.n + n;
        near.r = (near.r * near.n + r * n) / sum;
        near.g = (near.g * near.n + g * n) / sum;
        near.b = (near.b * near.n + b * n) / sum;
        near.n = sum;
      } else merged.push({ n, r, g, b });
    }
    const luminance = ([r, g, b]: number[]) =>
      0.299 * (r as number) + 0.587 * (g as number) + 0.114 * (b as number);
    const facts = [
      `页面底色约 ${hex(...bg)}`,
      band
        ? `抬头是通栏的整块色块（${hex(...band.color)}，约占页面高度 ${Math.round(band.ratio * 100)}%），${luminance(band.color) < 140 ? "块内文字应为浅色" : "块内文字应为深色"}`
        : "抬头没有通栏色块",
      side
        ? `${side.left ? "左" : "右"}侧有一整列色块做侧栏（${hex(...side.color)}，约占页宽 ${Math.round(side.ratio * 100)}%）`
        : "没有侧栏色块（若是两栏，也只是靠留白分开）",
    ];
    const colors = merged
      .sort((a, b) => b.n - a.n)
      .slice(0, limit)
      .filter((m) => m.n / total >= 0.005)
      .map((m) => ({
        hex: hex(m.r, m.g, m.b),
        share: Math.round((m.n / total) * 1000) / 1000,
        chromatic: sat(m.r, m.g, m.b) > 0.25 && Math.max(m.r, m.g, m.b) > 50,
      }));
    return { colors, facts };
  } finally {
    await context.close();
  }
}

export function describePalette(colors: readonly PaletteColor[]): string {
  return colors
    .map((c) => `${c.hex}（${c.chromatic ? "彩色" : "黑白灰"}，约占 ${Math.round(c.share * 100)}%）`)
    .join("、");
}

export async function imagePalette(data: Uint8Array, mimeType: string, limit = 6): Promise<PaletteColor[]> {
  return (await analyzeImage(data, mimeType, limit)).colors;
}
