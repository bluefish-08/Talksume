import type { ResumeContent } from "@talksume/core";
import { getBrowser } from "./chromium.ts";
import { fitDensity } from "./fit.ts";
import { serveFonts, withFonts } from "./font-route.ts";
import { renderScreenHtml } from "./html.ts";
import { renderResumePng } from "./png.ts";
import type { RenderOptions } from "./types.ts";

export interface DesignScore {
  /** 各项 1–5。 */
  hierarchy: number;
  alignment: number;
  whitespace: number;
  contrast: number;
  overall: number;
  /** 量出来的原始数据，方便看为什么扣分。 */
  facts: {
    nameRatio: number;
    headingRatio: number;
    alignShare: number;
    fill: number;
    minMargin: number;
    ink: number;
  };
}

const SCRIPT = `(() => {
  const root = document.querySelector(".resume");
  const page = root.getBoundingClientRect();
  const px = (el) => parseFloat(getComputedStyle(el).fontSize);
  const leaves = [...root.querySelectorAll("*")].filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
  const body = [...root.querySelectorAll("li")].map(px).sort((a, b) => a - b);
  const bodySize = body[Math.floor(body.length / 2)] || px(root);
  const h1 = root.querySelector("h1");
  const h2 = root.querySelector("h2");
  const weight = (e) => Number(getComputedStyle(e).fontWeight) || 400;
  const boxes = leaves.map((e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height }; }).filter((b) => b.w > 1 && b.h > 1);
  const wide = boxes.filter((b) => b.w > 40);
  const clusters = [];
  for (const b of wide) {
    const c = clusters.find((x) => Math.abs(x.l - b.l) <= 2);
    if (c) c.n++; else clusters.push({ l: b.l, n: 1 });
  }
  clusters.sort((a, b) => b.n - a.n);
  const top = clusters.slice(0, 4).reduce((s, c) => s + c.n, 0);
  const minL = Math.min(...boxes.map((b) => b.l));
  const maxR = Math.max(...boxes.map((b) => b.r));
  const maxB = Math.max(...boxes.map((b) => b.b));
  const ink = boxes.reduce((s, b) => s + b.w * b.h, 0) / (794 * Math.max(maxB, 1));
  return {
    name: h1 ? px(h1) : bodySize, nameWeight: h1 ? weight(h1) : 400,
    heading: h2 ? px(h2) : bodySize, headingWeight: h2 ? weight(h2) : 400,
    body: bodySize,
    alignShare: wide.length ? top / wide.length : 1,
    minMargin: Math.min(minL, 794 - maxR),
    fill: maxB / 1123,
    ink,
  };
})()`;

const grade = (value: number, steps: readonly number[]) => 1 + steps.filter((s) => value >= s).length;

/** 按设计标准量化一页简历：层级、对齐、留白、对比度，各 1–5 分。这是确定性的量化，不是审美评分。 */
export async function designScore(content: ResumeContent, input: RenderOptions = {}): Promise<DesignScore> {
  const options = await fitDensity(content, input);
  const browser = await getBrowser();
  const context = await browser.newContext({
    offline: true,
    serviceWorkers: "block",
    viewport: { width: 794, height: 1123 },
  });
  let m: {
    name: number;
    nameWeight: number;
    heading: number;
    headingWeight: number;
    body: number;
    alignShare: number;
    minMargin: number;
    fill: number;
    ink: number;
  };
  try {
    await context.route("**/*", (route) => route.abort("blockedbyclient"));
    await serveFonts(context);
    const page = await context.newPage();
    await page.setContent(renderScreenHtml(content, withFonts(content, options)), { waitUntil: "load" });
    await page.evaluate("document.fonts.ready.then(() => true)");
    m = (await page.evaluate(SCRIPT)) as typeof m;
  } finally {
    await context.close();
  }
  const nameRatio = m.name / m.body;
  const headingRatio = m.heading / m.body;
  const emphasized = headingRatio >= 1.04 || m.headingWeight >= 600;
  const hierarchy = Math.min(
    5,
    1 +
      (nameRatio >= 1.6 ? 1 : 0) +
      (nameRatio >= 2 ? 1 : 0) +
      (emphasized ? 1 : 0) +
      (nameRatio > headingRatio && nameRatio <= 3.6 ? 1 : 0),
  );
  const alignment = grade(m.alignShare, [0.45, 0.6, 0.75, 0.85]);
  const whitespace = Math.min(
    5,
    1 +
      (m.minMargin >= 32 ? 2 : m.minMargin >= 20 ? 1 : 0) +
      (m.fill >= 0.55 && m.fill <= 0.98 ? 2 : 0) +
      (m.ink >= 0.1 && m.ink <= 0.5 ? 1 : 0),
  );
  const { check } = await renderResumePng(content, input, { scale: 0.3, format: "jpeg" });
  const contrast = check.lowContrast === 0 ? 5 : check.lowContrast <= 2 ? 3 : 1;
  const overall = Math.round(((hierarchy + alignment + whitespace + contrast) / 4) * 100) / 100;
  return {
    hierarchy,
    alignment,
    whitespace,
    contrast,
    overall,
    facts: {
      nameRatio,
      headingRatio,
      alignShare: m.alignShare,
      fill: m.fill,
      minMargin: m.minMargin,
      ink: m.ink,
    },
  };
}
