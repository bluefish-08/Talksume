import {
  ACCENT_INFO,
  fallbackPreset,
  type ResumeBullet,
  type ResumeContent,
  type ResumeItem,
  type ResumeSection,
  type ResumeTemplate,
  sanitizeTheme,
  templateUsesAccent,
} from "@talksume/core";
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  type IBorderOptions,
  type IRunOptions,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  TabStopType,
  TextRun,
} from "docx";
import { linkText, resolveRenderStyle } from "./html.ts";
import { layoutFor } from "./layout.ts";
import { richSpans, typeset } from "./text.ts";
import type { RenderOptions } from "./types.ts";

const FONT = "Source Han Sans SC";
const SERIF = "Source Han Serif SC";
const PAGE_WIDTH = 11906;
const PAGE_HEIGHT = 16838;
const BULLET_REF = "resume-bullets";
const MM = 56.7;

/** Word 只对齐各模板的主要风格：强调色、标题样式、加粗要点、技术栈行与分组技能；字号、行距和页边距跟网页同一档位。 */
interface DocxTheme {
  nameFont: string;
  center: boolean;
  /** 抬头整块用强调色底、白字。 */
  banner: boolean;
  headRule?: { size: number; accent: boolean };
  headingAccent: boolean;
  headingBorder: "bottom" | "left" | "none";
  headlineAccent: boolean;
  subAccent: boolean;
  leadAccent: boolean;
  skillAccent: boolean;
  bulletAccent: boolean;
  bullet: string;
}

const THEMES: Record<ResumeTemplate, DocxTheme> = {
  campus: {
    nameFont: FONT,
    center: true,
    banner: false,
    headingAccent: true,
    headingBorder: "bottom",
    headlineAccent: true,
    subAccent: false,
    leadAccent: false,
    skillAccent: false,
    bulletAccent: false,
    bullet: "•",
  },
  modern: {
    nameFont: FONT,
    center: false,
    banner: true,
    headingAccent: false,
    headingBorder: "left",
    headlineAccent: false,
    subAccent: true,
    leadAccent: true,
    skillAccent: true,
    bulletAccent: true,
    bullet: "▪",
  },
  minimal: {
    nameFont: SERIF,
    center: false,
    banner: false,
    headRule: { size: 6, accent: false },
    headingAccent: false,
    headingBorder: "bottom",
    headlineAccent: false,
    subAccent: false,
    leadAccent: false,
    skillAccent: false,
    bulletAccent: false,
    bullet: "–",
  },
  tech: {
    nameFont: FONT,
    center: false,
    banner: false,
    headRule: { size: 12, accent: true },
    headingAccent: true,
    headingBorder: "none",
    headlineAccent: true,
    subAccent: false,
    leadAccent: false,
    skillAccent: true,
    bulletAccent: true,
    bullet: "•",
  },
};

const fontOf = (name: string) => ({ ascii: name, hAnsi: name, eastAsia: name, cs: name });
const halfPoints = (pt: number) => Math.round(pt * 2);
const twips = (mm: number) => Math.round(mm * MM);

