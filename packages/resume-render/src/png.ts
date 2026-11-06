import type { ResumeContent } from "@talksume/core";
import type { Page } from "playwright";
import { getBrowser } from "./chromium.ts";
import { fitDensity } from "./fit.ts";
import { serveFonts, withFonts } from "./font-route.ts";
import { renderScreenHtml } from "./html.ts";
import type { RenderOptions } from "./types.ts";

export interface LayoutCheck {
  /** 内容高度按 A4 折算的页数。 */
  pages: number;
  /** 超出纸面右边缘的元素数。 */
  overflowX: number;
  /** 有文字却看不见（零尺寸、visibility、透明度）的元素数。 */
  hiddenText: number;
  /** 文字块之间明显重叠的对数。 */
  overlaps: number;
  /** 文字色与（纯色）底色对比度低于 3 的元素数；渐变或图片底不检查。 */
  lowContrast: number;
  /** 简历正文的纯文本，用来和没有定制 CSS 的渲染对比。 */
  text: string;
}

export interface PreviewImage {
  png: Uint8Array;
  width: number;
  height: number;
  check: LayoutCheck;
}

const PAGE_PX = { width: 794, height: 1123 };
const SCALE = 1.25;

/** 页面内的版式自检；脚本由我们注入，文档本身没有脚本也联不了网。 */
const CHECK_SCRIPT = `(() => {
  const root = document.querySelector(".resume");
  const page = document.querySelector(".page");
  const rect = (el) => el.getBoundingClientRect();
  const leaves = [...root.querySelectorAll("*")].filter((el) =>
    [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
  const texts = [];
  let hiddenText = 0;
  let overflowX = 0;
  const pageRight = rect(page).right + 1;
  const boxes = [];
  for (const el of leaves) {
    const r = rect(el);
    const cs = getComputedStyle(el);
    if (r.width < 1 || r.height < 1 || cs.visibility !== "visible" || cs.display === "none" || Number(cs.opacity) < 0.4) hiddenText++;
    else {
      const m = cs.color.match(/[\\d.]+/g);
      if (m && Number(m[3] ?? 1) > 0.5) texts.push({ x: r.left, y: r.top + window.scrollY, w: r.width, h: r.height, c: [+m[0], +m[1], +m[2]] });
      r.el = el;
      boxes.push(r);
      if (r.right > pageRight) overflowX++;
    }
  }
  let overlaps = 0;
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w > 2 && h > 2 && (w * h) / Math.min(a.width * a.height, b.width * b.height) > 0.3) overlaps++;
    }
  }
  const height = Math.ceil(document.documentElement.scrollHeight);
  return { pages: Math.max(1, Math.ceil((height - 2) / ${PAGE_PX.height})), overflowX, hiddenText, overlaps, texts, text: root.textContent.replace(/\\s+/g, " ").trim(), height };
})()`;

interface TextBox {
  x: number;
  y: number;
  w: number;
  h: number;
  c: [number, number, number];
}

/** 文字先全部隐去再截一张纯背景图，在每个文字块处取样底色，连渐变、伪元素色块都能算进去。 */
async function countLowContrast(page: Page, texts: TextBox[]): Promise<number> {
  if (texts.length === 0) return 0;
  const hide =
    "*,*::before,*::after{color:transparent!important;text-shadow:none!important;-webkit-text-fill-color:transparent!important}";
  await page.evaluate(`(() => {
    const el = document.createElement("style");
    el.id = "__hide_text";
    el.textContent = ${JSON.stringify(hide)};
    document.head.append(el);
  })()`);
  const bg = await page.screenshot({ type: "png", fullPage: true });
  await page.evaluate(`document.getElementById("__hide_text")?.remove()`);
  return (await page.evaluate(`(async () => {
    const boxes = ${JSON.stringify(texts)};
    const scale = ${SCALE};
    const img = new Image();
    img.src = "data:image/png;base64,${bg.toString("base64")}";
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const lum = (r, g, b) => {
      const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    let low = 0;
    for (const b of boxes) {
      const ys = [];
      for (const fx of [0.15, 0.5, 0.85]) {
        const px = ctx.getImageData(Math.round((b.x + b.w * fx) * scale), Math.round((b.y + b.h * 0.5) * scale), 1, 1).data;
        ys.push(lum(px[0], px[1], px[2]));
      }
      ys.sort((p, q) => p - q);
      const fg = lum(b.c[0], b.c[1], b.c[2]);
      if ((Math.max(ys[1], fg) + 0.05) / (Math.min(ys[1], fg) + 0.05) < 3) low++;
    }
    return low;
  })()`)) as number;
}

/** 把当前样式渲染成一张整页 PNG 并做版式自检；断网，文档里没有脚本。 */
export async function renderResumePng(
  content: ResumeContent,
  input: RenderOptions = {},
): Promise<PreviewImage> {
  const options = await fitDensity(content, input);
  const browser = await getBrowser();
  const context = await browser.newContext({
    offline: true,
    serviceWorkers: "block",
    viewport: { width: PAGE_PX.width, height: PAGE_PX.height },
    deviceScaleFactor: SCALE,
  });
  try {
    await context.route("**/*", (route) => route.abort("blockedbyclient"));
    await serveFonts(context);
    const page = await context.newPage();
    await page.setContent(renderScreenHtml(content, withFonts(content, options)), { waitUntil: "load" });
    await page.evaluate("document.fonts.ready.then(() => true)");
    const { height, texts, ...rest } = (await page.evaluate(CHECK_SCRIPT)) as Omit<
      LayoutCheck,
      "lowContrast"
    > & {
      height: number;
      texts: TextBox[];
    };
    const lowContrast = await countLowContrast(page, texts);
    const check: LayoutCheck = { ...rest, lowContrast };
    const png = await page.screenshot({ type: "png", fullPage: true });
    return {
      png: new Uint8Array(png),
      width: Math.round(PAGE_PX.width * SCALE),
      height: Math.round(height * SCALE),
      check,
    };
  } finally {
    await context.close();
  }
}

/** 把任意 HTML 渲染成整页 PNG（断网、禁脚本），评测里用来生成参考图。 */
export async function htmlToPng(html: string): Promise<Uint8Array> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    javaScriptEnabled: false,
    offline: true,
    serviceWorkers: "block",
    viewport: { width: PAGE_PX.width, height: PAGE_PX.height },
    deviceScaleFactor: SCALE,
  });
  try {
    await context.route("**/*", (route) => route.abort("blockedbyclient"));
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: "load" });
    return new Uint8Array(await page.screenshot({ type: "png", fullPage: true }));
  } finally {
    await context.close();
  }
}
