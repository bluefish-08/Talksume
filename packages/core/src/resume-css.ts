import * as csstree from "css-tree";
import {
  assetDataUri,
  isAssetName,
  isFontName,
  RESUME_ASSET_NAMES,
  RESUME_ASSETS,
  RESUME_FONT_NAMES,
  RESUME_FONTS,
} from "./resume-assets.ts";

// 模型写的 CSS 只能作用于我们固定的简历 DOM。解析器说了算，不做字符串匹配；
// 凡是白名单之外的 token（包括被转义拆开的 url、@import、attr()）一律拒绝，整份样式作废。

export const CSS_LIMITS = { maxChars: 12_000, maxRules: 120, maxDeclarations: 700, maxSelectorDepth: 5 };

export const CSS_CLASSES = [
  "resume",
  "head",
  "head-main",
  "headline",
  "contacts",
  "summary",
  "photo",
  "cols",
  "side",
  "main",
  "sec-body",
  "item",
  "item-head",
  "item-main",
  "item-title",
  "item-sub",
  "item-aside",
  "item-period",
  "item-meta",
  "item-stack",
  "label",
  "stack",
  "lead",
  "num",
  "lines",
  "skill-line",
  "lvl",
  "tags",
  "tag",
] as const;
const CLASS_SET = new Set<string>(CSS_CLASSES);
const TYPE_SET = new Set(["h1", "h2", "header", "section", "aside", "div", "p", "span", "ul", "li", "b"]);
export const CSS_SECTION_KINDS = [
  "education",
  "experiences",
  "projects",
  "campus",
  "skills",
  "awards",
  "custom",
];
export const CSS_CONTACT_KINDS = ["phone", "email", "link", "text"];
const ATTRS: Record<string, readonly string[]> = {
  "data-kind": CSS_SECTION_KINDS,
  "data-k": CSS_CONTACT_KINDS,
};
const PSEUDO_CLASS_SET = new Set([
  "first-child",
  "last-child",
  "only-child",
  "first-of-type",
  "last-of-type",
  "nth-child",
  "nth-of-type",
]);
const NTH = /^(?:odd|even|[+-]?\d*n(?:\s*[+-]\s*\d+)?|[+-]?\d+)$/i;

const VARS = new Set([
  "--accent",
  "--accent-soft",
  "--accent-deep",
  "--heading",
  "--ink",
  "--body",
  "--label",
  "--muted",
  "--faint",
  "--rule",
]);

const COLOR_NAMES = new Set(
  "black white gray grey silver red maroon orange gold yellow olive lime green teal aqua cyan blue navy purple fuchsia pink brown beige ivory tan salmon coral crimson indigo violet khaki lavender linen snow whitesmoke gainsboro lightgray lightgrey darkgray darkgrey slategray dimgray darkgreen darkblue darkred seagreen steelblue royalblue skyblue".split(
    " ",
  ),
);
const COLOR_FUNCS = new Set(["rgb", "rgba", "hsl", "hsla", "color-mix"]);
const MATH_FUNCS = new Set(["calc", "min", "max", "clamp"]);
const GRADIENT_FUNCS = new Set(["linear-gradient", "repeating-linear-gradient", "radial-gradient"]);
const LEN_UNITS = new Set(["px", "pt", "mm", "cm", "em", "rem", "ch"]);
const ANGLE_UNITS = new Set(["deg"]);
const GRADIENT_WORDS = new Set([
  "to",
  "top",
  "bottom",
  "left",
  "right",
  "center",
  "circle",
  "ellipse",
  "closest-side",
  "farthest-side",
  "closest-corner",
  "farthest-corner",
  "at",
]);
const COLOR_MIX_WORDS = new Set(["in", "srgb", "oklab", "hsl"]);

interface PropSpec {
  kw?: readonly string[];
  len?: boolean;
  /** 允许无单位数字及其范围。 */
  num?: [number, number];
  color?: boolean;
  image?: boolean;
  font?: boolean;
  /** 允许逗号分隔的多个值（背景层、阴影）。 */
  list?: boolean;
  /** 一个值最多几个 token。 */
  max?: number;
  /** 只允许这些字面串。 */
  content?: boolean;
  /** 正的长度，不允许负值。 */
  positive?: boolean;
}

