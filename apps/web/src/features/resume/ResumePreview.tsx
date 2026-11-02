import { DEFAULT_RESUME_STYLE, type ResumeStyle } from "@talksume/core";
import { renderFragment } from "@talksume/resume-render/browser";
import { useEffect, useId, useLayoutEffect, useMemo, useRef } from "react";
import type { ResumeContent } from "../../api/types.ts";
import styles from "./ResumePreview.module.css";

export interface FactQuote {
  quote: string;
  /** 这句原话是用户第几轮说的；无法确定时省略。 */
  round?: number;
}

type ResumeItem = ResumeContent["sections"][number]["items"][number];

interface Props {
  resume: ResumeContent;
  resumeStyle?: ResumeStyle | undefined;
  /** 刚写入的条目标题或要点原文，命中的会高亮并带「刚刚添加」标记。 */
  highlightTexts?: ReadonlySet<string>;
  /** factId → 原话，用于悬停溯源。 */
  facts?: Readonly<Record<string, FactQuote>>;
  /** 高亮变化时把第一处高亮滚进视野。 */
  revealHighlight?: boolean;
  /** 还没内容的分区标题，渲染为浅色占位。 */
  placeholders?: readonly string[];
  /** 缩略图只看版式，不加高亮、溯源和占位。 */
  decorated?: boolean;
  label?: string;
  className?: string;
  /** 放进按钮里当缩略图时用 span，保持合法的短语内容。 */
  as?: "article" | "span";
}

const A4_WIDTH_PX = (210 / 25.4) * 96;

// 高亮、标记、溯源浮层只在网页预览里叠加；字号按缩放反算，保证缩小的纸面上仍可读
const PREVIEW_CSS = `
:host { all: initial; display: block; }
.page { box-sizing: border-box; width: 210mm; min-height: 297mm; background: #fff; zoom: var(--zoom, 1); }
.resume .item, .resume .skill-line { position: relative; }
.resume .hl { background: #eef3fe; box-shadow: 0 0 0 3pt #eef3fe, 0 0 0 calc(3pt + 1px) #bfd3f8; border-radius: 1px; }
.resume .hl .hl { box-shadow: none; }
.resume .new-tag { position: absolute; right: 0; top: calc(-9px / var(--zoom, 1)); z-index: 1; padding: 0 calc(6px / var(--zoom, 1));
  border-radius: calc(4px / var(--zoom, 1)); background: #2563eb; color: #fff; font: 400 calc(11px / var(--zoom, 1)) / calc(18px / var(--zoom, 1)) -apple-system, "PingFang SC", sans-serif;
  white-space: nowrap; text-indent: 0; }
.resume .traceable { cursor: help; border-radius: 1px; outline: none; }
.resume .traceable:hover, .resume .traceable:focus-visible { background: #f0f4fa; box-shadow: 0 0 0 3pt #f0f4fa; }
.resume .hl.traceable:hover, .resume .hl.traceable:focus-visible { background: #e3ecfd; box-shadow: 0 0 0 3pt #e3ecfd, 0 0 0 calc(3pt + 1px) #bfd3f8; }
.resume .pop { display: none; position: absolute; left: 1em; top: calc(100% + 4px); z-index: 3; width: min(calc(300px / var(--zoom, 1)), 92%);
  flex-direction: column; gap: calc(4px / var(--zoom, 1)); padding: calc(10px / var(--zoom, 1)) calc(12px / var(--zoom, 1));
  border-radius: calc(10px / var(--zoom, 1)); background: #0f1b2e; color: #e8eef8; box-shadow: 0 10px 24px rgba(15, 27, 46, 0.14);
  font: 400 calc(12px / var(--zoom, 1)) / 1.6 -apple-system, "PingFang SC", sans-serif; text-align: left; letter-spacing: 0; }
.resume .traceable:hover > .pop, .resume .traceable:focus-visible > .pop { display: flex; }
.resume .pop-head { color: #9fb3d1; }
.resume .ph-text { opacity: 0.4; }
.resume .ph h2 { opacity: 0.4; }
.resume .ph .bar { height: 6pt; margin-top: 5pt; border-radius: 3pt; background: #eef1f6; }
.resume .blank { margin-top: 28pt; text-align: center; color: #8593a8; font-size: 10.5pt; }
`;

