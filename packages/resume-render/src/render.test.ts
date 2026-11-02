import { ACCENT_INFO, RESUME_TEMPLATES, type ResumeContent } from "@talksume/core";
import JSZip from "jszip";
import { chromium } from "playwright";
import { afterAll, describe, expect, it } from "vitest";
import { skillTokens } from "./html.ts";
import {
  close,
  renderDocx,
  renderFragment,
  renderHtml,
  renderPdf,
  sampleResume,
  sparseResume,
} from "./index.ts";
import { plainText, richSpans, typeset } from "./text.ts";

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
    content.basics.headline,
    ...content.basics.contacts,
    content.basics.summary,
    ...content.sections.flatMap((s) => [
      s.title,
      ...s.items.flatMap((i) => [
        i.heading,
        i.subheading,
        i.period,
        i.meta,
        ...(i.techStack ?? []),
        ...i.bullets.flatMap((b) => [b.lead, ...(s.kind === "skills" ? skillTokens(b.text) : [b.text])]),
      ]),
    ]),
  ]
    .filter((t): t is string => Boolean(t))
    .map(plainText);

const textOf = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

const one = (
  items: ResumeContent["sections"][number]["items"],
  kind = "projects" as const,
): ResumeContent => ({
  basics: { name: "周以安", contacts: [] },
  sections: [{ kind, title: "项目经历", items }],
});

afterAll(() => close());

