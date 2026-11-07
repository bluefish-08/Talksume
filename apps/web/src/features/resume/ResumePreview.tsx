import { DEFAULT_RESUME_STYLE, type ResumeStyle } from "@talksume/core";
import { renderFragment } from "@talksume/resume-render/browser";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef } from "react";
import type { ResumeContent } from "../../api/types.ts";
import styles from "./ResumePreview.module.css";
import { PAPER_WIDTH_PX } from "./workbench.ts";

export interface FactQuote {
  quote: string;
  /** 这句原话是用户第几轮说的；无法确定时省略。 */
  round?: number;
  fromResume?: boolean;
}

export interface ChangeNote {
  label: string;
  /** 与聊天卡片一致的编号。 */
  number?: number;
  /** 改动前的样子，一行一段。 */
  before: string[];
}

/** 定制版里的改动，命中的地方高亮并在浮层里给出原文。 */
export interface ChangeMarks {
  summary?: ChangeNote;
  /** 改写后的要点原文 → */
  bullets: ReadonlyMap<string, ChangeNote>;
  /** 调整过要点顺序的条目标题 → */
  items: ReadonlyMap<string, ChangeNote>;
  /** 调整过条目顺序的分区 kind → */
  sections: ReadonlyMap<string, ChangeNote>;
}

type ResumeItem = ResumeContent["sections"][number]["items"][number];

interface Props {
  resume: ResumeContent;
  resumeStyle?: ResumeStyle | undefined;
  /** 刚写入的条目标题或要点原文，命中的会高亮并带「刚刚添加」标记。 */
  highlightTexts?: ReadonlySet<string>;
  /** factId → 原话，用于悬停溯源。 */
  facts?: Readonly<Record<string, FactQuote>>;
  changeMarks?: ChangeMarks | undefined;
  /** 高亮变化时把第一处高亮滚进视野。 */
  revealHighlight?: boolean;
  /** 还没内容的分区标题，渲染为浅色占位。 */
  placeholders?: readonly string[];
  /** 缩略图只看版式，不加高亮、溯源和占位。 */
  decorated?: boolean;
  label?: string;
  className?: string;
  /** 指定缩放比例；不传则按容器宽度自适应（最大 100%）。 */
  scale?: number;
  /** 放进按钮里当缩略图时用 span，保持合法的短语内容。 */
  as?: "article" | "span";
}

// 高亮、标记、溯源浮层只在网页预览里叠加；字号按缩放反算，保证缩小的纸面上仍可读
const PREVIEW_CSS = `
html, body { margin: 0; padding: 0; background: #fff; overflow: hidden; }
.page { box-sizing: border-box; width: 210mm; min-height: 297mm; background: #fff; }
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
.resume section > h2, .resume li.changed, .resume .summary.changed { position: relative; }
.resume .changed { background: #fdf6e3; box-shadow: 0 0 0 3pt #fdf6e3, 0 0 0 calc(3pt + 1px) #ecd28f; border-radius: 1px; border-left: 2px solid #2563eb; padding-left: calc(8px / var(--zoom, 1)); }
.resume .change-no { position: absolute; left: calc(-26px / var(--zoom, 1)); top: calc(1px / var(--zoom, 1)); width: calc(14px / var(--zoom, 1)); height: calc(14px / var(--zoom, 1)); border-radius: 50%; background: #2563eb; color: #fff; font: 400 calc(9px / var(--zoom, 1)) / calc(14px / var(--zoom, 1)) -apple-system, "PingFang SC", sans-serif; text-align: center; text-indent: 0; }
.resume .changed.traceable:hover, .resume .changed.traceable:focus-visible { background: #fbefcc; box-shadow: 0 0 0 3pt #fbefcc, 0 0 0 calc(3pt + 1px) #ecd28f; }
.resume .changed .changed { box-shadow: none; }
.resume .new-tag.tailor-tag { background: #b7791f; }
.resume .ph-text { opacity: 0.4; }
.resume .ph h2 { opacity: 0.4; }
.resume .ph .bar { height: 6pt; margin-top: 5pt; border-radius: 3pt; background: #eef1f6; }
.resume .blank { margin-top: 28pt; text-align: center; color: #8593a8; font-size: 10.5pt; }
`;

