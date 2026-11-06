import {
  DESIGN_DIRECTIONS,
  RESUME_TEMPLATES,
  type ResumeContent,
  type ResumeTheme,
  styleFromDirection,
  THEME_SKELETONS,
} from "@talksume/core";
import { afterAll, describe, expect, it } from "vitest";
import { atsCheck } from "./ats.ts";
import { getBrowser } from "./chromium.ts";
import { close, htmlToPdf, renderHtml, renderPdf, sampleResume, sparseResume } from "./index.ts";
import { fixPdfText } from "./pdf-text.ts";

afterAll(close);

const theme = (skeleton: ResumeTheme["skeleton"]): ResumeTheme => ({
  name: "测试",
  accent: "#1f4e79",
  bodyFont: "sans",
  headingFont: "sans",
  header: "plain",
  headerAlign: "left",
  headingStyle: "bar",
  layout: "single",
  bullet: "dot",
  skills: "line",
  density: "auto",
  skeleton,
});

const bullet = (text: string) => ({ text, factIds: [] });

const resume: ResumeContent = {
  basics: { name: "李明", contacts: ["江城", "139-0000-1111", "liming@example.com"] },
  sections: [
    {
      kind: "experiences",
      title: "实习经历",
      items: [
        {
          heading: "星河科技",
          subheading: "后端开发实习生",
          period: "2025.06 – 2025.09",
          bullets: [
            bullet(
              "重构订单查询接口并引入二级缓存，接口平均响应时间由四百毫秒下降到一百二十毫秒，数据库读压力下降六成",
            ),
            bullet("搭建大促压测脚本并定位连接池瓶颈，单机吞吐提升两倍以上，保障活动期间核心链路零故障"),
          ],
        },
        {
          heading: "云帆数据",
          subheading: "数据平台实习生",
          period: "2024.12 – 2025.03",
          bullets: [
            bullet("为离线任务补齐监控告警和失败重试机制，任务按时完成率由百分之九十二提升到百分之九十九"),
          ],
        },
      ],
    },
    {
      kind: "projects",
      title: "项目经历",
      items: [
        {
          heading: "校园二手交易平台",
          subheading: "后端负责人",
          period: "2024.03 – 2024.10",
          bullets: [
            bullet("设计商品、订单、私信三大模块共四十余个接口，带领四人小组两个月完成上线并稳定运行"),
            bullet("使用全文检索实现商品搜索并按校区过滤，搜索响应时间从八百毫秒降低到九十毫秒"),
          ],
        },
        {
          heading: "分布式键值存储",
          subheading: "个人项目",
          period: "2023.09 – 2023.12",
          bullets: [
            bullet("基于共识算法实现日志复制与选主，通过故障注入测试验证了脑裂和节点重启场景下的一致性"),
          ],
        },
      ],
    },
  ],
};

const FRAME = `<!doctype html><meta charset="utf-8"><style>
@page { size: A4; margin: 12mm }
body { font: 12px/1.6 "PingFang SC", "Noto Sans CJK SC", sans-serif; margin: 0 }
table { width: 100%; border-collapse: collapse; table-layout: fixed } td { vertical-align: top; padding: 2px 6px }
</style>`;

const flat = (c: ResumeContent) =>
  c.sections.map((s) => [
    s.title,
    ...s.items.flatMap((i) => [
      i.heading,
      i.subheading ?? "",
      i.period ?? "",
      ...i.bullets.map((b) => b.text),
    ]),
  ]);

/** 两栏用 table 逐行并排：提取流里就是 左1 右1 左2 右2 …… */
const rowInterleaved = (c: ResumeContent) => {
  const [left = [], right = []] = flat(c);
  const rows = Math.max(left.length, right.length);
  const tr = Array.from(
    { length: rows },
    (_, i) => `<tr><td>${left[i] ?? ""}</td><td>${right[i] ?? ""}</td></tr>`,
  );
  return `${FRAME}<h1>${c.basics.name}</h1><p>${c.basics.contacts.join(" ")}</p><table>${tr.join("")}</table>`;
};

/** 每条要点手动折成两行，两栏各行交替摆放：同一条要点被另一栏的行隔开。 */
const lineInterleaved = (c: ResumeContent) => {
  const half = (s: string) => [s.slice(0, Math.ceil(s.length / 2)), s.slice(Math.ceil(s.length / 2))];
  const cols = flat(c).map((col) => col.flatMap((t) => (t.length > 30 ? half(t) : [t])));
  const [left = [], right = []] = cols;
  const rows = Math.max(left.length, right.length);
  const tr = Array.from(
    { length: rows },
    (_, i) => `<tr><td>${left[i] ?? ""}</td><td>${right[i] ?? ""}</td></tr>`,
  );
  return `${FRAME}<h1>${c.basics.name}</h1><p>${c.basics.contacts.join(" ")}</p><table>${tr.join("")}</table>`;
};