const BORDER_STYLES = ["none", "solid", "dashed", "dotted", "double"];
const BOX = { len: true, max: 4 } satisfies PropSpec;
const POS_BOX = { len: true, max: 4, positive: true } satisfies PropSpec;
const SIDE_BORDER = { len: true, color: true, kw: BORDER_STYLES, max: 4, positive: true } satisfies PropSpec;
const BG_KW = [
  "none",
  "no-repeat",
  "repeat",
  "repeat-x",
  "repeat-y",
  "space",
  "round",
  "center",
  "top",
  "bottom",
  "left",
  "right",
  "cover",
  "contain",
  "auto",
  "border-box",
  "padding-box",
  "content-box",
];
const ALIGN = ["flex-start", "flex-end", "center", "stretch", "baseline", "start", "end", "normal"];
const JUSTIFY = [
  ...ALIGN.filter((k) => k !== "stretch" && k !== "baseline"),
  "space-between",
  "space-around",
  "space-evenly",
];

const PROPS: Record<string, PropSpec> = {
  color: { color: true },
  "background-color": { color: true },
  background: { color: true, image: true, len: true, kw: BG_KW, list: true, max: 24 },
  "background-image": { image: true, kw: ["none"], list: true },
  "background-size": { len: true, kw: ["cover", "contain", "auto"], list: true, max: 8 },
  "background-position": { len: true, kw: ["center", "top", "bottom", "left", "right"], list: true, max: 8 },
  "background-repeat": {
    kw: ["no-repeat", "repeat", "repeat-x", "repeat-y", "space", "round"],
    list: true,
    max: 8,
  },
  "background-clip": { kw: ["border-box", "padding-box", "content-box"] },
  mask: { image: true, len: true, kw: BG_KW, list: true, max: 24 },
  "mask-image": { image: true, kw: ["none"], list: true },
  "mask-size": { len: true, kw: ["cover", "contain", "auto"], list: true, max: 8 },
  "mask-position": { len: true, kw: ["center", "top", "bottom", "left", "right"], list: true, max: 8 },
  "mask-repeat": {
    kw: ["no-repeat", "repeat", "repeat-x", "repeat-y", "space", "round"],
    list: true,
    max: 8,
  },
  border: SIDE_BORDER,
  "border-top": SIDE_BORDER,
  "border-right": SIDE_BORDER,
  "border-bottom": SIDE_BORDER,
  "border-left": SIDE_BORDER,
  "border-width": POS_BOX,
  "border-style": { kw: BORDER_STYLES, max: 4 },
  "border-color": { color: true, max: 4 },
  "border-top-color": { color: true },
  "border-right-color": { color: true },
  "border-bottom-color": { color: true },
  "border-left-color": { color: true },
  "border-top-width": POS_BOX,
  "border-right-width": POS_BOX,
  "border-bottom-width": POS_BOX,
  "border-left-width": POS_BOX,
  "border-top-style": { kw: BORDER_STYLES },
  "border-right-style": { kw: BORDER_STYLES },
  "border-bottom-style": { kw: BORDER_STYLES },
  "border-left-style": { kw: BORDER_STYLES },
  "border-radius": { len: true, max: 8, positive: true },
  "border-top-left-radius": { len: true, max: 2, positive: true },
  "border-top-right-radius": { len: true, max: 2, positive: true },
  "border-bottom-left-radius": { len: true, max: 2, positive: true },
  "border-bottom-right-radius": { len: true, max: 2, positive: true },
  "box-shadow": { len: true, color: true, kw: ["none"], list: true, max: 20 },
  margin: { ...BOX, kw: ["auto"] },
  "margin-top": { len: true, kw: ["auto"] },
  "margin-right": { len: true, kw: ["auto"] },
  "margin-bottom": { len: true, kw: ["auto"] },
  "margin-left": { len: true, kw: ["auto"] },
  padding: POS_BOX,
  "padding-top": { len: true, positive: true },
  "padding-right": { len: true, positive: true },
  "padding-bottom": { len: true, positive: true },
  "padding-left": { len: true, positive: true },
  width: { len: true, kw: ["auto", "fit-content"], positive: true },
  height: { len: true, kw: ["auto", "fit-content"], positive: true },
  "min-width": { len: true, kw: ["auto"], positive: true },
  "min-height": { len: true, kw: ["auto"], positive: true },
  "max-width": { len: true, kw: ["none"], positive: true },
  "max-height": { len: true, kw: ["none"], positive: true },
  "box-sizing": { kw: ["border-box", "content-box"] },
  display: { kw: ["block", "inline", "inline-block", "flex", "inline-flex", "grid", "none"] },
  position: { kw: ["static", "relative", "absolute"] },
  top: { len: true, kw: ["auto"] },
  right: { len: true, kw: ["auto"] },
  bottom: { len: true, kw: ["auto"] },
  left: { len: true, kw: ["auto"] },
  "z-index": { num: [-5, 5] },
  "flex-direction": { kw: ["row", "column", "row-reverse", "column-reverse"] },
  "flex-wrap": { kw: ["wrap", "nowrap"] },
  "flex-flow": { kw: ["row", "column", "wrap", "nowrap"], max: 2 },
  flex: { len: true, num: [0, 20], kw: ["auto", "none", "initial"], max: 3 },
  "flex-grow": { num: [0, 20] },
  "flex-shrink": { num: [0, 20] },
  "flex-basis": { len: true, kw: ["auto"], positive: true },
  "justify-content": { kw: JUSTIFY },
  "justify-items": { kw: JUSTIFY },
  "align-items": { kw: ALIGN },
  "align-self": { kw: [...ALIGN, "auto"] },
  "align-content": { kw: JUSTIFY },
  gap: { len: true, max: 2, positive: true },
  "row-gap": { len: true, positive: true },
  "column-gap": { len: true, positive: true },
  "grid-template-columns": {
    len: true,
    kw: ["auto", "none", "min-content", "max-content", "repeat"],
    max: 12,
    positive: true,
  },
  "grid-template-rows": {
    len: true,
    kw: ["auto", "none", "min-content", "max-content"],
    max: 12,
    positive: true,
  },
  "grid-column": { num: [1, 12], kw: ["span", "auto"], max: 3 },
  "grid-row": { num: [1, 12], kw: ["span", "auto"], max: 3 },
  "font-family": { font: true, list: true, kw: ["serif", "sans-serif"] },
  "font-size": { len: true, positive: true, max: 1 },
  "font-weight": { num: [100, 900], kw: ["normal", "bold", "lighter", "bolder"] },
  "font-style": { kw: ["normal", "italic"] },
  "letter-spacing": { len: true, kw: ["normal"] },
  "word-spacing": { len: true, kw: ["normal"] },
  "line-height": { len: true, num: [0.8, 4], kw: ["normal"], positive: true },
  "text-align": { kw: ["left", "right", "center", "justify", "start", "end"] },
  "text-transform": { kw: ["none", "uppercase", "lowercase", "capitalize"] },
  "text-decoration": {
    kw: ["none", "underline", "line-through", "solid", "dotted", "dashed", "wavy"],
    color: true,
    len: true,
    max: 4,
  },
  "text-decoration-color": { color: true },
  "text-underline-offset": { len: true },
  "white-space": { kw: ["normal", "nowrap"] },
  "vertical-align": { kw: ["baseline", "middle", "top", "bottom", "text-top", "text-bottom"], len: true },
  opacity: { num: [0.4, 1] },
  "list-style": { kw: ["none"] },
  "list-style-type": { kw: ["none"] },
  content: { content: true },
  "break-inside": { kw: ["auto", "avoid"] },
  "break-after": { kw: ["auto", "avoid"] },
  "break-before": { kw: ["auto", "avoid"] },
};

