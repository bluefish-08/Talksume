import type { ResumeContent, ResumeItem, ResumeSection } from "@talksume/core";
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  TabStopType,
  TextRun,
} from "docx";
import { DEFAULT_TEMPLATE, type RenderOptions } from "./types.ts";

const FONT = "Source Han Sans SC";
const PAGE_WIDTH = 11906;
const PAGE_HEIGHT = 16838;
const MARGIN_X = 850;
const MARGIN_Y = 680;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;
const BULLET_REF = "resume-bullets";

const font = { ascii: FONT, hAnsi: FONT, eastAsia: FONT, cs: FONT };

function itemParagraphs(item: ResumeItem): Paragraph[] {
  const head = [new TextRun({ text: item.heading, bold: true, color: "111827" })];
  if (item.subheading) head.push(new TextRun({ text: `  ${item.subheading}`, color: "4B5563" }));
  if (item.period) head.push(new TextRun({ children: ["\t", item.period], color: "4B5563", size: 18 }));
  const paragraphs = [
    new Paragraph({
      children: head,
      tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_WIDTH }],
      spacing: { before: 80, after: 20 },
      keepNext: item.bullets.length > 0,
      keepLines: true,
    }),
  ];
  item.bullets.forEach((bullet, i) => {
    paragraphs.push(
      new Paragraph({
        children: [new TextRun(bullet.text)],
        numbering: { reference: BULLET_REF, level: 0 },
        spacing: { after: 10 },
        keepLines: true,
        keepNext: i < item.bullets.length - 1,
      }),
    );
  });
  return paragraphs;
}

function sectionParagraphs(section: ResumeSection): Paragraph[] {
  if (section.items.length === 0) return [];
  return [
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(section.title)] }),
    ...section.items.flatMap(itemParagraphs),
  ];
}

export async function renderDocx(content: ResumeContent, options: RenderOptions = {}): Promise<Uint8Array> {
  const template = options.template ?? DEFAULT_TEMPLATE;
  if (template !== "campus") throw new Error(`未知简历模板: ${String(template)}`);
  const { name, contacts, summary } = content.basics;

  const children: Paragraph[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(name)] }),
  ];
  if (contacts.length) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: contacts.join("  |  "), color: "4B5563", size: 18 })],
        spacing: { before: 40 },
      }),
    );
  }
  if (summary) children.push(new Paragraph({ children: [new TextRun(summary)], spacing: { before: 80 } }));
  children.push(...content.sections.flatMap(sectionParagraphs));

  const doc = new Document({
    title: `${name} - 简历`,
    styles: {
      default: { document: { run: { font, size: 19 }, paragraph: { spacing: { line: 300 } } } },
      paragraphStyles: [
        {
          id: "Title",
          name: "Title",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { font, size: 44, bold: true, color: "111827" },
          paragraph: { alignment: AlignmentType.LEFT, spacing: { after: 0 } },
        },
        {
          id: "Heading1",
          name: "heading 1",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { font, size: 22, bold: true, color: "1D4E89" },
          paragraph: {
            spacing: { before: 180, after: 40 },
            keepNext: true,
            border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: "1D4E89", space: 1 } },
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
              text: "•",
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 360, hanging: 240 } } },
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
            margin: { top: MARGIN_Y, bottom: MARGIN_Y, left: MARGIN_X, right: MARGIN_X },
          },
        },
        children,
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}