interface Decoration {
  highlightTexts: ReadonlySet<string> | undefined;
  facts: Props["facts"];
  changes: ChangeMarks | undefined;
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
  const head = sources.every((s) => s.fromResume)
    ? "出自你的简历原文"
    : `出自你的原话${round ? ` · 第 ${round} 轮` : ""}`;
  pop.append(el("span", "pop-head", head));
  for (const s of sources) pop.append(el("span", "", `「${s.quote}」`));
  target.classList.add("traceable");
  // 键盘聚焦也要能看到出处
  target.tabIndex = 0;
  target.setAttribute("aria-describedby", id);
  target.append(pop);
}

function markChanged(target: HTMLElement, note: ChangeNote, id: string, tagHost: HTMLElement = target) {
  target.classList.add("changed", "traceable");
  tagHost.append(el("span", "new-tag tailor-tag", "已定制"));
  if (note.number !== undefined) target.append(el("span", "change-no", String(note.number)));
  const pop = el("span", "pop");
  pop.id = id;
  pop.setAttribute("role", "tooltip");
  pop.append(el("span", "pop-head", `${note.label} · 原文`));
  for (const line of note.before) pop.append(el("span", "", line));
  target.tabIndex = 0;
  target.setAttribute("aria-describedby", id);
  target.append(pop);
}

function decorateChanges(root: ParentNode, resume: ResumeContent, marks: ChangeMarks, idPrefix: string) {
  const summary = root.querySelector<HTMLElement>(".head .summary");
  if (summary && marks.summary) markChanged(summary, marks.summary, `${idPrefix}-summary`);
  for (const section of root.querySelectorAll<HTMLElement>("section[data-kind]")) {
    const note = marks.sections.get(section.dataset.kind ?? "");
    const h2 = section.querySelector<HTMLElement>("h2");
    if (note && h2) markChanged(h2, note, `${idPrefix}-s${section.dataset.section}`);
  }
  for (const node of root.querySelectorAll<HTMLElement>("[data-item]")) {
    const [s, i] = (node.dataset.item ?? "").split("-").map(Number);
    const item = resume.sections[s ?? -1]?.items[i ?? -1];
    if (!item) continue;
    const order = marks.items.get(item.heading);
    if (order)
      markChanged(node, order, `${idPrefix}-${node.dataset.item}`, node.querySelector(".item-head") ?? node);
    for (const li of node.querySelectorAll<HTMLElement>("[data-bullet]")) {
      const bullet = item.bullets[Number(li.dataset.bullet?.split("-")[2])];
      const note = bullet && marks.bullets.get(bullet.text);
      if (note) markChanged(li, note, `${idPrefix}-${li.dataset.bullet}`);
    }
  }
}

function decorate(root: ParentNode, resume: ResumeContent, d: Decoration) {
  const page = root.querySelector<HTMLElement>(".resume");
  if (!page) return;
  const has = (text: string) => d.highlightTexts?.has(text) ?? false;
  const itemAt = (key: string | undefined): ResumeItem | undefined => {
    const [s, i] = (key ?? "").split("-").map(Number);
    return resume.sections[s ?? -1]?.items[i ?? -1];
  };

  if (d.changes) {
    decorateChanges(root, resume, d.changes, d.idPrefix);
    return;
  }

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

  const phHost =
    page.querySelector<HTMLElement>(".main") ?? page.querySelector<HTMLElement>(".frame") ?? page;
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
    phHost.append(section);
  }

  if (!resume.basics.name && resume.sections.length === 0 && d.placeholders.length === 0) {
    page.append(el("p", "blank", "聊几句之后，简历会在这里一点点长出来。"));
  }
}

/** 预览文档的 CSP：没有脚本、没有网络，图片只认内置素材的 data URI。 */
const FRAME_CSP =
  "default-src 'none'; style-src 'unsafe-inline' 'self'; img-src data:; font-src 'self' data:";

