export type TemplateName = "campus";

export interface RenderOptions {
  template?: TemplateName;
}

export const DEFAULT_TEMPLATE: TemplateName = "campus";

export const FONT_STACK_CSS = [
  '"Source Han Sans SC"',
  '"Noto Sans CJK SC"',
  '"PingFang SC"',
  '"Microsoft YaHei"',
  '"Hiragino Sans GB"',
  '"WenQuanYi Micro Hei"',
  "sans-serif",
].join(", ");
