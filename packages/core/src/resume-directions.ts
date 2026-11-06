import { type ResumeStyle, styleFromDesign } from "./resume-style.ts";
import { hue, type ResumeTheme } from "./resume-theme.ts";

type Skeleton = NonNullable<ResumeTheme["skeleton"]>;
type Base = Omit<ResumeTheme, "name" | "accent" | "headingColor" | "skeleton">;

export interface Palette {
  accent: string;
  heading?: string;
}

/** 一个设计方向：骨架 + 主题 + 装饰层 CSS + 配色组合，模型只挑方向、微调主色，不必从零写。 */
export interface DesignDirection {
  id: string;
  name: string;
  /** 风格词，用来和用户的说法对上。 */
  words: readonly string[];
  skeleton: Skeleton;
  /** 一句话气质，给用户看。 */
  summary: string;
  /** 设计手法：字号层级、强调色位置、装饰层、留白节奏，给模型看。 */
  craft: string;
  /** 分栏版式在部分网申系统里可能读乱。 */
  columns: boolean;
  base: Base;
  palettes: readonly Palette[];
  css: string;
}

const SANS: Base = {
  bodyFont: "sans",
  headingFont: "sans",
  header: "plain",
  headerAlign: "left",
  headingStyle: "plain",
  layout: "single",
  bullet: "dot",
  skills: "line",
  density: "auto",
};

const NAVY = { accent: "#1e3a5f" };
const FOREST = { accent: "#1f5f4a" };
const WINE = { accent: "#8c2f39" };
const TEAL = { accent: "#0f766e" };
const INDIGO = { accent: "#3730a3" };
const PLUM = { accent: "#6b2d5c" };
const GRAPHITE = { accent: "#1f2937" };
const BLUE = { accent: "#1d4ed8" };
const SAGE = { accent: "#4d7c5a" };
const TERRA = { accent: "#b4532a" };
const SLATE = { accent: "#334155" };

