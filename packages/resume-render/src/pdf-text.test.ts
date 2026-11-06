import type { ResumeTheme } from "@talksume/core";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { afterAll, describe, expect, it } from "vitest";
import { close, renderPdf, sampleResume } from "./index.ts";
import { canonicalHan, fixToUnicodeCMap, RADICAL_CHARS } from "./pdf-text.ts";

afterAll(close);

async function extractText(pdf: Uint8Array): Promise<string> {
  const doc = await getDocument({ data: new Uint8Array(pdf), useSystemFonts: false, verbosity: 0 }).promise;
  let text = "";
  for (let p = 1; p <= doc.numPages; p++) {
    const { items } = await (await doc.getPage(p)).getTextContent();
    for (const item of items) if ("str" in item) text += item.str;
  }
  return text;
}

const serifTheme: ResumeTheme = {
  name: "衬线",
  accent: "#1f4e79",
  bodyFont: "serif",
  headingFont: "serif",
  header: "plain",
  headerAlign: "left",
  headingStyle: "bar",
  layout: "single",
  bullet: "dot",
  skills: "line",
  density: "auto",
  skeleton: "classic",
};

const WORDS = ["大学", "工程师", "网络", "奖学金", "接口"];

describe("PDF 文字层", () => {
  const cases: [string, Parameters<typeof renderPdf>[1]][] = [
    ["默认预设", { template: "campus" }],
    ["衬线正文主题", { theme: serifTheme }],
  ];
  for (const [label, options] of cases) {
    it(`${label}：不含部首区字符，常用整词可读`, async () => {
      const text = await extractText(await renderPdf(sampleResume, options));
      expect(text.match(new RegExp(RADICAL_CHARS.source, "gu")) ?? []).toEqual([]);
      for (const word of WORDS) expect(text).toContain(word);
    });
  }
});

describe("fixToUnicodeCMap", () => {
  it("bfchar 与 bfrange 里的部首码位改回规范汉字，其余不动", () => {
    const cmap = [
      "2 beginbfchar",
      "<0001> <2F2F>",
      "<0002> <0041>",
      "endbfchar",
      "2 beginbfrange",
      "<0010> <0012> <2ED8>",
      "<0020> <0022> <0061>",
      "endbfrange",
    ].join("\n");
    const fixed = fixToUnicodeCMap(cmap) ?? "";
    expect(fixed).toContain("<0001> <5DE5>");
    expect(fixed).toContain("<0002> <0041>");
    expect(fixed).toContain("<0010> <0010> <9752>");
    expect(fixed).toContain("<0020> <0022> <0061>");
    expect(fixToUnicodeCMap(fixed)).toBeNull();
  });

  it("规范化表覆盖康熙部首、兼容汉字与部首补充区", () => {
    expect(canonicalHan("⼤")).toBe("大");
    expect(canonicalHan("⼾")).toBe("户");
    expect(canonicalHan("戶")).toBe("戶");
    expect(canonicalHan("⻬")).toBe("齐");
    expect(canonicalHan("⻚")).toBe("页");
    expect(canonicalHan("豈")).toBe("豈");
    expect(canonicalHan("大")).toBe("大");
  });
});