export const CSS_PROPERTY_NAMES = Object.keys(PROPS);

const MIN_FONT_PT = 7;
const MAX_ABS = 1000;

type Issues = string[];

function hexOk(value: string): boolean {
  return /^(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value);
}

function checkNumber(raw: string, issues: Issues, where: string): number | undefined {
  const n = Number(raw);
  if (!Number.isFinite(n) || Math.abs(n) > MAX_ABS) {
    issues.push(`${where}：数值 ${raw} 超出范围`);
    return undefined;
  }
  return n;
}

function walkValue(
  nodes: csstree.CssNode[],
  spec: PropSpec,
  prop: string,
  issues: Issues,
  ctx: { subject: Subject; inMath: boolean; inGradient: boolean },
): void {
  for (const node of nodes) {
    switch (node.type) {
      case "Identifier": {
        const name = node.name.toLowerCase();
        if (spec.font) {
          if (isFontName(name) || spec.kw?.includes(name)) break;
          issues.push(`${prop}：字体「${node.name}」不在内置字体里，可用：${RESUME_FONT_NAMES.join("、")}`);
          break;
        }
        if (spec.kw?.includes(name)) {
          if (prop === "display" && name === "none" && !ctx.subject.mayHide) {
            issues.push("display: none 只能用在 .photo 或 ::before/::after 上，不能隐藏简历内容");
          }
          if (prop === "position" && name === "absolute" && !ctx.subject.mayFloat) {
            issues.push(
              "position: absolute 只能用在 .photo 或 ::before/::after 上；内容元素请用 relative 或 flex/grid 排版",
            );
          }
          break;
        }
        if (
          spec.color &&
          (COLOR_NAMES.has(name) || name === "currentcolor" || (name === "transparent" && prop !== "color"))
        )
          break;
        if (ctx.inGradient && GRADIENT_WORDS.has(name)) break;
        issues.push(`${prop}：不支持的值「${node.name}」`);
        break;
      }
      case "Number": {
        const n = checkNumber(node.value, issues, prop);
        if (n === undefined) break;
        if (n === 0 && spec.len) break;
        if (ctx.inMath || spec.num) {
          const range = spec.num;
          if (range && (n < range[0] || n > range[1]) && !ctx.inMath) {
            issues.push(`${prop}：数值 ${node.value} 应在 ${range[0]}–${range[1]} 之间`);
          }
          break;
        }
        issues.push(`${prop}：长度要带单位（如 4pt、2mm），不支持无单位数字 ${node.value}`);
        break;
      }
      case "Dimension": {
        const unit = node.unit.toLowerCase();
        const n = checkNumber(node.value, issues, prop);
        if (n === undefined) break;
        if (ANGLE_UNITS.has(unit) && ctx.inGradient) break;
        if (unit === "fr" && prop.startsWith("grid-template")) break;
        if (!spec.len || !LEN_UNITS.has(unit)) {
          issues.push(`${prop}：不支持的单位 ${node.value}${node.unit}（可用 pt、mm、px、em、%）`);
          break;
        }
        if (spec.positive && n < 0 && !ctx.inMath) issues.push(`${prop}：不能为负值`);
        if (prop === "font-size") {
          const pt =
            unit === "pt"
              ? n
              : unit === "px"
                ? n * 0.75
                : unit === "mm"
                  ? n * 2.835
                  : unit === "cm"
                    ? n * 28.35
                    : undefined;
          const em = unit === "em" || unit === "rem" ? n : undefined;
          if ((pt !== undefined && pt < MIN_FONT_PT) || (em !== undefined && em < 0.6)) {
            issues.push(`font-size 不能小于 ${MIN_FONT_PT}pt（打印看不清）`);
          }
        }
        break;
      }
      case "Percentage": {
        const n = checkNumber(node.value, issues, prop);
        if (n === undefined) break;
        if (!spec.len && !ctx.inGradient && !ctx.inMath) issues.push(`${prop}：不支持百分比`);
        else if (prop === "font-size" && n < 60) issues.push("font-size 不能小于 60%");
        break;
      }
      case "Hash":
        if (!spec.color && !ctx.inGradient) issues.push(`${prop}：这里不能放颜色`);
        else if (!hexOk(node.value)) issues.push(`${prop}：颜色 #${node.value} 写法不对`);
        break;
      case "Operator":
        if (!["/", ",", "+", "-", "*"].includes(node.value))
          issues.push(`${prop}：不支持的运算符 ${node.value}`);
        else if (node.value === "," && !spec.list && !ctx.inGradient && !ctx.inMath) {
          issues.push(`${prop}：不接受逗号分隔的多个值`);
        }
        break;
      case "String":
        if (spec.content && node.value === "") break;
        if (spec.font) {
          if (isFontName(node.value)) break;
          issues.push(`${prop}：字体「${node.value}」不在内置字体里，可用：${RESUME_FONT_NAMES.join("、")}`);
          break;
        }
        issues.push(
          spec.content
            ? 'content 只能是 ""、none 或 normal：简历文字由我们的数据渲染，不能用 CSS 插入文字'
            : `${prop}：不支持字符串`,
        );
        break;
      case "Function":
        walkFunction(node, spec, prop, issues, ctx);
        break;
      case "Url":
        issues.push(`${prop}：禁止 url()，图标、分隔线请用 asset(名字)`);
        break;
      default:
        issues.push(`${prop}：不支持的值 ${csstree.generate(node)}`);
    }
  }
}