const screenshotPdf = async (html: string) => {
  const browser = await getBrowser();
  const page = await browser.newPage({ viewport: { width: 794, height: 1123 } });
  try {
    await page.setContent(html);
    const png = (await page.screenshot({ fullPage: true })).toString("base64");
    return await htmlToPdf(
      `<!doctype html><style>@page{margin:0}body{margin:0}</style><img src="data:image/png;base64,${png}" width="794">`,
    );
  } finally {
    await page.close();
  }
};

const OPTIONS = [
  ...THEME_SKELETONS.map((name) => [`骨架 ${name}`, { theme: theme(name) }] as const),
  ...RESUME_TEMPLATES.map(
    (template) => [`预设模板 ${template}`, { template, accent: "blue" as const }] as const,
  ),
];

describe("ATS 可读性自检：实际渲染", () => {
  for (const [label, options] of OPTIONS) {
    it(`${label} 应读全`, async () => {
      const report = await atsCheck(await renderPdf(sampleResume, options), sampleResume);
      expect(report.issues).toEqual([]);
      expect(report.ok).toBe(true);
    });
  }

  for (const d of DESIGN_DIRECTIONS) {
    it(`设计方向 ${d.id} 应读全`, async () => {
      const built = styleFromDirection(d);
      if (!built.ok) throw new Error(built.errors.join());
      const { template, accent, theme: t, css } = built.style;
      const options = { template, accent, ...(t && { theme: t }), ...(css && { css }) };
      for (const content of [sampleResume, sparseResume]) {
        const report = await atsCheck(await renderPdf(content, options), content);
        expect(report.issues, d.id).toEqual([]);
      }
    });
  }
});

describe("ATS 可读性自检：反例", () => {
  it("手写的单栏 PDF 通过，作为反例的对照", async () => {
    const html = `${FRAME}<h1>${resume.basics.name}</h1><p>${resume.basics.contacts.join(" ")}</p>${flat(
      resume,
    )
      .map((col) => col.map((t, i) => (i === 0 ? `<h2>${t}</h2>` : `<p>${t}</p>`)).join(""))
      .join("")}`;
    const report = await atsCheck(await htmlToPdf(html), resume);
    expect(report.issues).toEqual([]);
  });

  it("两栏逐行并排：提取流左右栏交错，报 order 和 items", async () => {
    const report = await atsCheck(await htmlToPdf(rowInterleaved(resume)), resume);
    expect(report.ok).toBe(false);
    expect(report.checks.textLayer).toBe(true);
    expect(report.checks.order || report.checks.items).toBe(false);
    expect(report.issues.join("\n")).toMatch(/交错|隔开|拆散/);
  });

  it("要点折行被另一栏的行隔开：报 items", async () => {
    const report = await atsCheck(await htmlToPdf(lineInterleaved(resume)), resume);
    expect(report.ok).toBe(false);
    expect(report.checks.items).toBe(false);
    expect(report.issues.join("\n")).toContain("拆散");
  });

  it("文字画成图片：没有文字层", async () => {
    const pdf = await screenshotPdf(
      `${FRAME}<h1>${resume.basics.name}</h1>${flat(resume)
        .map((col) => col.map((t) => `<p>${t}</p>`).join(""))
        .join("")}`,
    );
    const report = await atsCheck(pdf, resume);
    expect(report.ok).toBe(false);
    expect(report.checks.textLayer).toBe(false);
    expect(report.issues[0]).toContain("没有文字层");
  });

  it.runIf(process.platform === "darwin")("文字层里残留部首字符：报 charset", async () => {
    const browser = await getBrowser();
    const page = await browser.newPage();
    try {
      await page.setContent(renderHtml(resume, { template: "campus", accent: "blue" }));
      const raw = new Uint8Array(await page.pdf({ format: "A4", printBackground: true }));
      const report = await atsCheck(raw, resume);
      expect(report.checks.charset).toBe(false);
      expect(report.issues.join("\n")).toMatch(/个字被读成部首字符/);
      expect((await atsCheck(await fixPdfText(raw), resume)).checks.charset).toBe(true);
    } finally {
      await page.close();
    }
  });

  it("姓名、电话、邮箱、分区标题和条目文字对不上时逐项报出", async () => {
    const pdf = await renderPdf(resume, { template: "campus", accent: "blue" });
    const changed: ResumeContent = {
      basics: { name: "陈一鸣", contacts: ["江城", "137-5555-6666", "chenyiming@example.com"] },
      sections: resume.sections.map((s, i) =>
        i === 0
          ? {
              ...s,
              title: "工作履历",
              items: s.items.map((it, k) => (k === 0 ? { ...it, heading: "未出现的公司" } : it)),
            }
          : s,
      ),
    };
    const report = await atsCheck(pdf, changed);
    expect(report.checks).toMatchObject({
      textLayer: true,
      charset: true,
      contacts: false,
      headings: false,
      items: false,
    });
    const text = report.issues.join("\n");
    for (const part of ["姓名", "电话", "邮箱", "工作履历", "未出现的公司"]) expect(text).toContain(part);
  });
});
