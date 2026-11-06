import type { ResumeContent, ResumeStyle } from "@talksume/core";
import { sanitizeResumeCss } from "@talksume/core";
import { auditStyle } from "./audit.ts";

/** 装饰层和隐藏文字方向的恶意 CSS：每条都应被白名单丢弃、被渲染审计判失败，或被标成低对比。 */
export const ATTACKS: { id: string; css: string }[] = [
  {
    id: "cover-item",
    css: ".item::after { content: ''; position: absolute; top: 0; left: 0; width: 100%; height: 100%; background-color: #ffffff }",
  },
  {
    id: "cover-section-number",
    css: "section::before { content: '07'; position: absolute; top: 0; left: 0; width: 100%; height: 100%; background-color: #ffffff }",
  },
  {
    id: "cover-fixed",
    css: ".head::after { content: ''; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: #ffffff }",
  },
  {
    id: "arbitrary-content",
    css: ".head::before { content: '联系我 evil-recruiter'; color: var(--accent) }",
  },
  { id: "attr-content", css: ".head::before { content: attr(data-evil) }" },
  { id: "url-content", css: "li::before { content: url(http://evil.example.com/a.png) }" },
  { id: "url-background", css: ".head { background: url(http://evil.example.com/a.png) }" },
  { id: "import", css: "@import url(http://evil.example.com/a.css); .head { color: red }" },
  { id: "font-face", css: "@font-face { font-family: x; src: url(http://evil.example.com/f.woff2) }" },
  { id: "display-none", css: "h1 { display: none }" },
  { id: "visibility-hidden", css: ".contacts { visibility: hidden }" },
  { id: "opacity-zero", css: ".summary { opacity: 0 }" },
  { id: "font-size-zero", css: ".item-title { font-size: 0 }" },
  { id: "transform-body", css: ".summary { transform: translateX(9999px) }" },
  { id: "clip-body", css: ".item { clip-path: inset(0 0 100% 0) }" },
  { id: "text-indent-hide", css: ".item-title { text-indent: -9999px }" },
  { id: "universal-selector", css: "* { visibility: hidden }" },
  { id: "body-selector", css: "body { display: none }" },
  { id: "white-on-white", css: ".item-title { color: #ffffff }" },
  { id: "expression", css: ".head { width: expression(alert(1)) }" },
  { id: "behavior", css: ".head { behavior: url(x.htc); -moz-binding: url(x.xml#a) }" },
  { id: "important", css: ".head { color: red !important }" },
];

export interface AttackResult {
  id: string;
  blocked: boolean;
  how: "sanitizer" | "dropped" | "audit" | "flagged" | "none";
}

/** 同一套保存前流程：白名单 → 渲染审计；低对比只标记不拦截，算「标记」。 */
export async function runAttack(
  attack: { id: string; css: string },
  content: ResumeContent,
  base: ResumeStyle,
): Promise<AttackResult> {
  const sanitized = sanitizeResumeCss(attack.css);
  if (!sanitized.ok) return { id: attack.id, blocked: true, how: "sanitizer" };
  if (!sanitized.css.trim()) return { id: attack.id, blocked: true, how: "dropped" };
  const audited = await auditStyle(content, { ...base, css: sanitized.css }, { scale: 0.3, format: "jpeg" });
  if (!audited.ok) return { id: attack.id, blocked: true, how: "audit" };
  if (audited.check.lowContrast > 0) return { id: attack.id, blocked: true, how: "flagged" };
  return { id: attack.id, blocked: false, how: "none" };
}
