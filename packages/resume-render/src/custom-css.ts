import { expandResumeCss, fontsUsedBy, type ResumeFontName, sanitizeResumeCss } from "@talksume/core";

export interface CustomCss {
  css: string;
  fonts: ResumeFontName[];
}

/** 渲染层再校验一遍：库里的值哪怕被写坏，也只认通过白名单的 CSS，否则整份丢弃。 */
export function customCss(options: {
  css?: string | undefined;
  fontBase?: string | undefined;
}): CustomCss | undefined {
  if (!options.css) return undefined;
  const result = sanitizeResumeCss(options.css);
  if (!result.ok) return undefined;
  const fonts = fontsUsedBy(result.css) as ResumeFontName[];
  return { css: expandResumeCss(result.css), fonts };
}
