import type { ResumeContent } from "@talksume/core";
import { type Browser, chromium } from "playwright";
import { renderHtml } from "./html.ts";
import type { RenderOptions } from "./types.ts";

let browserPromise: Promise<Browser> | undefined;

function getBrowser(): Promise<Browser> {
  if (browserPromise) return browserPromise;
  const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH;
  const launching = chromium.launch(executablePath ? { executablePath } : {});
  browserPromise = launching;
  const reset = () => {
    if (browserPromise === launching) browserPromise = undefined;
  };
  launching.then((browser) => browser.on("disconnected", reset), reset);
  return launching;
}

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
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: "load" });
    const buffer = await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
    return new Uint8Array(buffer);
  } finally {
    await context.close();
  }
}

export function renderPdf(content: ResumeContent, options: RenderOptions = {}): Promise<Uint8Array> {
  return htmlToPdf(renderHtml(content, options));
}

export async function close(): Promise<void> {
  const pending = browserPromise;
  browserPromise = undefined;
  if (pending) await (await pending).close();
}