interface Decoration {
  highlightTexts: ReadonlySet<string> | undefined;
  facts: Props["facts"];
  placeholders: readonly string[];
  idPrefix: string;
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function attachSources(target: HTMLElement, factIds: readonly string[], d: Decoration, id: string) {
  const sources = [
    ...new Map(
      factIds.flatMap((fid) => {
        const f = d.facts?.[fid];
        return f?.quote ? [[f.quote, f] as const] : [];
      }),
    ).values(),
  ].slice(0, 3);
  if (sources.length === 0) return;
  const round = sources.length === 1 ? sources[0]?.round : undefined;
  const pop = el("span", "pop");
  pop.id = id;
  pop.setAttribute("role", "tooltip");
  pop.append(el("span", "pop-head", `出自你的原话${round ? ` · 第 ${round} 轮` : ""}`));
  for (const s of sources) pop.append(el("span", "", `「${s.quote}」`));
  target.classList.add("traceable");
  // 键盘聚焦也要能看到出处
  target.tabIndex = 0;
  target.setAttribute("aria-describedby", id);
  target.append(pop);
}

function decorate(root: ShadowRoot, resume: ResumeContent, d: Decoration) {
  const page = root.querySelector<HTMLElement>(".resume");
  if (!page) return;
  const has = (text: string) => d.highlightTexts?.has(text) ?? false;
  const itemAt = (key: string | undefined): ResumeItem | undefined => {
    const [s, i] = (key ?? "").split("-").map(Number);
    return resume.sections[s ?? -1]?.items[i ?? -1];
  };

  const name = root.querySelector<HTMLElement>(".head h1");
  if (name && !resume.basics.name) {
    name.textContent = "你的姓名";
    name.classList.add("ph-text");
  }

  for (const node of root.querySelectorAll<HTMLElement>("[data-item]")) {
    const item = itemAt(node.dataset.item);
    if (!item) continue;
    const skill = node.classList.contains("skill-line");
    const itemNew = has(item.heading) || (skill && item.bullets.some((b) => has(b.text)));
    if (itemNew) {
      node.classList.add("hl");
      (node.querySelector(".item-head") ?? node).append(el("span", "new-tag", "刚刚添加"));
    }
    if (skill) {
      attachSources(
        node,
        item.bullets.flatMap((b) => b.factIds),
        d,
        `${d.idPrefix}-${node.dataset.item}`,
      );
      continue;
    }
    for (const li of node.querySelectorAll<HTMLElement>("[data-bullet]")) {
      const index = Number(li.dataset.bullet?.split("-")[2]);
      const bullet = item.bullets[index];
      if (!bullet) continue;
      if (!itemNew && has(bullet.text)) {
        li.classList.add("hl");
        li.append(el("span", "new-tag", "刚刚添加"));
      }
      attachSources(li, bullet.factIds, d, `${d.idPrefix}-${li.dataset.bullet}`);
    }
  }

  for (const title of d.placeholders) {
    const section = el("section", "ph");
    section.setAttribute("aria-hidden", "true");
    const body = el("div", "sec-body");
    for (const width of ["72%", "50%"]) {
      const bar = el("div", "bar");
      bar.style.width = width;
      body.append(bar);
    }
    section.append(el("h2", "", title), body);
    page.append(section);
  }

  if (!resume.basics.name && resume.sections.length === 0 && d.placeholders.length === 0) {
    page.append(el("p", "blank", "聊几句之后，简历会在这里一点点长出来。"));
  }
}

/** 预览直接挂 renderFragment 的输出，和 PDF 同一份 HTML/CSS；shadow DOM 隔离宿主样式。 */
export function ResumePreview({
  resume,
  resumeStyle = DEFAULT_RESUME_STYLE,
  highlightTexts,
  revealHighlight = false,
  facts,
  placeholders = [],
  decorated = true,
  label = "简历预览",
  className,
  as: Tag = "article",
}: Props) {
  const host = useRef<HTMLElement>(null);
  const idPrefix = useId().replace(/:/g, "");
  const { template, accent } = resumeStyle;
  const fragment = useMemo(() => renderFragment(resume, { template, accent }), [resume, template, accent]);
  const highlightKey = [...(highlightTexts ?? [])].join("\u0000");
  const factsKey = JSON.stringify(facts ?? {});
  const placeholdersKey = placeholders.join("\u0000");

  // biome-ignore lint/correctness/useExhaustiveDependencies: 用序列化后的 key 判断变化，避免父组件每次重渲染都重建预览
  useLayoutEffect(() => {
    const node = host.current;
    if (!node) return;
    const root = node.shadowRoot ?? node.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${fragment.css}${PREVIEW_CSS}</style><div class="page" style="padding: ${fragment.margin}">${fragment.html}</div>`;
    if (decorated) decorate(root, resume, { highlightTexts, facts, placeholders, idPrefix });
  }, [fragment, decorated, highlightKey, factsKey, placeholdersKey, idPrefix]);

  useEffect(() => {
    if (!revealHighlight || !highlightKey) return;
    host.current?.shadowRoot?.querySelector(".hl")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [revealHighlight, highlightKey]);

  useLayoutEffect(() => {
    const node = host.current;
    if (!node) return;
    const fit = () => node.style.setProperty("--zoom", String(Math.min(1, node.clientWidth / A4_WIDTH_PX)));
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <Tag
      ref={host}
      className={className ? `${styles.sheet} ${className}` : styles.sheet}
      aria-label={label}
      data-template={template}
    />
  );
}
