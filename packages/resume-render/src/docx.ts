import {
  ACCENT_INFO,
  type ResumeContent,
  type ResumeItem,
  type ResumeSection,
  type ResumeTemplate,
  skillLine,
} from "@talksume/core";
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  type IBorderOptions,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  TabStopType,
  TextRun,
} from "docx";
import { resolveRenderStyle } from "./html.ts";
import type { RenderOptions } from "./types.ts";

const FONT = "Source Han Sans SC";
const SERIF = "Source Han Serif SC";
const PAGE_WIDTH = 11906;
const PAGE_HEIGHT = 16838;
const BULLET_REF = "resume-bullets";
const MM = 56.7;

/** Word 只对齐各模板的主要风格：强调色、标题样式、字号与页边距，不追求像素一致。 */
interface DocxTheme {
  margin: { x: number; y: number };
  size: number;
  line: number;
  nameSize: number;
  nameFont: string;
  center: boolean;
  /** 抬头整块用强调色底、白字。 */
  banner: boolean;
  headRule?: { size: number; accent: boolean };
  headingSize: number;
  headingAccent: boolean;
  headingSpacing: number;
  headingBorder: "bottom" | "left" | "none";
  subAccent: boolean;
  bullet: string;
  itemGap: number;
}

const THEMES: Record<ResumeTemplate, DocxTheme> = {
  campus: {
    margin: { x: 16 * MM, y: 14 * MM },
    size: 19,
    line: 300,
    nameSize: 42,
    nameFont: FONT,
    center: true,
    banner: false,
    headingSize: 22,
    headingAccent: true,
    headingSpacing: 20,
    headingBorder: "bottom",
    subAccent: false,
    bullet: "•",
    itemGap: 100,
  },
  modern: {
    margin: { x: 14 * MM, y: 12 * MM },
    size: 19,
    line: 300,
    nameSize: 44,
    nameFont: FONT,
    center: false,
    banner: true,
    headingSize: 23,
    headingAccent: false,
    headingSpacing: 15,
    headingBorder: "left",
    subAccent: true,
    bullet: "▪",
    itemGap: 110,
  },
  minimal: {
    margin: { x: 20 * MM, y: 18 * MM },
    size: 19,
    line: 310,
    nameSize: 48,
    nameFont: SERIF,
    center: false,
    banner: false,
    headRule: { size: 6, accent: false },
    headingSize: 19,
    headingAccent: true,
    headingSpacing: 80,
    headingBorder: "none",
    subAccent: false,
    bullet: "–",
    itemGap: 140,
  },
  tech: {
    margin: { x: 13 * MM, y: 11 * MM },
    size: 18,
    line: 276,
    nameSize: 38,
    nameFont: FONT,
    center: false,
    banner: false,
    headRule: { size: 12, accent: true },
    headingSize: 20,
    headingAccent: true,
    headingSpacing: 10,
    headingBorder: "bottom",
    subAccent: false,
    bullet: "•",
    itemGap: 70,
  },
};

const fontOf = (name: string) => ({ ascii: name, hAnsi: name, eastAsia: name, cs: name });

