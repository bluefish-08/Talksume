import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

interface Browser {
  newContext(o: { offline: boolean }): Promise<{
    newPage(): Promise<{ setContent(h: string): Promise<void>; evaluate(s: string): Promise<unknown> }>;
    close(): Promise<void>;
  }>;
}

const chromium = resolve(dirname(fileURLToPath(import.meta.url)), "../../../resume-render/src/chromium.ts");

export const mean = (xs: readonly number[]): number | null =>
  xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;

/** 同组每两版特征不同的比例，再取平均。 */
export function featureDistance(options: readonly Record<string, string>[]): number {
  const dists: number[] = [];
  for (let i = 0; i < options.length; i++) {
    for (let j = i + 1; j < options.length; j++) {
      const a = options[i] ?? {};
      const b = options[j] ?? {};
      const keys = Object.keys(a);
      dists.push(keys.filter((k) => a[k] !== b[k]).length / Math.max(1, keys.length));
    }
  }
  return mean(dists) ?? 0;
}

const DECODE = `(async (urls) => {
  const W = 48, H = 68;
  const out = [];
  for (const u of urls) {
    const img = new Image(); img.src = u; await img.decode();
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(img, 0, 0, W, H);
    const d = g.getImageData(0, 0, W, H).data;
    const px = [];
    for (let i = 0; i < d.length; i += 4) px.push(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    out.push(px);
  }
  return out;
})`;

/** 每组缩略图两两的平均像素差（灰度，0–1），在断网的浏览器里解码。 */
export async function imageDistances(groups: readonly (readonly string[])[]): Promise<number | null> {
  const { getBrowser } = (await import(pathToFileURL(chromium).href)) as {
    getBrowser: () => Promise<Browser>;
  };
  const browser = await getBrowser();
  const context = await browser.newContext({ offline: true });
  try {
    const page = await context.newPage();
    await page.setContent("<!doctype html><meta charset=utf-8><body></body>");
    const dists: number[] = [];
    for (const urls of groups) {
      const px = (await page.evaluate(`(${DECODE})(${JSON.stringify(urls)})`)) as number[][];
      for (let i = 0; i < px.length; i++) {
        for (let j = i + 1; j < px.length; j++) {
          const a = px[i] ?? [];
          const b = px[j] ?? [];
          let sum = 0;
          for (let k = 0; k < a.length; k++) sum += Math.abs((a[k] ?? 0) - (b[k] ?? 0));
          dists.push(sum / a.length / 255);
        }
      }
    }
    return mean(dists);
  } finally {
    await context.close();
  }
}