describe("renderHtml", () => {
  it.each(RESUME_TEMPLATES)("%s 模板包含样例的全部分区与条目文本", (template) => {
    const text = textOf(renderFragment(sampleResume, { template }).html);
    for (const expected of allTexts(sampleResume)) expect(text).toContain(expected);
  });

  it("要点渲染成加粗短语 + 冒号 + 细节，细节里带单位的数字加粗", () => {
    const { html } = renderFragment(
      one([
        {
          heading: "星云科技",
          bullets: [
            { lead: "订单查询优化", text: "P99 延迟从 480ms 降至 120ms，覆盖 3000 多名用户", factIds: [] },
          ],
        },
      ]),
    );
    expect(html).toContain(
      '<li data-bullet="0-0-0"><b class="lead">订单查询优化</b>：P99 延迟从 <b class="num">480ms</b> 降至 <b class="num">120ms</b>，覆盖 <b class="num">3000 多名</b>用户</li>',
    );
  });

  it("技术栈单独一行，时间右侧带城市；空字段不留元素", () => {
    const full = renderFragment(
      one([{ heading: "MiniKV", period: "2024.01", meta: "江城", techStack: ["Go", "Raft"], bullets: [] }]),
    ).html;
    expect(full).toContain(
      '<p class="item-stack"><span class="label">技术栈：</span><span class="stack">Go / Raft</span></p>',
    );
    expect(full).toContain('<span class="item-period">2024.01</span><span class="item-meta">江城</span>');
    const bare = renderFragment(one([{ heading: "MiniKV", bullets: [] }])).html;
    for (const absent of [
      "item-stack",
      "item-meta",
      "item-aside",
      "item-sub",
      "<ul",
      "headline",
      "contacts",
      "summary",
    ]) {
      expect(bare).not.toContain(absent);
    }
  });

  it("求职意向行与链接进抬头，链接去掉协议头", () => {
    const html = renderFragment({
      basics: {
        name: "林知远",
        headline: "2026 届 · 后端开发工程师 · 校招",
        contacts: ["江城"],
        links: [
          { label: "GitHub", url: "https://github.com/example-linzy/" },
          { label: "博客", url: "https://linzy.example.com" },
        ],
      },
      sections: [],
    }).html;
    expect(html).toContain('<p class="headline">2026 届 · 后端开发工程师 · 校招</p>');
    expect(html).toContain("<span>github.com/example-linzy</span><span>博客：linzy.example.com</span>");
  });

  it("教育条目的成绩、课程行不带项目符号", () => {
    const { html } = renderFragment(sampleResume);
    expect(html).toMatch(/data-kind="education".*?<ul class="lines">/);
  });

  it("内容少用宽松档、内容多收紧，超长内容用最紧一档", () => {
    const density = (c: ResumeContent) => renderFragment(c, { template: "campus" }).layout.density;
    expect(density(sparseResume)).toBe("roomy");
    expect(["normal", "compact", "tight"]).toContain(density(sampleResume));
    const long = { ...sampleResume, sections: [...sampleResume.sections, ...sampleResume.sections] };
    expect(density(long)).toBe("tight");
    expect(renderFragment(sparseResume).layout.fs).toBeGreaterThan(renderFragment(sampleResume).layout.fs);
  });

  it("强调色写进 --accent，未知模板直接报错", () => {
    expect(renderHtml(sampleResume, { template: "modern", accent: "teal" })).toContain(
      `--accent: ${ACCENT_INFO.teal.hex}`,
    );
    expect(() => renderHtml(sampleResume, { template: "fancy" as never })).toThrow("未知简历模板");
  });

  it("片段的样式全部限定在 .resume 下，带条目与要点定位属性", () => {
    const { css, html } = renderFragment(sampleResume, { template: "tech" });
    const selectors = [...css.matchAll(/(?:^|})\s*([^{}@]+)\{/g)].flatMap((m) => (m[1] ?? "").split(","));
    for (const selector of selectors) expect(selector.trim()).toMatch(/^\.resume/);
    expect(html).toContain('data-item="0-0"');
    expect(html).toContain('data-bullet="1-0-2"');
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
    expect(html).toContain('<span class="item-title">熟悉：</span>Go、MySQL</p>');
    expect(html).toContain('<p class="skill-line" data-item="0-1">Python</p>');
    expect(html).not.toContain("<li");
  });

  it("技术紧凑模板把短技能渲染成标签，整句描述退回一行", () => {
    const skills = (text: string): ResumeContent => ({
      basics: { name: "陈晓", contacts: [] },
      sections: [
        { kind: "skills", title: "专业技能", items: [{ heading: "熟悉", bullets: [{ text, factIds: [] }] }] },
      ],
    });
    const tags = renderHtml(skills("Go、MySQL（索引、事务）"), { template: "tech" });
    expect(tags).toContain('<span class="tag">Go</span> <span class="tag">MySQL（索引、事务）</span>');
    const line = renderHtml(skills("熟练使用 Java，LeetCode 刷题 400+"), { template: "tech" });
    expect(line).not.toContain('class="tag"');
  });

  it("切技能词时不切括号里的顿号", () => {
    expect(skillTokens("Go、MySQL（索引、事务）；Redis")).toEqual(["Go", "MySQL（索引、事务）", "Redis"]);
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

describe("排版文本", () => {
  const marked = (raw: string) =>
    richSpans(raw)
      .map((s) => (s.strong ? `[${s.text}]` : s.text))
      .join("");

  it("中英文、数字之间补空格，中文句子里的半角标点换全角", () => {
    expect(typeset("用Redis做缓存,QPS提升到3000(峰值)")).toBe("用 Redis 做缓存，QPS 提升到 3000（峰值）");
    expect(typeset("Spring Boot, MyBatis (Java)")).toBe("Spring Boot, MyBatis (Java)");
    expect(typeset("日均 1,200 单")).toBe("日均 1,200 单");
  });

  it("只加粗带单位或变化量的数字，年份、版本号、编号不加粗", () => {
    expect(marked("QPS 从 1200 提升到 3500，耗时降 40%，日均 200 万条")).toBe(
      "QPS 从 [1200] 提升到 [3500]，耗时降 [40%]，日均 [200 万条]",
    );
    expect(marked("2024 年用 Java 17 和 Vue3 重写，通过 CET-6，P99 稳定")).toBe(
      "2024 年用 Java 17 和 Vue3 重写，通过 CET-6，P99 稳定",
    );
  });

  it("有 **…** 标记时只加粗标记内容，标记两侧照样补空格", () => {
    expect(marked("提升**30%**的转化，耗时 2 秒")).toBe("提升 [30%] 的转化，耗时 2 秒");
    expect(plainText("提升**30%**的转化")).toBe("提升 30% 的转化");
  });
});

/** 逐个元素（含伪元素）读计算样式，任何颜色的 RGB 三个分量差超过 2 就算彩色。 */
async function coloredStyles(html: string): Promise<string[]> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html);
    return await page.evaluate(() => {
      // 这个包不引 DOM 类型库，只声明用到的两个全局
      const { document, getComputedStyle } = globalThis as unknown as {
        document: { querySelectorAll(selector: string): Iterable<{ className: string }> };
        getComputedStyle(el: unknown, pseudo: string | null): { getPropertyValue(prop: string): string };
      };
      const props = [
        "color",
        "background-color",
        "border-top-color",
        "border-bottom-color",
        "border-left-color",
      ];
      const found: string[] = [];
      for (const el of document.querySelectorAll(".resume, .resume *")) {
        for (const pseudo of [null, "::before", "::after"]) {
          const style = getComputedStyle(el, pseudo);
          for (const prop of props) {
            const value = style.getPropertyValue(prop);
            const rgb = (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
            if (rgb.length === 3 && Math.max(...rgb) - Math.min(...rgb) > 2)
              found.push(`${el.className}${pseudo ?? ""} ${prop} ${value}`);
          }
        }
      }
      return found;
    });
  } finally {
    await browser.close();
  }
}

describe("极简黑白", { timeout: 30_000 }, () => {
  it("选了强调色也只有黑白灰", async () => {
    expect(await coloredStyles(renderHtml(sampleResume, { template: "minimal", accent: "wine" }))).toEqual(
      [],
    );
  });

  it("对照：经典校园模板确实用了强调色", async () => {
    expect((await coloredStyles(renderHtml(sampleResume, { template: "campus" }))).length).toBeGreaterThan(0);
  });

  it("Word 版也不出现彩色", async () => {
    const docx = await renderDocx(sampleResume, { template: "minimal", accent: "wine" });
    for (const name of ["word/document.xml", "word/styles.xml", "word/numbering.xml"]) {
      const xml = await readZipEntry(docx, name);
      for (const [, hex] of xml.matchAll(/w:(?:color|fill)="([0-9A-Fa-f]{6})"/g)) {
        const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(hex?.slice(i, i + 2) ?? "", 16));
        expect(
          Math.max(r ?? 0, g ?? 0, b ?? 0) - Math.min(r ?? 0, g ?? 0, b ?? 0),
          `${name} ${hex}`,
        ).toBeLessThanOrEqual(2);
      }
    }
  });
});

describe("renderPdf", { timeout: 30_000 }, () => {
  it.each(RESUME_TEMPLATES)("%s 模板把样例输出成合法的单页 PDF", async (template) => {
    const pdf = await renderPdf(sampleResume, { template });
    expect(decoder.decode(pdf.subarray(0, 4))).toBe("%PDF");
    expect(countPdfPages(pdf)).toBe(1);
  });

  it("内容很少时也只有一页", async () => {
    expect(countPdfPages(await renderPdf(sparseResume))).toBe(1);
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
  it.each(RESUME_TEMPLATES)("%s 模板输出合法 zip，document.xml 含姓名与各分区标题", async (template) => {
    const docx = await renderDocx(sampleResume, { template });
    expect(docx[0]).toBe(0x50);
    expect(docx[1]).toBe(0x4b);
    const xml = await readZipEntry(docx, "word/document.xml");
    expect(xml).toContain(sampleResume.basics.name);
    expect(xml).toContain(plainText(sampleResume.basics.headline ?? "缺少求职意向行"));
    for (const section of sampleResume.sections) expect(xml).toContain(section.title);
  });

  it("标题样式带上所选强调色", async () => {
    const docx = await renderDocx(sampleResume, { template: "campus", accent: "wine" });
    const styles = await readZipEntry(docx, "word/styles.xml");
    expect(styles).toContain(ACCENT_INFO.wine.hex.slice(1).toUpperCase());
  });

  it("要点的加粗短语、数字加粗、技术栈行都进 Word", async () => {
    const xml = await readZipEntry(await renderDocx(sampleResume), "word/document.xml");
    expect(xml).toMatch(/<w:b\/>.*?<w:t[^>]*>订单查询链路优化<\/w:t>/);
    expect(xml).toMatch(/<w:b\/>.*?<w:t[^>]*>480ms<\/w:t>/);
    expect(xml).toContain("技术栈：");
    expect(xml).toContain("Java / Spring Boot / MySQL / Redis / Kafka");
    expect(xml).toMatch(/编程语言：<\/w:t>.*?熟练 <\/w:t>.*?Java、Go/);
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
