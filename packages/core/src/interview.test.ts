import { describe, expect, it } from "vitest";
import { answerMismatch, bulletRisks, interviewPrepMarkdown, resumeBullets } from "./interview.ts";
import type { ResumeContent } from "./resume.ts";

const resume: ResumeContent = {
  basics: { name: "李明", contacts: [] },
  sections: [
    {
      kind: "experiences",
      title: "实习经历",
      items: [
        {
          heading: "星河科技",
          subheading: "后端开发实习生",
          bullets: [
            { text: "主导订单查询接口开发，响应时间提升 40%", factIds: ["f1"] },
            { lead: "缓存", text: "用 Redis 做热点缓存", factIds: [] },
          ],
        },
      ],
    },
    {
      kind: "skills",
      title: "技能",
      items: [{ heading: "", bullets: [{ text: "Java、Redis", factIds: [] }] }],
    },
  ],
};

describe("resumeBullets", () => {
  it("只取经历、项目、校园里的要点，并按顺序编号", () => {
    const bullets = resumeBullets(resume);
    expect(bullets.map((b) => b.id)).toEqual(["r1", "r2"]);
    expect(bullets[1]?.text).toBe("缓存：用 Redis 做热点缓存");
    expect(bullets[0]?.factIds).toEqual(["f1"]);
  });
});

describe("bulletRisks", () => {
  it("简历写主导和数字、原话是参与：标出措辞强于原话", () => {
    const [risk] = bulletRisks("主导订单查询接口开发，响应时间提升 40%", ["我参与了订单查询接口的开发"]);
    expect(risk?.kind).toBe("stronger_than_quote");
    expect(risk && "terms" in risk ? risk.terms : []).toEqual(expect.arrayContaining(["主导", "40"]));
    expect(risk?.note).toContain("我参与了订单查询接口的开发");
  });

  it("原话说参与、简历写负责也算", () => {
    const [risk] = bulletRisks("负责完成数据清洗", ["我参与了数据清洗"]);
    expect(risk && "terms" in risk ? risk.terms : []).toContain("负责");
  });

  it("措辞和原话一致没有风险；没有原话出处单独提示", () => {
    expect(bulletRisks("负责订单接口开发", ["我负责订单接口开发"])).toEqual([]);
    expect(bulletRisks("做过缓存", [])[0]?.kind).toBe("no_source");
  });
});

describe("answerMismatch", () => {
  it("简历写主导回答说参与；百分比对不上", () => {
    expect(answerMismatch("主导接口开发", "我主要是参与了其中一部分")[0]).toContain("参与");
    expect(answerMismatch("响应时间提升 40%", "大概提升了 20%")[0]).toContain("40%");
  });

  it("回答和简历一致时没有提示", () => {
    expect(answerMismatch("主导接口开发，提升 40%", "我负责主要的接口开发，提升了 40%")).toEqual([]);
  });
});

describe("interviewPrepMarkdown", () => {
  it("导出风险和带原话的答题要点", () => {
    const md = interviewPrepMarkdown({
      company: "美团",
      title: "后端",
      resumeSource: "current",
      updatedAt: "2026-11-07",
      questions: [
        {
          id: "q1",
          kind: "resume",
          question: "讲讲订单接口",
          focus: "本人贡献",
          source: { bullet: { heading: "星河科技", text: "主导订单查询接口开发" } },
          answerPoints: [{ text: "参与了接口开发", quote: "我参与了接口开发" }],
          risks: [{ kind: "no_source", note: "没有出处" }],
        },
      ],
    });
    expect(md).toContain("## 简历深挖");
    expect(md).toContain("原话：「我参与了接口开发」");
    expect(md).toContain("⚠ 没有出处");
  });
});