/** 先在脱离页面的文档里做高亮、溯源这些装饰，再序列化成 srcdoc，iframe 里没有脚本。 */
function buildDocument(
  fragment: ReturnType<typeof renderFragment>,
  resume: ResumeContent,
  decoration: Decoration | undefined,
): string {
  const parsed = new DOMParser().parseFromString(
    `<!doctype html><body><div class="page" style="padding: ${fragment.margin}">${fragment.html}</div></body>`,
    "text/html",
  );
  if (decoration) decorate(parsed.body, resume, decoration);
  // 样式都是我们生成或白名单过滤过的，仍防一手提前闭合 style 标签
  const css = /<\/style/i.test(fragment.css) ? "" : fragment.css;
  const fonts =
    fragment.fonts.length > 0
      ? `<link rel="stylesheet" href="/api/v1/resume-fonts/faces.css?f=${fragment.fonts.join(",")}">`
      : "";
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}">${fonts}<style>${css}${PREVIEW_CSS}</style></head><body>${parsed.body.innerHTML}</body></html>`;
}

/**
 * 预览挂在 sandbox iframe 里（srcdoc，不给 allow-scripts），和 PDF 同一份 HTML/CSS。
 * allow-same-origin 只用来让外层量高度和滚动；iframe 里没有脚本可跑。
 */
export function ResumePreview({
  resume,
  resumeStyle = DEFAULT_RESUME_STYLE,
  highlightTexts,
  revealHighlight = false,
  facts,
  changeMarks,
  placeholders = [],
  decorated = true,
  label = "简历预览",
  className,
  scale,
  as: Tag = "article",
}: Props) {
  const host = useRef<HTMLElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const zoom = useRef(1);
  const idPrefix = useId().replace(/:/g, "");
  const { template, accent, theme, css } = resumeStyle;
  const fragment = useMemo(
    () => renderFragment(resume, { template, accent, theme, css }),
    [resume, template, accent, theme, css],
  );
  const highlightKey = [...(highlightTexts ?? [])].join("\u0000");
  const factsKey = JSON.stringify(facts ?? {});
  const placeholdersKey = placeholders.join("\u0000");
  const changesKey = JSON.stringify(
    changeMarks && Object.values(changeMarks).map((v) => (v instanceof Map ? [...v] : v)),
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: 用序列化后的 key 判断变化，避免父组件每次重渲染都重建预览
  const srcDoc = useMemo(
    () =>
      buildDocument(
        fragment,
        resume,
        decorated ? { highlightTexts, facts, changes: changeMarks, placeholders, idPrefix } : undefined,
      ),
    [fragment, decorated, highlightKey, factsKey, changesKey, placeholdersKey, idPrefix],
  );

  const sync = useCallback(() => {
    const el = frame.current;
    const doc = el?.contentDocument;
    if (!el || !doc?.documentElement) return;
    doc.documentElement.style.setProperty("--zoom", String(zoom.current));
    el.style.height = `${doc.documentElement.scrollHeight}px`;
  }, []);

  const onLoad = useCallback(() => {
    sync();
    const doc = frame.current?.contentDocument;
    if (doc?.documentElement) new ResizeObserver(sync).observe(doc.documentElement);
  }, [sync]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: srcDoc 换了要重新滚到高亮处
  useEffect(() => {
    if (!revealHighlight || !highlightKey) return;
    frame.current?.contentDocument
      ?.querySelector(".hl")
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [revealHighlight, highlightKey, srcDoc]);

  useLayoutEffect(() => {
    const node = host.current;
    if (!node) return;
    const apply = (value: number) => {
      zoom.current = value;
      node.style.setProperty("--zoom", String(value));
      sync();
    };
    if (scale !== undefined) {
      apply(scale);
      return;
    }
    const fit = () => apply(Math.min(1, node.clientWidth / PAPER_WIDTH_PX));
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(node);
    return () => observer.disconnect();
  }, [scale, sync]);

  return (
    <Tag
      ref={host}
      className={className ? `${styles.sheet} ${className}` : styles.sheet}
      aria-label={label}
      data-template={template}
      style={scale === undefined ? undefined : { width: PAPER_WIDTH_PX * scale }}
    >
      <iframe
        ref={frame}
        className={`${styles.frame}${decorated && Tag === "article" ? "" : ` ${styles.inert}`}`}
        title={label}
        sandbox="allow-same-origin"
        referrerPolicy="no-referrer"
        scrolling="no"
        tabIndex={decorated && Tag === "article" ? 0 : -1}
        srcDoc={srcDoc}
        onLoad={onLoad}
      />
    </Tag>
  );
}