export const DESIGN_DIRECTIONS: readonly DesignDirection[] = [
  {
    id: "classic-broadsheet",
    name: "墨线报刊",
    words: ["正式", "传统", "稳重", "经典", "文艺", "报刊"],
    skeleton: "classic",
    summary: "宋体居中抬头，上粗下细双线，像一版老派报纸",
    craft:
      "姓名 1.25 倍加宽字距；强调色只用在求职意向和联系方式间的小菱形，其余全是墨色；分区标题居中、上下细线夹住；留白均匀",
    columns: false,
    base: { ...SANS, bodyFont: "serif", headingFont: "serif", headerAlign: "center", bullet: "dash" },
    palettes: [WINE, NAVY, GRAPHITE],
    css: `
.head { padding: 9pt 0 8pt; border-top: 3pt solid var(--ink); border-bottom: 0.5pt solid var(--ink); }
.head h1 { font-size: calc(var(--name) * 1.25); letter-spacing: 0.3em; }
.headline { letter-spacing: 0.12em; color: var(--accent); }
.contacts span + span::before { content: "◆"; font-size: 0.6em; margin: 0 0.9em; color: var(--accent); vertical-align: 0.15em; }
h2 { text-align: center; letter-spacing: 0.4em; font-size: 0.98em; padding: 2pt 0; border-top: 0.5pt solid var(--ink); border-bottom: 0.5pt solid var(--ink); margin-bottom: 5pt; }
`,
  },
  {
    id: "classic-bar-title",
    name: "色条标题",
    words: ["清爽", "现代", "利落", "简洁", "大厂"],
    skeleton: "classic",
    summary: "左对齐大姓名，分区标题前一道主色竖条，干净利落",
    craft: "姓名 1.15 倍；强调色只在标题竖条和公司名上；正文纯灰，层次靠字重；条目间距略放大",
    columns: false,
    base: { ...SANS, headingStyle: "bar", bullet: "square", header: "rule" },
    palettes: [BLUE, TEAL, INDIGO],
    css: `
.head h1 { font-size: calc(var(--name) * 1.15); letter-spacing: 0.06em; }
.headline { color: var(--accent); font-weight: 600; letter-spacing: 0.04em; }
h2 { font-size: 1.1em; letter-spacing: 0.1em; color: var(--ink); }
.item-sub { color: var(--accent-deep); font-weight: 500; }
.item + .item { margin-top: calc(var(--item-gap) * 1.25); }
`,
  },
  {
    id: "classic-corner",
    name: "角标竖线",
    words: ["设计感", "几何", "现代", "年轻", "活泼"],
    skeleton: "classic",
    summary: "抬头左侧一条主色竖线加方块角标，标题前缀小方块",
    craft: "姓名 1.2 倍；强调色在抬头竖线、角标方块和标题前缀，三处呼应；右侧大量留白，正文黑灰",
    columns: false,
    base: { ...SANS, bullet: "square" },
    palettes: [TERRA, INDIGO, TEAL],
    css: `
.head { padding: 2pt 0 8pt 14pt; border-left: 5pt solid var(--accent); border-top: 5pt solid var(--accent-deep); }
.head h1 { font-size: calc(var(--name) * 1.2); letter-spacing: 0.08em; }
.headline { color: var(--accent-deep); font-weight: 600; }
h2 { letter-spacing: 0.14em; color: var(--ink); }
h2::before { content: "■"; color: var(--accent); font-size: 0.6em; margin-right: 6pt; vertical-align: 0.15em; }
`,
  },
  {
    id: "classic-airy",
    name: "留白极简",
    words: ["极简", "高级", "留白", "克制", "简约"],
    skeleton: "classic",
    summary: "几乎没有装饰，靠字号对比和大留白撑起高级感",
    craft: "姓名 1.4 倍细字距；标题缩小到 0.9 倍、全大写感的宽字距、主色；段落间距放大到 1.5 倍；不加任何线",
    columns: false,
    base: { ...SANS, density: "roomy" },
    palettes: [GRAPHITE, SLATE, NAVY],
    css: `
.head h1 { font-size: calc(var(--name) * 1.4); letter-spacing: 0.12em; font-weight: 400; }
.headline { font-weight: 400; letter-spacing: 0.2em; color: var(--accent); }
.contacts { letter-spacing: 0.04em; }
h2 { font-size: 0.9em; letter-spacing: 0.36em; font-weight: 600; color: var(--accent); margin-bottom: 4pt; }
section { margin-top: calc(var(--sec-gap) * 1.45); }
.item-title { font-weight: 600; }
`,
  },
  {
    id: "classic-literary",
    name: "文艺花边",
    words: ["文艺", "优雅", "温柔", "文科", "女生", "古典"],
    skeleton: "classic",
    summary: "站酷小薇姓名居中，菱形花边分隔，标题两侧点线",
    craft: "姓名换站酷小薇 1.3 倍；强调色用在花边和意向；标题居中、下方点线；整体偏窄、留白左右对称",
    columns: false,
    base: { ...SANS, bodyFont: "serif", headingFont: "serif", headerAlign: "center", bullet: "dot" },
    palettes: [PLUM, WINE, FOREST],
    css: `
.head h1 { font-family: xiaowei; font-size: calc(var(--name) * 1.3); letter-spacing: 0.22em; font-weight: 400; }
.head::after { content: ""; display: block; width: 48px; height: 12px; margin: 6pt auto 0; background-color: var(--accent); mask: asset(ornament-diamond) center/contain no-repeat; }
.headline { color: var(--accent); letter-spacing: 0.1em; }
h2 { text-align: center; letter-spacing: 0.3em; color: var(--accent-deep); font-size: 1.05em; padding-bottom: 3pt; margin-bottom: 4pt; background: asset(divider-dots) bottom/auto 3pt repeat-x; }
`,
  },
  {
    id: "classic-signature",
    name: "手写签名",
    words: ["个性", "手写", "创意", "设计", "活泼", "艺术"],
    skeleton: "classic",
    summary: "龙藏体手写姓名像签名，细线收住，其余保持克制",
    craft: "姓名换龙藏体 1.6 倍，主色；其余全是黑体小字；标题下一条主色细线；个性集中在姓名一个点上",
    columns: false,
    base: { ...SANS, header: "rule", headingStyle: "underline" },
    palettes: [TERRA, PLUM, TEAL],
    css: `
.head h1 { font-family: cang; font-size: calc(var(--name) * 1.7); letter-spacing: 0.06em; font-weight: 400; color: var(--accent); line-height: 1.1; }
.headline { letter-spacing: 0.1em; color: var(--ink); font-weight: 500; }
h2 { font-size: 1em; letter-spacing: 0.18em; color: var(--ink); border-bottom-width: 1pt; }
`,
  },
  {
    id: "classic-band",
    name: "标题色块",
    words: ["醒目", "商务", "大气", "活力", "色块"],
    skeleton: "classic",
    summary: "满幅主色抬头加反白分区标题块，对比强、条理清",
    craft:
      "抬头主色满幅、姓名反白 1.15 倍；分区标题用小色块反白；强调色大面积出现但只在标题位置；正文保持黑灰",
    columns: false,
    base: { ...SANS, header: "band", headingStyle: "block", bullet: "square" },
    palettes: [NAVY, TEAL, WINE],
    css: `
.head h1 { font-size: calc(var(--name) * 1.15); }
h2 { letter-spacing: 0.12em; }
.item-sub { color: var(--accent-deep); font-weight: 500; }
`,
  },
  {
    id: "numbered-index",
    name: "数字索引",
    words: ["设计感", "杂志", "编号", "条理", "年轻", "理工"],
    skeleton: "numbered",
    summary: "01、02 大号编号领起每个分区，像杂志目录",
    craft: "编号 1.55 倍主色粗体；标题黑色宽字距、下细灰线；姓名下一块主色短横；左侧留出编号栏，节奏清晰",
    columns: false,
    base: SANS,
    palettes: [INDIGO, TERRA, TEAL],
    css: `
.head h1::after { width: 40pt; height: 4pt; }
section h2::before { top: -2pt; font-size: 1.7em; }
`,
  },
  {
    id: "numbered-serif",
    name: "衬线编号",
    words: ["文艺", "杂志", "高级", "稳重", "优雅"],
    skeleton: "numbered",
    summary: "宋体标题配浅色大编号，安静克制的出版物气质",
    craft: "标题宋体；编号 2 倍、极浅主色，当作背景纹理；姓名宋体居左；强调色只出现在编号和意向",
    columns: false,
    base: { ...SANS, bodyFont: "serif", headingFont: "serif" },
    palettes: [WINE, FOREST, NAVY],
    css: `
section h2::before { top: -4pt; font-size: 2.1em; font-weight: 400; color: color-mix(in srgb, var(--accent) 55%, #fff); }
section h2 { letter-spacing: 0.2em; border-bottom: 0.5pt solid var(--ink); }
.head h1::after { display: none; }
.head h1 { letter-spacing: 0.16em; }
.headline { letter-spacing: 0.08em; }
`,
  },
  {
    id: "timeline-dot",
    name: "圆点时间线",
    words: ["清新", "条理", "经历丰富", "成长", "时间线"],
    skeleton: "timeline",
    summary: "一条浅色脊线串起分区，圆点落在标题和每个条目上",
    craft: "脊线极浅；标题圆点主色带白环；条目空心点；强调色在点和公司名；行距均匀、轻盈",
    columns: false,
    base: SANS,
    palettes: [TEAL, BLUE, SAGE],
    css: `
.head h1 { letter-spacing: 0.1em; }
`,
  },
  {
    id: "timeline-square",
    name: "方块时间轴",
    words: ["理工", "严谨", "工程", "稳重", "技术"],
    skeleton: "timeline",
    summary: "虚线脊柱加方块节点，硬朗的工程图纸感",
    craft: "脊柱改虚线中灰；方块节点主色；标题黑色粗体；等宽字体用在技术栈；留白紧凑",
    columns: false,
    base: { ...SANS, bullet: "square", skills: "tags" },
    palettes: [SLATE, NAVY, FOREST],
    css: `
.frame::before { background: repeating-linear-gradient(to bottom, var(--faint) 0 4pt, transparent 4pt 7pt); width: 1.25pt; }
section h2::before { border-radius: 1.5pt; width: 9pt; height: 9pt; top: calc(50% - 4.5pt); left: -16.5pt; }
.item::before { border-radius: 0; width: 5pt; height: 5pt; left: -14.5pt; }
.head h1 { font-size: calc(var(--name) * 1.1); }
`,
  },
  {
    id: "cards-paper",
    name: "卡片灰底",
    words: ["现代", "清爽", "分块", "设计感", "产品", "互联网"],
    skeleton: "cards",
    summary: "浅灰衬底，每个分区一张白卡片，抬头顶部一道主色边",
    craft: "卡片圆角 5pt；标题前小色块；抬头卡顶部 3.5pt 主色边；强调色只在色块和公司名；卡片间留白统一",
    columns: false,
    base: SANS,
    palettes: [BLUE, TEAL, INDIGO],
    css: "",
  },
  {
    id: "cards-warm",
    name: "暖纸卡片",
    words: ["温暖", "柔和", "亲切", "文科", "女生", "清新"],
    skeleton: "cards",
    summary: "米色纸底、卡片左边一道主色边，暖而不艳",
    craft: "底色米白；卡片白底、左侧 3pt 主色边、小圆角；标题宋体；强调色用赤陶或鼠尾草，低饱和",
    columns: false,
    base: { ...SANS, headingFont: "serif" },
    palettes: [TERRA, SAGE, PLUM],
    css: `
.resume { background: #f7f2ea; }
.head { border-top: 0; border-left: 4pt solid var(--accent); border-radius: 3pt; }
section { border-left: 3pt solid var(--accent); border-radius: 3pt; }
section h2::before { display: none; }
section h2 { letter-spacing: 0.14em; }
.head h1 { font-family: xiaowei; letter-spacing: 0.14em; font-weight: 400; }
`,
  },
  {
    id: "cards-dark-head",
    name: "深色抬头卡",
    words: ["商务", "大气", "高级", "稳重", "硬朗"],
    skeleton: "cards",
    summary: "深色抬头卡压住页面，下方白卡片整齐排开",
    craft: "抬头卡深色底、姓名反白 1.2 倍、意向浅色；强调色用在标题小方块；卡片留白偏紧，信息密度高",
    columns: false,
    base: SANS,
    palettes: [NAVY, GRAPHITE, FOREST],
    css: `
.head { background: var(--accent-deep); border-top: 0; }
.head h1 { color: #fff; font-size: calc(var(--name) * 1.2); }
.head .headline { color: #fff; opacity: 0.9; }
.head .contacts { color: #fff; opacity: 0.85; }
.head .contacts span + span::before { color: #fff; opacity: 0.6; }
section h2::before { width: 8pt; height: 3pt; border-radius: 0; }
`,
  },
  {
    id: "side-left-navy",
    name: "深色侧栏",
    words: ["稳重", "理工", "硬朗", "商务", "高级"],
    skeleton: "side-left",
    summary: "整条深色侧栏放抬头、教育、技能，右侧只讲经历",
    craft:
      "侧栏占 1/3、深色满高；姓名反白 1.0 倍加宽；侧栏标题细白线；正文栏标题前竖条；强调色在侧栏底色与竖条",
    columns: true,
    base: SANS,
    palettes: [NAVY, FOREST, SLATE],
    css: "",
  },
  {
    id: "side-left-bright",
    name: "亮色侧栏",
    words: ["活泼", "年轻", "创意", "设计感", "活力"],
    skeleton: "side-left",
    summary: "饱和主色侧栏配黄油体姓名，年轻有活力",
    craft: "侧栏主色饱和、不压深；姓名换站酷黄油体 1.3 倍反白；侧栏标题宽字距；正文栏白底黑字，标题主色粗体",
    columns: true,
    base: SANS,
    palettes: [TERRA, TEAL, INDIGO],
    css: `
.side { background: var(--accent); }
.side h1 { font-family: huangyou; font-weight: 400; font-size: calc(var(--name) * 1.3); letter-spacing: 0.06em; }
.side h2 { letter-spacing: 0.2em; }
.main h2 { color: var(--accent-deep); }
`,
  },
  {
    id: "side-right-light",
    name: "浅色右侧栏",
    words: ["清爽", "温和", "文科", "简约", "女生"],
    skeleton: "side-right",
    summary: "主栏讲经历，右侧浅色栏放抬头教育技能，主色细边分隔",
    craft: "右栏浅主色底、左侧 2.5pt 主色边；姓名 1.0 倍宽字距；主栏标题下细主色线；强调色只在边线和标题线",
    columns: true,
    base: SANS,
    palettes: [TEAL, SAGE, BLUE],
    css: "",
  },
  {
    id: "side-right-serif",
    name: "宋体右侧栏",
    words: ["文艺", "高级", "稳重", "杂志", "优雅"],
    skeleton: "side-right",
    summary: "宋体姓名和标题，浅米右栏，像杂志侧边栏",
    craft: "全站宋体标题；右栏浅米色；姓名 1.15 倍字距 0.2em；标题下细黑线；强调色低饱和，只在意向和栏边线",
    columns: true,
    base: { ...SANS, bodyFont: "serif", headingFont: "serif" },
    palettes: [WINE, FOREST, NAVY],
    css: `
.frame .side { background: #f6f1e8; border-left: 1pt solid var(--accent); }
.side h1 { letter-spacing: 0.2em; font-size: calc(var(--name) * 1.1); }
.main h2 { border-bottom: 0.5pt solid var(--ink); letter-spacing: 0.24em; }
.side h2 { border-bottom: 0.5pt solid var(--ink); }
`,
  },
  {
    id: "band-cols-solid",
    name: "色块抬头两栏",
    words: ["商务", "大气", "醒目", "现代", "专业"],
    skeleton: "band-cols",
    summary: "通栏主色抬头，下方主栏加浅色侧栏，信息一目了然",
    craft: "抬头通栏主色、姓名反白 1.1 倍；侧栏浅主色圆角卡；主栏标题前竖条；强调色在抬头与竖条",
    columns: true,
    base: SANS,
    palettes: [NAVY, TEAL, WINE],
    css: `
.head h1 { font-size: calc(var(--name) * 1.1); }
`,
  },
  {
    id: "band-cols-cut",
    name: "斜切抬头",
    words: ["设计感", "几何", "创意", "年轻", "动感"],
    skeleton: "band-cols",
    summary: "抬头色块底边斜切，下面是左右两栏，有动势",
    craft: "抬头色块底边斜切 16pt 夹角；姓名 1.2 倍反白；侧栏白底、左侧 1pt 浅线；强调色集中在抬头与斜切角",
    columns: true,
    base: SANS,
    palettes: [INDIGO, TERRA, TEAL],
    css: `
.head { background: linear-gradient(177deg, var(--accent) 86%, transparent 86.3%); padding-bottom: 13mm; }
.head h1 { font-size: calc(var(--name) * 1.2); }
.side { background: none; border-left: 1pt solid var(--rule); border-radius: 0; padding: 0 0 0 10pt; }
`,
  },
  {
    id: "band-cols-stripe",
    name: "双色条抬头",
    words: ["清爽", "年轻", "活力", "大厂", "简洁"],
    skeleton: "band-cols",
    summary: "深色抬头下压一条亮色细条，侧栏不加底色，更轻",
    craft: "抬头深色、底部 3pt 亮色条；姓名反白；侧栏无底色，仅顶部短横；强调色出现在细条与短横，克制",
    columns: true,
    base: SANS,
    palettes: [SLATE, NAVY, FOREST],
    css: `
.head { background: var(--accent-deep); border-bottom: 3pt solid color-mix(in srgb, var(--accent) 45%, #fff); }
.side { background: none; padding: 0; }
.side h2 { border-bottom: 0.75pt solid var(--rule); color: var(--ink); }
`,
  },
  {
    id: "side-left-serif",
    name: "宋体深栏",
    words: ["文艺", "稳重", "高级", "杂志", "文科"],
    skeleton: "side-left",
    summary: "深色侧栏配宋体姓名，沉静有书卷气",
    craft:
      "侧栏深色、姓名宋体 1.15 倍字距 0.18em；侧栏标题宋体；正文栏标题宋体黑色、下细线；强调色只在侧栏底",
    columns: true,
    base: { ...SANS, headingFont: "serif" },
    palettes: [WINE, FOREST, PLUM],
    css: `
.side h1 { letter-spacing: 0.18em; font-size: calc(var(--name) * 1.1); }
.main h2::before { display: none; }
.main h2 { letter-spacing: 0.16em; }
`,
  },
  {
    id: "timeline-warm",
    name: "暖色时间线",
    words: ["温暖", "亲切", "成长", "文科", "清新"],
    skeleton: "timeline",
    summary: "赤陶或鼠尾草的细脊线，标题宋体，柔和不拘谨",
    craft: "标题宋体、主色；脊线用主色 28% 浅色；条目小点空心；姓名宋体左对齐；留白比标准略松",
    columns: false,
    base: { ...SANS, headingFont: "serif", density: "roomy" },
    palettes: [TERRA, SAGE, PLUM],
    css: `
section h2 { color: var(--accent-deep); letter-spacing: 0.16em; }
.head h1 { letter-spacing: 0.12em; }
`,
  },
  {
    id: "numbered-bold",
    name: "粗体编号",
    words: ["醒目", "活力", "设计感", "互联网", "产品"],
    skeleton: "numbered",
    summary: "黄油体大编号，主色醒目，像海报的分栏标记",
    craft:
      "编号换站酷黄油体 1.9 倍主色；标题黑色粗体；姓名左对齐粗体 1.15 倍；编号栏留 34pt，强调色集中在编号",
    columns: false,
    base: SANS,
    palettes: [TERRA, BLUE, PLUM],
    css: `
section { padding-left: 34pt; }
section h2::before { font-family: huangyou; font-weight: 400; font-size: 1.9em; top: -3pt; }
.head h1 { font-size: calc(var(--name) * 1.15); }
`,
  },
];