function walkFunction(
  node: csstree.FunctionNode,
  spec: PropSpec,
  prop: string,
  issues: Issues,
  ctx: { subject: Subject; inMath: boolean; inGradient: boolean },
): void {
  const name = node.name.toLowerCase();
  const args = node.children.toArray();
  if (name === "asset") {
    const [arg] = args;
    if (!spec.image)
      issues.push(`${prop}：asset() 只能用在 background、background-image、mask、mask-image 里`);
    else if (args.length !== 1 || arg?.type !== "Identifier" || !isAssetName(arg.name)) {
      issues.push(`asset() 的名字不对，可用：${RESUME_ASSET_NAMES.join("、")}`);
    }
    return;
  }
  if (name === "var") {
    const [arg] = args;
    if (args.length !== 1 || arg?.type !== "Identifier" || !VARS.has(arg.name)) {
      issues.push(`var() 只能引用 ${[...VARS].join("、")}`);
    }
    return;
  }
  const isColor = COLOR_FUNCS.has(name);
  const isMath = MATH_FUNCS.has(name);
  const isGradient = GRADIENT_FUNCS.has(name);
  if (!isColor && !isMath && !isGradient) {
    issues.push(`${prop}：不支持函数 ${node.name}()`);
    return;
  }
  if (isColor && !spec.color && !ctx.inGradient) issues.push(`${prop}：这里不能放颜色`);
  if (isMath && !spec.len && !spec.num) issues.push(`${prop}：不能用 ${name}()`);
  if (isGradient && !spec.image) issues.push(`${prop}：渐变只能用在 background、background-image、mask 里`);
  const inner = { ...ctx, inMath: ctx.inMath || isMath, inGradient: ctx.inGradient || isGradient || isColor };
  const innerSpec: PropSpec = isColor
    ? { color: true, num: [0, 1000], len: true, list: true, kw: [...COLOR_MIX_WORDS] }
    : isGradient
      ? { color: true, len: true, image: false, list: true }
      : { ...spec, list: false };
  walkValue(args, innerSpec, prop, issues, inner);
}