export async function renderDocx(content: ResumeContent, options: RenderOptions = {}): Promise<Uint8Array> {
  const custom = options.theme ? sanitizeTheme(options.theme)?.theme : undefined;
  const style = custom && !options.template ? fallbackPreset(custom) : resolveRenderStyle(options);
  const theme = THEMES[style.template];
  const layout = layoutFor(content, style.template, options.density);
  // DOCX 只用主题的颜色，版式回落到最接近的预设
  const mono = !custom && !templateUsesAccent(style.template);
  const accent = custom
    ? custom.accent.slice(1).toUpperCase()
    : mono
      ? "111111"
      : ACCENT_INFO[style.accent].hex.slice(1).toUpperCase();
  const ink = mono ? "111111" : "111827";
  const body = mono ? "333333" : "374151";
  const muted = mono ? "666666" : "6B7280";
  const size = halfPoints(layout.fs);
  const small = halfPoints(layout.fs * 0.9);
  const margin = { x: twips(layout.margin.x), y: twips(layout.margin.y) };
  const contentWidth = PAGE_WIDTH - margin.x * 2;
  const font = fontOf(FONT);
  const { name, headline, contacts, links = [], summary } = content.basics;
  const gap = (pt: number) => Math.round(pt * 20);
  // 显式写字号：Pages、Quick Look 等不完整的实现不会继承文档默认字号
  const headingSize = halfPoints(layout.fs * 1.12);
  const headingColor = theme.headingAccent ? accent : ink;
  const run = (options: IRunOptions) => new TextRun({ size, ...options });

  const richRuns = (raw: string, color = body): TextRun[] =>
    richSpans(raw).map((span) =>
      span.strong ? run({ text: span.text, bold: true, color: ink }) : run({ text: span.text, color }),
    );

  const bulletRuns = (bullet: ResumeBullet): TextRun[] => [
    ...(bullet.lead?.trim()
      ? [
          run({ text: typeset(bullet.lead), bold: true, color: theme.leadAccent ? accent : ink }),
          run({ text: "：", color: body }),
        ]
      : []),
    ...richRuns(bullet.text),
  ];

  const itemParagraphs = (item: ResumeItem, plain: boolean, first: boolean): Paragraph[] => {
    const head = [run({ text: typeset(item.heading), bold: true, color: ink, size: size + 1 })];
    if (item.subheading) {
      head.push(run({ text: ` · ${typeset(item.subheading)}`, color: theme.subAccent ? accent : body }));
    }
    const aside = [item.period, item.meta && typeset(item.meta)].filter(Boolean).join(" · ");
    if (aside) head.push(run({ children: ["\t", aside], color: muted, size: small }));
    const hasBody = item.bullets.length > 0 || !!item.techStack?.length;
    const paragraphs = [
      new Paragraph({
        children: head,
        tabStops: [{ type: TabStopType.RIGHT, position: contentWidth }],
        spacing: { before: first ? 0 : gap(layout.itemGap), after: 0 },
        keepNext: hasBody,
        keepLines: true,
      }),
    ];
    if (item.techStack?.length) {
      paragraphs.push(
        new Paragraph({
          children: [
            run({ text: "技术栈：", color: muted, size: small }),
            run({ text: item.techStack.map(typeset).join(" / "), color: muted, size: small }),
          ],
          keepNext: item.bullets.length > 0,
          keepLines: true,
        }),
      );
    }
    item.bullets.forEach((bullet, i) => {
      paragraphs.push(
        new Paragraph({
          children: bulletRuns(bullet),
          ...(plain ? {} : { numbering: { reference: BULLET_REF, level: 0 } }),
          alignment: AlignmentType.JUSTIFIED,
          spacing: { before: i === 0 ? gap(1) : gap(layout.liGap), after: 0 },
          keepLines: true,
          keepNext: i < item.bullets.length - 1,
        }),
      );
    });
    return paragraphs;
  };

  const skillParagraph = (item: ResumeItem, index: number): Paragraph[] => {
    const label = item.heading.trim();
    const runs = label
      ? [run({ text: `${typeset(label)}：`, bold: true, color: theme.skillAccent ? accent : ink })]
      : [];
    item.bullets.forEach((bullet, i) => {
      if (i > 0) runs.push(run({ text: "；", color: body }));
      if (bullet.lead) runs.push(run({ text: `${typeset(bullet.lead)} `, color: muted }));
      runs.push(run({ text: typeset(bullet.text), color: body }));
    });
    return [
      new Paragraph({
        children: runs,
        spacing: { before: index === 0 ? 0 : gap(layout.liGap + 1.5), after: 0 },
        keepLines: true,
      }),
    ];
  };

  const sectionParagraphs = (section: ResumeSection): Paragraph[] => {
    if (section.items.length === 0) return [];
    const plain = section.kind === "education";
    return [
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [run({ text: section.title, size: headingSize, bold: true, color: headingColor })],
      }),
      ...section.items.flatMap((item, i) =>
        section.kind === "skills" ? skillParagraph(item, i) : itemParagraphs(item, plain, i === 0),
      ),
    ];
  };

  const banner = theme.banner ? { shading: { type: ShadingType.CLEAR, fill: accent, color: "auto" } } : {};
  const align = theme.center ? AlignmentType.CENTER : AlignmentType.LEFT;
  const pad = theme.banner ? " " : "";
  const headParagraphs: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: align,
      children: [
        run({
          text: `${pad}${name}`,
          size: halfPoints(layout.name),
          bold: true,
          font: fontOf(theme.nameFont),
          color: theme.banner ? "FFFFFF" : ink,
        }),
      ],
      ...banner,
    }),
  ];
  if (headline) {
    headParagraphs.push(
      new Paragraph({
        alignment: align,
        children: [
          run({
            text: `${pad}${typeset(headline)}`,
            color: theme.banner ? "FFFFFF" : theme.headlineAccent ? accent : body,
            size: size + 2,
            bold: !mono,
          }),
        ],
        spacing: { before: 40 },
        ...banner,
      }),
    );
  }
  const contactLine = [...contacts.map(typeset), ...links.map(linkText)];
  if (contactLine.length) {
    headParagraphs.push(
      new Paragraph({
        alignment: align,
        children: [
          run({
            text: `${pad}${contactLine.join(theme.center ? "  |  " : mono ? "  /  " : "  ·  ")}${pad}`,
            color: theme.banner ? "FFFFFF" : muted,
            size: small,
          }),
        ],
        spacing: { before: 40 },
        ...banner,
      }),
    );
  }
  if (theme.headRule) {
    const color = theme.headRule.accent ? accent : "111111";
    headParagraphs.push(
      new Paragraph({
        children: [],
        spacing: { before: 0, after: 0, line: 120 },
        border: { bottom: { style: BorderStyle.SINGLE, size: theme.headRule.size, color, space: 1 } },
      }),
    );
  }
  if (summary) {
    headParagraphs.push(
      new Paragraph({
        children: [run({ text: typeset(summary), color: body })],
        alignment: theme.center ? AlignmentType.CENTER : AlignmentType.JUSTIFIED,
        spacing: { before: 100 },
      }),
    );
  }

  const ruleColor = mono ? "BBBBBB" : accent;
  const headingBorder: { border?: Record<string, IBorderOptions> } =
    theme.headingBorder === "bottom"
      ? { border: { bottom: { style: BorderStyle.SINGLE, size: mono ? 4 : 6, color: ruleColor, space: 1 } } }
      : theme.headingBorder === "left"
        ? { border: { left: { style: BorderStyle.SINGLE, size: 24, color: accent, space: 6 } } }
        : {};

  const doc = new Document({
    title: `${name} - 简历`,
    styles: {
      default: {
        document: {
          run: { font, size, color: body },
          paragraph: { spacing: { line: Math.round(layout.lh * 240) } },
        },
      },
      paragraphStyles: [
        {
          id: "Title",
          name: "Title",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: {
            font: fontOf(theme.nameFont),
            size: halfPoints(layout.name),
            bold: true,
            characterSpacing: mono ? 60 : 30,
          },
          paragraph: { spacing: { after: 0, line: 240 } },
        },
        {
          id: "Heading1",
          name: "heading 1",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: {
            font,
            size: headingSize,
            bold: true,
            color: headingColor,
            characterSpacing: mono ? 100 : 20,
          },
          paragraph: {
            spacing: { before: gap(layout.secGap + 2), after: gap(4) },
            keepNext: true,
            ...headingBorder,
          },
        },
      ],
    },
    numbering: {
      config: [
        {
          reference: BULLET_REF,
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: theme.bullet,
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: { indent: { left: 300, hanging: 200 } },
                run: { color: theme.bulletAccent ? accent : mono ? "777777" : "6B7280" },
              },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
            margin: { top: margin.y, bottom: margin.y, left: margin.x, right: margin.x },
          },
        },
        children: [...headParagraphs, ...content.sections.flatMap(sectionParagraphs)],
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}