export interface PickOptions {
  /** 用户这轮说的话，用风格词打分。 */
  text?: string;
  /** 该用户之前见过的方向，优先排除。 */
  avoid?: readonly string[];
  count?: number;
  random?: () => number;
}

/** 本轮给模型挑的候选：风格词匹配加随机，每种骨架至少一个、避开用户见过的。 */
export function pickDirections(options: PickOptions = {}): DesignDirection[] {
  const { text = "", avoid = [], count = 10, random = Math.random } = options;
  const seen = new Set(avoid);
  const scored = DESIGN_DIRECTIONS.map((d) => ({
    d,
    score:
      Math.min(2, d.words.filter((w) => text.includes(w)).length) * 2 +
      random() * 3 -
      (seen.has(d.id) ? 100 : 0),
  })).sort((a, b) => b.score - a.score);
  const picked: DesignDirection[] = [];
  const skeletons = new Set<string>();
  for (const { d } of scored) {
    if (!skeletons.has(d.skeleton)) {
      skeletons.add(d.skeleton);
      picked.push(d);
    }
  }
  for (const { d } of scored) {
    if (picked.length >= count) break;
    if (!picked.includes(d)) picked.push(d);
  }
  // 打乱顺序：模型倾向于先挑列表靠前的
  return picked.slice(0, Math.max(count, skeletons.size)).sort(() => random() - 0.5);
}