interface Subject {
  mayHide: boolean;
  mayFloat: boolean;
}

function checkSelector(
  selector: csstree.Selector,
  issues: Issues,
): { text: string; subject: Subject } | null {
  const before = issues.length;
  const parts: string[] = [];
  let compounds = 1;
  let current: csstree.CssNode[] = [];
  const compoundsList: csstree.CssNode[][] = [];
  let hasPseudoElement = false;
  let pseudoElementSeen = false;

  for (const node of selector.children.toArray()) {
    if (pseudoElementSeen) {
      issues.push("伪元素 ::before / ::after 只能放在选择器末尾");
      break;
    }
    switch (node.type) {
      case "ClassSelector":
        if (!CLASS_SET.has(node.name)) issues.push(`选择器里没有这个类：.${node.name}`);
        else parts.push(`.${node.name}`);
        current.push(node);
        break;
      case "TypeSelector": {
        const t = node.name.toLowerCase();
        if (!TYPE_SET.has(t)) issues.push(`选择器里不支持标签 ${node.name}`);
        else parts.push(t);
        current.push(node);
        break;
      }
      case "AttributeSelector": {
        const attr = node.name.name;
        const allowed = ATTRS[attr];
        const value =
          node.value?.type === "String"
            ? node.value.value
            : node.value?.type === "Identifier"
              ? node.value.name
              : "";
        if (!allowed || node.matcher !== "=" || !allowed.includes(value) || node.flags) {
          issues.push(
            `属性选择器只支持 [data-kind="${CSS_SECTION_KINDS.join("|")}"] 和 [data-k="${CSS_CONTACT_KINDS.join("|")}"]`,
          );
        } else parts.push(`[${attr}="${value}"]`);
        current.push(node);
        break;
      }
      case "PseudoClassSelector": {
        const name = node.name.toLowerCase();
        if ((name === "before" || name === "after") && node.children === null) {
          parts.push(`::${name}`);
          hasPseudoElement = true;
          pseudoElementSeen = true;
          break;
        }
        if (!PSEUDO_CLASS_SET.has(name)) {
          issues.push(`不支持伪类 :${node.name}`);
          break;
        }
        if (name.startsWith("nth-")) {
          const arg = node.children ? csstree.generate(node.children.first as csstree.CssNode).trim() : "";
          const text = arg.replace(/^["']|["']$/g, "");
          if (!NTH.test(text) && !/^[+-]?\d*n\s*[+-]\s*\d+$/i.test(text)) {
            issues.push(`:${name}() 的参数不合法`);
            break;
          }
          parts.push(`:${name}(${text.replace(/\s+/g, "")})`);
        } else parts.push(`:${name}`);
        break;
      }
      case "PseudoElementSelector": {
        const name = node.name.toLowerCase();
        if (name !== "before" && name !== "after") issues.push(`不支持伪元素 ::${node.name}`);
        else {
          parts.push(`::${name}`);
          hasPseudoElement = true;
          pseudoElementSeen = true;
        }
        break;
      }
      case "Combinator": {
        const c = node.name.trim();
        if (![">", "+", "~", ""].includes(c)) issues.push(`不支持组合符 ${node.name}`);
        else parts.push(c === "" ? " " : ` ${c} `);
        compounds++;
        compoundsList.push(current);
        current = [];
        break;
      }
      default:
        issues.push(`选择器里不支持 ${csstree.generate(node)}`);
    }
  }
  compoundsList.push(current);
  if (compounds > CSS_LIMITS.maxSelectorDepth)
    issues.push(`选择器层级最多 ${CSS_LIMITS.maxSelectorDepth} 层`);
  if (issues.length > before) return null;

  const text = parts.join("");
  const last = compoundsList.at(-1) ?? [];
  const onlyPhoto =
    last.some((n) => n.type === "ClassSelector" && n.name === "photo") &&
    !last.some((n) => n.type === "ClassSelector" && n.name !== "photo");
  const scoped = text.startsWith(".resume") ? `.resume${text}` : `.resume.resume ${text}`;
  return {
    text: scoped,
    subject: { mayHide: hasPseudoElement || onlyPhoto, mayFloat: hasPseudoElement || onlyPhoto },
  };
}

export type CssResult =
  | { ok: true; css: string; rules: number; dropped: string[] }
  | { ok: false; errors: string[] };

const MAX_ERRORS = 8;
/** 这些是在试探边界：出现一次，整份样式作废，不留任何一部分。 */
const HOSTILE = /url\s*\(|image-set|cross-fade|expression\s*\(|attr\s*\(|-moz-binding|behavior/i;

/**
 * 校验并归一化，输出只含通过白名单的规则（选择器加了 .resume 前缀，asset(名字) 和内置字体名原样保留）。
 * 粗心写错的规则（没有的类、不支持的属性或值）整条丢弃，其余照常保留，丢弃原因在 dropped 里；
 * 语法错误、@规则、url() 之类试探边界的写法，整份作废，不保存任何一部分。
 */
export function sanitizeResumeCss(input: string): CssResult {
  const text = input.trim();
  if (!text) return { ok: false, errors: ["CSS 是空的"] };
  if (input.length > CSS_LIMITS.maxChars) {
    return { ok: false, errors: [`CSS 超过 ${CSS_LIMITS.maxChars} 字，请精简`] };
  }
  if (/[\\<]/.test(text)) {
    return { ok: false, errors: ["CSS 里不能出现反斜杠转义或 < 符号"] };
  }
  if (text.split("{").length !== text.split("}").length) {
    return { ok: false, errors: ["CSS 语法有误：花括号没有配对"] };
  }
  const fatal: Issues = [];
  const dropped: string[] = [];
  const parseErrors: string[] = [];
  let ast: csstree.CssNode;
  try {
    ast = csstree.parse(text, {
      positions: false,
      parseValue: true,
      parseRulePrelude: true,
      parseAtrulePrelude: false,
      onParseError: (error) => parseErrors.push(error.message),
    });
  } catch {
    return { ok: false, errors: ["CSS 解析失败"] };
  }
  if (parseErrors.length > 0) {
    return { ok: false, errors: [`CSS 语法有误：${parseErrors[0]}（检查分号、花括号和冒号）`] };
  }
  if (ast.type !== "StyleSheet") return { ok: false, errors: ["CSS 解析失败"] };

  const out: string[] = [];
  let rules = 0;
  let declarations = 0;
  for (const rule of ast.children.toArray()) {
    if (rule.type === "Atrule") {
      fatal.push(`不支持 @${rule.name}（@import、@font-face、@media 等一律不让用；字体请直接用内置名字）`);
      continue;
    }
    if (rule.type !== "Rule" || rule.prelude.type !== "SelectorList") {
      fatal.push("只支持普通的「选择器 { 属性: 值 }」规则");
      continue;
    }
    rules++;
    const issues: Issues = [];
    const selectors: string[] = [];
    let subject: Subject = { mayHide: true, mayFloat: true };
    for (const sel of rule.prelude.children.toArray()) {
      if (sel.type !== "Selector") continue;
      const checked = checkSelector(sel, issues);
      if (!checked) continue;
      selectors.push(checked.text);
      subject = {
        mayHide: subject.mayHide && checked.subject.mayHide,
        mayFloat: subject.mayFloat && checked.subject.mayFloat,
      };
    }
    const decls: string[] = [];
    for (const decl of rule.block.children.toArray()) {
      if (decl.type !== "Declaration") {
        issues.push("规则里只能有「属性: 值;」");
        continue;
      }
      declarations++;
      const prop = decl.property.toLowerCase().replace(/^-webkit-(mask(?:-[a-z]+)?)$/, "$1");
      if (HOSTILE.test(prop) || HOSTILE.test(csstree.generate(decl.value))) {
        fatal.push(`${prop}：禁止 url()、image-set()、attr() 等写法，图标、分隔线请用 asset(名字)`);
        continue;
      }
      const spec = PROPS[prop];
      if (!spec) {
        issues.push(`不支持属性 ${decl.property}`);
        continue;
      }
      if (decl.important) {
        issues.push(`${prop}：不要用 !important`);
        continue;
      }
      if (decl.value.type !== "Value") {
        issues.push(`${prop}：值不合法`);
        continue;
      }
      const nodes = decl.value.children.toArray();
      if (nodes.length === 0) {
        issues.push(`${prop}：缺少值`);
        continue;
      }
      if (
        spec.max !== undefined &&
        nodes.filter((n) => n.type !== "Operator").length > spec.max &&
        !spec.list
      ) {
        issues.push(`${prop}：值太多`);
        continue;
      }
      if (prop === "content") {
        const [only] = nodes;
        const ok =
          nodes.length === 1 &&
          ((only?.type === "String" && only.value === "") ||
            (only?.type === "Identifier" && ["none", "normal"].includes(only.name.toLowerCase())));
        if (!ok) {
          issues.push('content 只能是 ""、none 或 normal：简历文字由我们的数据渲染，不能用 CSS 插入文字');
          continue;
        }
      } else {
        const countBefore = issues.length;
        walkValue(nodes, spec, prop, issues, { subject, inMath: false, inGradient: false });
        if (issues.length > countBefore) continue;
      }
      decls.push(`${prop}:${csstree.generate(decl.value)}`);
    }
    if (issues.length > 0) {
      dropped.push(`规则「${csstree.generate(rule.prelude)}」已丢弃：${[...new Set(issues)].join("；")}`);
    } else if (selectors.length > 0 && decls.length > 0)
      out.push(`${selectors.join(",")}{${decls.join(";")}}`);
  }
  if (rules > CSS_LIMITS.maxRules) fatal.push(`规则超过 ${CSS_LIMITS.maxRules} 条，请合并`);
  if (declarations > CSS_LIMITS.maxDeclarations)
    fatal.push(`声明超过 ${CSS_LIMITS.maxDeclarations} 条，请精简`);
  const css = out.join("\n");
  if (fatal.length === 0 && (css.includes("<") || /url\s*\(|@/i.test(css)))
    fatal.push("CSS 含有不允许的内容");
  const failures = [...new Set([...fatal, ...(fatal.length > 0 || out.length === 0 ? dropped : [])])];
  if (fatal.length > 0 || out.length === 0) {
    const reasons = failures.length > 0 ? failures : ["没有任何规则"];
    const more = reasons.length - MAX_ERRORS;
    return {
      ok: false,
      errors: more > 0 ? [...reasons.slice(0, MAX_ERRORS), `……还有 ${more} 处问题`] : reasons,
    };
  }
  return { ok: true, css, rules: out.length, dropped: dropped.slice(0, MAX_ERRORS) };
}

/** 把规范化 CSS 里的 asset() 换成内置 SVG 的 data URI，字体名换成字体栈；输入必须是 sanitizeResumeCss 的输出。 */
export function expandResumeCss(canonical: string): string {
  const ast = csstree.parse(canonical, { positions: false, parseValue: true, parseRulePrelude: false });
  csstree.walk(ast, {
    visit: "Declaration",
    enter(decl) {
      if (decl.property === "font-family" && decl.value.type === "Value") {
        const stacks = decl.value.children
          .toArray()
          .flatMap((n) => {
            const name = n.type === "Identifier" ? n.name : n.type === "String" ? n.value : "";
            if (isFontName(name)) return [RESUME_FONTS[name].stack];
            if (name === "serif" || name === "sans-serif") return [name];
            return [];
          })
          .join(", ");
        decl.value = {
          type: "Value",
          children: new csstree.List<csstree.CssNode>().appendData({ type: "Raw", value: stacks }),
        };
      }
    },
  });
  csstree.walk(ast, {
    visit: "Function",
    enter(node, item, list) {
      if (node.name !== "asset" || !list || !item) return;
      const arg = node.children.first;
      if (arg?.type !== "Identifier" || !isAssetName(arg.name)) return;
      item.data = { type: "Url", value: assetDataUri(arg.name) };
    },
  });
  return csstree.generate(ast);
}

/** 用到了哪些内置字体，渲染端据此决定要带哪些 @font-face。 */
export function fontsUsedBy(canonical: string): string[] {
  const used = new Set<string>();
  for (const name of RESUME_FONT_NAMES) {
    if (new RegExp(`font-family:[^;}]*\\b${name}\\b`).test(canonical)) used.add(name);
  }
  return [...used];
}

/** 给模型看的词汇表。 */
export function describeCssVocabulary(): string {
  return [
    `可用的类：${CSS_CLASSES.map((c) => `.${c}`).join(" ")}；标签：${[...TYPE_SET].join(" ")}`,
    `属性选择器：section[data-kind="${CSS_SECTION_KINDS.join("|")}"]、.contacts span[data-k="${CSS_CONTACT_KINDS.join("|")}"]；伪类：${[...PSEUDO_CLASS_SET].join(" ")}；伪元素：::before ::after（content 只能是 ""）`,
    `可用属性：${CSS_PROPERTY_NAMES.join(" ")}`,
    `字体名（font-family）：${RESUME_FONT_NAMES.map((n) => `${n}=${RESUME_FONTS[n].label}`).join("；")}`,
    `素材（写进 background / background-image / mask / mask-image，如 mask: asset(icon-phone) center/contain no-repeat）：${RESUME_ASSET_NAMES.map((n) => `${n}（${RESUME_ASSETS[n].label}）`).join("、")}`,
    `颜色变量：${[...VARS].map((v) => `var(${v})`).join(" ")}`,
  ].join("\n");
}
