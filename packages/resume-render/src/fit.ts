import type { ResumeContent } from "@talksume/core";
import { getBrowser } from "./chromium.ts";
import { customCss } from "./custom-css.ts";
import { serveFonts, withFonts } from "./font-route.ts";
import { renderScreenHtml } from "./html.ts";
import type { Density } from "./layout.ts";
import type { RenderOptions } from "./types.ts";

const PAGE_HEIGHT_PX = 1123;
const ORDER: Density[] = ["normal", "compact", "tight"];

async function pagesOf(content: ResumeContent, options: RenderOptions): Promise<number> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    offline: true,
    serviceWorkers: "block",
    viewport: { width: 794, height: PAGE_HEIGHT_PX },
  });
  try {
    await context.route("**/*", (route) => route.abort("blockedbyclient"));
    await serveFonts(context);
    const page = await context.newPage();
    await page.setContent(renderScreenHtml(content, withFonts(content, options)), { waitUntil: "load" });
    await page.evaluate("document.fonts.ready.then(() => true)");
    const height = (await page.evaluate("Math.ceil(document.documentElement.scrollHeight)")) as number;
    return Math.max(1, Math.ceil((height - 2) / PAGE_HEIGHT_PX));
  } finally {
    await context.close();
  }
}

/**
 * 定制 CSS 会改变内容高度，按字数估算的档位不再可靠：超过一页时在浏览器里实测，逐档收紧。
 * 内容本来就放不下一页（实测最紧档仍超出）时保持自动档位，不为一页强压。
 */
export async function fitDensity(content: ResumeContent, options: RenderOptions): Promise<RenderOptions> {
  const skeleton = options.theme?.skeleton && options.theme.skeleton !== "classic";
  if (options.density || !(skeleton || (options.css && customCss(options)))) return options;
  if ((await pagesOf(content, options)) <= 1) return options;
  for (const density of ORDER) {
    const tried = { ...options, density };
    if ((await pagesOf(content, tried)) <= 1) return tried;
  }
  return options;
}