/** 一版设计的外观特征，用来比较同一组里的几版像不像。 */
export function designFeatures(style: ResumeStyle): Record<string, string> {
  const t = style.theme;
  const decor = Math.min(3, Math.ceil(((style.css ?? "").match(/::(?:before|after)/g)?.length ?? 0) / 3));
  return {
    skeleton: t?.skeleton ?? "classic",
    bodyFont: t?.bodyFont ?? "",
    headingFont: t?.headingFont ?? "",
    header: t?.header ?? "",
    headingStyle: t?.headingStyle ?? "",
    bullet: t?.bullet ?? "",
    skills: t?.skills ?? "",
    hue: t ? String(Math.floor(hue(t.accent).h / 30)) : "",
    decor: String(decor),
  };
}

/** 两版特征里不同的比例，0–1。 */
export function featureDistance(a: Record<string, string>, b: Record<string, string>): number {
  const keys = Object.keys(a);
  return keys.filter((k) => a[k] !== b[k]).length / Math.max(1, keys.length);
}

/** 为同一组的几个方向各挑一组配色，色相尽量错开。 */
export function pickPalettes(
  directions: readonly (DesignDirection | undefined)[],
  random: () => number = Math.random,
): number[] {
  const taken = new Set<number>();
  return directions.map((d) => {
    if (!d) return 0;
    const bucket = (i: number) => Math.floor(hue(d.palettes[i]?.accent ?? "#000000").h / 30);
    const order = d.palettes.map((_, i) => i).sort(() => random() - 0.5);
    const free = order.find((i) => !taken.has(bucket(i))) ?? order[0] ?? 0;
    taken.add(bucket(free));
    return free;
  });
}

export function directionById(id: string): DesignDirection | undefined {
  return DESIGN_DIRECTIONS.find((d) => d.id === id);
}

/** 方向 + 配色（默认第一组）成为一版完整样式；主色可由用户或模型改写。 */
export function styleFromDirection(
  direction: DesignDirection,
  options: { palette?: number; accent?: string; name?: string } = {},
): { ok: true; style: ResumeStyle; notes: string[] } | { ok: false; errors: string[] } {
  const palette = direction.palettes[options.palette ?? 0] ?? direction.palettes[0];
  const accent = options.accent ?? palette?.accent ?? "#1f2937";
  const heading = options.accent ? undefined : palette?.heading;
  const theme = {
    ...direction.base,
    name: options.name ?? direction.name,
    accent,
    skeleton: direction.skeleton,
    ...(heading && { headingColor: heading }),
  };
  return styleFromDesign(theme, direction.css);
}
