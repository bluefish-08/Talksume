import { describe, expect, it } from "vitest";
import {
  answerMismatch,
  approachProblems,
  bulletRisks,
  type InterviewQuestion,
  interviewPrepMarkdown,
  resumeBullets,
} from "./interview.ts";
import type { ResumeContent } from "./resume.ts";

const material =
  "美团 后端开发工程师 负责高并发后端服务开发，熟悉 Java、Redis。星河科技 后端开发实习生 主导订单查询接口开发，响应时间提升 40%。我参与了订单查询接口的开发，用的是 Java 和 MySQL。";

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

describe("approachProblems", () => {
  it("通用方法和岗位里已有的词放行", () => {
    expect(approachProblems("先给结论，再讲原因", material)).toEqual([]);
    expect(approachProblems("落到这个岗位，用 JD 里的 Java 举例", material)).toEqual([]);
    expect(approachProblems("用 STAR 讲情境、任务、行动、结果", material)).toEqual([]);
    expect(approachProblems("用 Redis 举例", material)).toEqual([]);
    expect(approachProblems("先了解公司业务，再讲原因", material)).toEqual([]);
  });

  it("有数字、没提过的技术词或机构、第一人称说法时拦下", () => {
    expect(approachProblems("举 2 个具体例子", material)).toContain("2");
    expect(approachProblems("把耗时提升 40%", material)).toContain("40%");
    expect(approachProblems("用 Kafka 做异步", material)).toContain("Kafka");
    expect(approachProblems("讲讲在字节跳动公司的实习", material)).toContain("字节跳动");
    expect(approachProblems("讲讲在海星公司的实习", material)).toContain("海星公司");
    expect(approachProblems("我负责过支付模块", material)).toContain("我负责");
  });
});

const markdownQuestion: InterviewQuestion = {
  id: "q1",
  kind: "resume",
  question: "讲讲订单接口",
  focus: "本人贡献",
  approach: ["先给结论", "再讲原因"],
  source: { bullet: { heading: "星河科技", text: "主导订单查询接口开发" } },
  answerPoints: [{ text: "参与了接口开发", quote: "我参与了接口开发" }],
  missing: "你还没讲过这部分，面试前想清楚：你具体写了哪几个接口？",
  risks: [
    {
      kind: "stronger_than_quote",
      terms: ["主导"],
      note: "简历写了「主导」，你原话里没有这个说法（你原话是「我参与了接口开发」）。",
    },
    { kind: "no_source", note: "没有出处" },
  ],
};

describe("interviewPrepMarkdown", () => {
  it("按怎么答、你能用的、面试前要想好三块导出", () => {
    const md = interviewPrepMarkdown({
      company: "美团",
      title: "后端",
      resumeSource: "current",
      updatedAt: "2026-11-07",
      questions: [markdownQuestion],
    });
    expect(md).toContain("## 简历深挖");
    expect(md).toContain("#### 怎么答\n\n1. 先给结论\n2. 再讲原因");
    expect(md).toContain("#### 你能用的\n\n- 参与了接口开发");
    expect(md).toContain("#### 面试前要想好\n\n> 你还没讲过这部分");
    expect(md).not.toContain("原话：「我参与了接口开发」");
    expect(md).toContain("你原话是「我参与了接口开发」");
    expect(md).toContain("⚠ 没有出处");
  });

  it("旧题单没有 approach 也能导出", () => {
    const legacy = { ...markdownQuestion, approach: undefined } as unknown as InterviewQuestion;
    const md = interviewPrepMarkdown({
      company: "美团",
      title: "后端",
      resumeSource: "current",
      updatedAt: "2026-11-07",
      questions: [legacy],
    });
    expect(md).not.toContain("#### 怎么答");
    expect(md).toContain("#### 你能用的");
  });
});
