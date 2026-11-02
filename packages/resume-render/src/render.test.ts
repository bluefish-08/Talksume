import type { ResumeContent } from "@talksume/core";
import JSZip from "jszip";
import { afterAll, describe, expect, it } from "vitest";
import { close, renderDocx, renderHtml, renderPdf, sampleResume } from "./index.ts";

const decoder = new TextDecoder();

function countPdfPages(pdf: Uint8Array): number {
  return decoder.decode(pdf).match(/\/Type\s*\/Page[^s]/g)?.length ?? 0;
}

async function readZipEntry(zip: Uint8Array, name: string): Promise<string> {
  const file = (await JSZip.loadAsync(zip)).file(name);
  if (!file) throw new Error(`zip 中没有 ${name}`);
  return file.async("string");
}

const allTexts = (content: ResumeContent): string[] =>
  [
    content.basics.name,
    ...content.basics.contacts,
    ...(content.basics.summary ? [content.basics.summary] : []),
    ...content.sections.flatMap((s) => [
      s.title,
      ...s.items.flatMap((i) => [i.heading, i.subheading, i.period, ...i.bullets.map((b) => b.text)]),
    ]),
  ].filter((t): t is string => Boolean(t));

afterAll(() => close());

describe("renderHtml", () => {
  it("包含样例的全部分区与条目文本", () => {
    const html = renderHtml(sampleResume, { template: "campus" });
    for (const text of allTexts(sampleResume)) expect(html).toContain(text);
  });

  it("技能每组渲染成一行「标题：内容」，无标题时只有内容", () => {
    const html = renderHtml({
      basics: { name: "陈晓", contacts: [] },
      sections: [
        {
          kind: "skills",
          title: "专业技能",
          items: [
            { heading: "熟悉", bullets: [{ text: "Go、MySQL", factIds: [] }] },
            { heading: "", bullets: [{ text: "Python", factIds: [] }] },
          ],
        },
      ],
    });
    expect(html).toContain('<p class="skill-line"><span class="item-title">熟悉：</span>Go、MySQL</p>');
    expect(html).toContain('<p class="skill-line">Python</p>');
    expect(html).not.toContain("<li>");
  });

  it("转义所有用户文本，防止 XSS", () => {
    const evil = '<script>alert("x")</script>';
    const html = renderHtml({
      basics: { name: evil, contacts: [evil], summary: evil },
      sections: [
        {
          kind: "custom",
          title: evil,
          items: [{ heading: evil, subheading: evil, period: evil, bullets: [{ text: evil, factIds: [] }] }],
        },
      ],
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
  });
});

describe("renderPdf", () => {
  it("样例输出合法的单页 PDF", async () => {
    const pdf = await renderPdf(sampleResume);
    expect(decoder.decode(pdf.subarray(0, 4))).toBe("%PDF");
    expect(countPdfPages(pdf)).toBe(1);
  });

  it("内容过长时自动分页", async () => {
    const long: ResumeContent = {
      ...sampleResume,
      sections: [...sampleResume.sections, ...sampleResume.sections, ...sampleResume.sections],
    };
    expect(countPdfPages(await renderPdf(long))).toBeGreaterThan(1);
  });
});

describe("renderDocx", () => {
  it("输出合法 zip，document.xml 含姓名与各分区标题", async () => {
    const docx = await renderDocx(sampleResume);
    expect(docx[0]).toBe(0x50);
    expect(docx[1]).toBe(0x4b);
    const xml = await readZipEntry(docx, "word/document.xml");
    expect(xml).toContain(sampleResume.basics.name);
    for (const section of sampleResume.sections) expect(xml).toContain(section.title);
  });

  it("技能渲染成一行，标题与内容在同一段", async () => {
    const docx = await renderDocx({
      basics: { name: "陈晓", contacts: [] },
      sections: [
        {
          kind: "skills",
          title: "专业技能",
          items: [{ heading: "熟悉", bullets: [{ text: "Go、MySQL", factIds: [] }] }],
        },
      ],
    });
    const xml = await readZipEntry(docx, "word/document.xml");
    expect(xml).toMatch(/熟悉：<\/w:t><\/w:r><w:r>.*?Go、MySQL/);
  });
});
