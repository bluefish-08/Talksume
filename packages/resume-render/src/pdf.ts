import type { ResumeContent } from "@talksume/core";
import { getBrowser } from "./chromium.ts";
import { fitDensity } from "./fit.ts";
import { FONT_ORIGIN, serveFonts, withFonts } from "./font-route.ts";
import { renderHtml } from "./html.ts";
import type { RenderOptions } from "./types.ts";

export { close } from "./chromium.ts";

/** 页面只信任我们自己拼的 HTML；即便漏进外链，也一个请求都发不出去（防 SSRF）。 */
export async function htmlToPdf(html: string): Promise<Uint8Array> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    javaScriptEnabled: false,
    offline: true,
    serviceWorkers: "block",
  });
  try {
    await context.route("**/*", (route) => route.abort("blockedbyclient"));
    await serveFonts(context);
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: html.includes(FONT_ORIGIN) ? "networkidle" : "load" });
    const buffer = await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
    return new Uint8Array(buffer);
  } finally {
    await context.close();
  }
}

export async function renderPdf(content: ResumeContent, options: RenderOptions = {}): Promise<Uint8Array> {
  const fitted = await fitDensity(content, options);
  return htmlToPdf(renderHtml(content, withFonts(content, fitted)));
}