export async function renderDocx(content: ResumeContent, options: RenderOptions = {}): Promise<Uint8Array> {
  const style = resolveRenderStyle(options);
  const theme = THEMES[style.template];
  const accent = ACCENT_INFO[style.accent].hex.slice(1).toUpperCase();
  const contentWidth = PAGE_WIDTH - Math.round(theme.margin.x) * 2;
  const font = fontOf(FONT);
  const { name, contacts, summary } = content.basics;

  const itemParagraphs = (item: ResumeItem): Paragraph[] => {
    const head = [new TextRun({ text: item.heading, bold: true, color: "111827", size: theme.size + 1 })];
    if (item.subheading) {
      head.push(new TextRun({ text: `  ${item.subheading}`, color: theme.subAccent ? accent : "4B5563" }));
    }
    if (item.period)
      head.push(new TextRun({ children: ["\t", item.period], color: "6B7280", size: theme.size - 1 }));
    const paragraphs = [
      new Paragraph({
        children: head,
        tabStops: [{ type: TabStopType.RIGHT, position: contentWidth }],
        spacing: { before: theme.itemGap, after: 20 },
        keepNext: item.bullets.length > 0,
        keepLines: true,
      }),
    ];
    item.bullets.forEach((bullet, i) => {
      paragraphs.push(
        new Paragraph({
          children: [new TextRun({ text: bullet.text, color: "374151" })],
          numbering: { reference: BULLET_REF, level: 0 },
          alignment: AlignmentType.JUSTIFIED,
          spacing: { after: 10 },
          keepLines: true,
          keepNext: i < item.bullets.length - 1,
        }),
      );
    });
    return paragraphs;
  };

  const skillParagraph = (item: ResumeItem): Paragraph[] => {
    const { label, text } = skillLine(item);
    const labelColor = style.template === "modern" || style.template === "tech" ? accent : "111827";
    const runs = label ? [new TextRun({ text: `${label}：`, bold: true, color: labelColor })] : [];
    runs.push(new TextRun({ text, color: "374151" }));
    return [new Paragraph({ children: runs, spacing: { before: 40, after: 10 }, keepLines: true })];
  };

  const sectionParagraphs = (section: ResumeSection): Paragraph[] => {
    if (section.items.length === 0) return [];
    return [
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(section.title)] }),
      ...section.items.flatMap(section.kind === "skills" ? skillParagraph : itemParagraphs),
    ];
  };

  const banner = theme.banner ? { shading: { type: ShadingType.CLEAR, fill: accent, color: "auto" } } : {};
  const align = theme.center ? AlignmentType.CENTER : AlignmentType.LEFT;
  const headParagraphs: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: align,
      children: [
        new TextRun({ text: theme.banner ? ` ${name}` : name, color: theme.banner ? "FFFFFF" : "111827" }),
      ],
      ...banner,
    }),
  ];
  if (contacts.length) {
    headParagraphs.push(
      new Paragraph({
        alignment: align,
        children: [
          new TextRun({
            text: `${theme.banner ? " " : ""}${contacts.join(theme.center ? "  |  " : "  ·  ")}`,
            color: theme.banner ? "FFFFFF" : "4B5563",
            size: theme.size - 1,
          }),
        ],
        spacing: { before: 60 },
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
        children: [new TextRun({ text: summary, color: "374151" })],
        alignment: theme.center ? AlignmentType.CENTER : AlignmentType.JUSTIFIED,
        spacing: { before: 120 },
      }),
    );
  }

  const headingBorder: { border?: Record<string, IBorderOptions> } =
    theme.headingBorder === "bottom"
      ? {
          border: {
            bottom: {
              style: BorderStyle.SINGLE,
              size: style.template === "tech" ? 4 : 8,
              color: accent,
              space: 1,
            },
          },
        }
      : theme.headingBorder === "left"
        ? { border: { left: { style: BorderStyle.SINGLE, size: 24, color: accent, space: 6 } } }
        : {};

  const doc = new Document({
    title: `${name} - 简历`,
    styles: {
      default: {
        document: {
          run: { font, size: theme.size, color: "1F2937" },
          paragraph: { spacing: { line: theme.line } },
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
            size: theme.nameSize,
            bold: true,
            characterSpacing: style.template === "minimal" ? 60 : 30,
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
            size: theme.headingSize,
            bold: true,
            color: theme.headingAccent ? accent : "111827",
            characterSpacing: style.template === "minimal" ? 100 : 20,
          },
          paragraph: {
            spacing: { before: style.template === "minimal" ? 300 : 220, after: 60 + theme.headingSpacing },
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
                paragraph: { indent: { left: 340, hanging: 220 } },
                run: { color: theme.subAccent || style.template === "tech" ? accent : "6B7280" },
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
            margin: {
              top: Math.round(theme.margin.y),
              bottom: Math.round(theme.margin.y),
              left: Math.round(theme.margin.x),
              right: Math.round(theme.margin.x),
            },
          },
        },
        children: [...headParagraphs, ...content.sections.flatMap(sectionParagraphs)],
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}
