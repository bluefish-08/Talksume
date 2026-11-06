import type { ResumeContent } from "@talksume/core";
import type { BrowserContext } from "playwright";
import { FONT_ORIGIN, fontFaceCss as fontFace, fontFile } from "./font-files.ts";
import { renderFragment } from "./html.ts";
import type { RenderOptions } from "./types.ts";

/** 定制 CSS 用到内置字体时，给整页文档附上 @font-face（字体地址是只在本进程内应答的虚拟地址）。 */
export function withFonts(content: ResumeContent, options: RenderOptions): RenderOptions {
  if (!options.css) return options;
  const { fonts } = renderFragment(content, options);
  return fonts.length > 0 ? { ...options, fontFaces: fontFace(fonts, FONT_ORIGIN) } : options;
}

/** 在「全部拦截」之后注册，只放行虚拟字体地址：从本地文件应答，其余请求仍然全部拒绝。 */
export async function serveFonts(context: BrowserContext): Promise<void> {
  await context.route(`${FONT_ORIGIN}**`, (route) => {
    const file = new URL(route.request().url()).pathname.slice(1);
    const body = fontFile(file);
    if (!body) return route.abort("blockedbyclient");
    return route.fulfill({
      status: 200,
      contentType: "font/woff2",
      body,
      headers: { "access-control-allow-origin": "*" },
    });
  });
}

export { FONT_ORIGIN };
