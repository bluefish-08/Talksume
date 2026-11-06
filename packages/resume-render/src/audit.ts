import { clearCustomCss, type ResumeContent, type ResumeStyle } from "@talksume/core";
import { type LayoutCheck, type PngOptions, renderResumePng } from "./png.ts";

export interface StyleAudit {
  ok: boolean;
  problems: string[];
  check: LayoutCheck;
  /** 带样式渲染出来的整页图（缩略图用小比例、jpeg）。 */
  image: Uint8Array;
}

const chars = (t: string) => [...t.replace(/\s/g, "")].sort().join("");

/**
 * 保存定制 CSS 前的渲染复核：文字不能被盖住或隐藏，正文和去掉 CSS 后逐字一致。
 * 白名单管的是写法，这里管的是渲染出来的实际结果。
 */
export async function auditStyle(
  content: ResumeContent,
  style: ResumeStyle,
  image: PngOptions = { scale: 0.6, format: "jpeg" },
): Promise<StyleAudit> {
  const styled = await renderResumePng(content, style, image);
  const problems: string[] = [];
  const { check } = styled;
  if (check.covered > 0)
    problems.push(
      `有 ${check.covered} 处文字被装饰盖住了：伪元素用 z-index: -1 放到文字下面，或改成不和文字重叠的位置`,
    );
  if (check.hiddenText > 0) problems.push(`有 ${check.hiddenText} 处文字看不见（尺寸为 0、透明或被隐藏）`);
  if (style.css) {
    const plain = await renderResumePng(content, clearCustomCss(style), { scale: 0.3, format: "jpeg" });
    if (chars(plain.check.text) !== chars(check.text))
      problems.push("样式改变了简历里的文字内容，这是不允许的");
  }
  return { ok: problems.length === 0, problems, check, image: styled.png };
}
