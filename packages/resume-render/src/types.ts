import type { ResumeAccent, ResumeTemplate, ResumeTheme } from "@talksume/core";
import type { Density } from "./layout.ts";

export type TemplateName = ResumeTemplate;

export interface RenderOptions {
  template?: ResumeTemplate;
  accent?: ResumeAccent;
  /** 对话里定制的主题；校验不过时回落到 template/accent。 */
  theme?: ResumeTheme | undefined;
  /** 不传时按内容量自动选档。 */
  density?: Density;
}

export const FONT_STACK_CSS = [
  '"Source Han Sans SC"',
  '"Noto Sans CJK SC"',
  '"PingFang SC"',
  '"Microsoft YaHei"',
  '"Hiragino Sans GB"',
  '"WenQuanYi Micro Hei"',
  "sans-serif",
].join(", ");

export const SERIF_STACK_CSS = [
  '"Source Han Serif SC"',
  '"Noto Serif CJK SC"',
  '"Songti SC"',
  '"STSong"',
  '"SimSun"',
  "serif",
].join(", ");
