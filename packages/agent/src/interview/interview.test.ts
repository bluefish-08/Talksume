import type { InterviewQuestion, ResumeContent } from "@talksume/core";
import { describe, expect, it } from "vitest";
import { generateInterviewPrep, type InterviewLlm } from "./prep.ts";
import { answerTurn, planQueue, type SessionContext, startSession } from "./session.ts";

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
          techStack: ["Java", "MySQL"],
          bullets: [
            { text: "主导订单查询接口开发，响应时间提升 40%", factIds: ["f1"] },
            { text: "编写接口文档", factIds: ["f2"] },
          ],
        },
      ],
    },
  ],
};

const facts = [
  { id: "f1", quote: "我在星河科技实习的时候参与了订单查询接口的开发，用的 Java" },
  { id: "f2", quote: "我还写了接口文档" },
];

const job = {
  company: "美团",
  title: "后端开发工程师",
  jdText: "负责高并发后端服务开发，熟悉 Java、Redis。",
  tags: ["Java"],
};

function fake(respond: (purpose: string, prompt: string) => unknown) {
  const calls: { purpose: string; prompt: string }[] = [];
  const llm: InterviewLlm = {
    completeStructured: async <T>(req: Parameters<InterviewLlm["completeStructured"]>[0]) => {
      calls.push({ purpose: req.purpose, prompt: req.prompt });
      return { value: req.validate(respond(req.purpose, req.prompt)) as T, model: "fake" };
    },
  };
  return { llm, calls };
}

function prepLlm() {
  return fake((_p, prompt) => {
    if (prompt.includes("## 简历要点\n")) {
      return {
        questions: [
          {
            ref: "r1",
            question: "订单查询接口里你具体做了哪部分？有没有遇到难点？",
            focus: "本人贡献",
            approach: ["先给结论，再讲你负责的部分", "举 2 个具体例子", "用 Kafka 说明"],
            answerPoints: [
              { text: "参与了订单查询接口开发", quote: "参与了订单查询接口的开发" },
              { text: "接口响应时间提升 50%", quote: "参与了订单查询接口的开发" },
              { text: "用 Kafka 做异步", quote: "我编造的原话" },
            ],
            think: ["你写了哪几个接口"],
          },
          {
            ref: "r2",
            question: "接口文档怎么维护？",
            focus: "文档意识",
            approach: ["先讲文档怎么维护", "我负责过支付模块"],
            answerPoints: [],
            think: ["用什么工具写的"],
          },
          { ref: "r99", question: "不存在的条目？", focus: "x", approach: [], answerPoints: [], think: [] },
        ],
      };
    }
    return {
      questions: [
        {
          kind: "technical",
          question: "Redis 为什么快？",
          focus: "内存、单线程模型",
          jd: "熟悉 Java、Redis",
          approach: ["先给结论", "再分点解释原因"],
          answerPoints: [],
          think: ["你有没有用过 Redis"],
        },
        {
          kind: "technical",
          question: "编造的 JD 题？",
          focus: "x",
          jd: "要求三年 Go 经验",
          approach: [],
          answerPoints: [],
          think: [],
        },
        {
          kind: "motivation",
          question: "为什么选美团？",
          focus: "动机",
          jd: null,
          approach: [],
          answerPoints: [],
          think: [],
        },
      ],
    };
  });
}

describe("generateInterviewPrep", () => {
  it("答题要点必须有原话出处；简历风险由程序标出；没讲过的写待补充", async () => {
    const { llm } = prepLlm();
    const { questions } = await generateInterviewPrep(llm, { job, resume, facts });
    const [q1, q2, tech, motivation] = questions;
    expect(questions.map((q) => q.kind)).toEqual(["resume", "resume", "technical", "motivation"]);
    expect(q1?.question).toBe("订单查询接口里你具体做了哪部分？");
    expect(q1?.approach).toEqual(["先给结论，再讲你负责的部分"]);
    expect(q1?.answerPoints).toEqual([{ text: "参与了订单查询接口开发", quote: "参与了订单查询接口的开发" }]);
    expect(q1?.risks[0]?.kind).toBe("stronger_than_quote");
    expect(q1?.risks[0]?.note).toContain("主导");
    expect(q1?.missing).toBe("你还没讲过这部分，面试前想清楚：你写了哪几个接口");
    expect(q2?.approach).toEqual(["先讲文档怎么维护"]);
    expect(q2?.answerPoints).toEqual([]);
    expect(q2?.missing).toBe("你还没讲过这部分，面试前想清楚：用什么工具写的");
    expect(tech?.source.jd).toBe("熟悉 Java、Redis");
    expect(tech?.approach).toEqual(["先给结论", "再分点解释原因"]);
    expect(tech?.missing).toContain("你还没讲过这部分");
    expect(motivation?.missing).toBeTruthy();
  });

  it("风险条目优先出题，超出上限的普通条目被舍弃", async () => {
    const many: ResumeContent = {
      basics: resume.basics,
      sections: [
        {
          kind: "projects",
          title: "项目",
          items: [
            {
              heading: "项目甲",
              bullets: Array.from({ length: 14 }, (_, i) => ({
                text: i === 13 ? "主导重构，效率提升 30%" : `做了第 ${i} 个功能`,
                factIds: [`g${i}`],
              })),
            },
          ],
        },
      ],
    };
    const manyFacts = Array.from({ length: 14 }, (_, i) => ({
      id: `g${i}`,
      quote: i === 13 ? "我参与了重构" : `做了第 ${i} 个功能`,
    }));
    const { llm, calls } = fake((_p, prompt) =>
      prompt.includes("## 简历要点\n") ? { questions: [] } : { questions: [] },
    );
    await generateInterviewPrep(llm, { job, resume: many, facts: manyFacts });
    const resumePrompts = calls.filter((c) => c.prompt.includes("## 简历要点\n"));
    expect(resumePrompts.map((c) => c.prompt).join("")).toContain("主导重构");
    const refs = resumePrompts.flatMap((c) => c.prompt.match(/\[r\d+\] 条目/g) ?? []);
    expect(refs).toHaveLength(12);
  });
});

const questions: InterviewQuestion[] = [
  {
    id: "q1",
    kind: "resume",
    question: "订单查询接口里你具体做了哪部分？",
    focus: "本人贡献",
    approach: [],
    source: { bullet: { heading: "星河科技", text: "主导订单查询接口开发，响应时间提升 40%" } },
    answerPoints: [],
    risks: [{ kind: "stronger_than_quote", terms: ["主导"], note: "x" }],
  },
  {
    id: "q2",
    kind: "behavior",
    question: "讲一次你和同学意见不合的经历？",
    focus: "协作",
    approach: [],
    source: {},
    answerPoints: [],
    risks: [],
  },
];

const ctx = (): SessionContext => ({ job, questions, factQuotes: ["我参与了订单查询接口的开发"] });

const turnOut = (over: Record<string, unknown> = {}) => ({
  intent: "answer",
  feedback: { star: null, metrics: false, consistency: "unknown", notes: ["缺少结果"] },
  comment: "嗯，我听明白了。",
  followUp: null,
  newExperiences: [],
  ...over,
});

describe("模拟面试", () => {
  it("开场从简历条目开始，只问一题", () => {
    const state = startSession(ctx());
    expect(state.queue).toEqual(["q1", "q2"]);
    expect(state.turns).toHaveLength(1);
    expect(state.turns[0]?.text).toContain("你简历上写着：「主导订单查询接口开发");
    expect((state.turns[0]?.text.match(/[？?]/g) ?? []).length).toBe(1);
  });

  it("追问只取一个问句，最多两轮，之后换题；回答与简历对不上时给出提示", async () => {
    const { llm } = fake(() =>
      turnOut({ followUp: "你负责了哪个模块？还是只写了文档？", feedback: { star: null, notes: [] } }),
    );
    let state = startSession(ctx());
    let r = await answerTurn(llm, ctx(), state, "我参与了其中一部分，提升了 20%");
    expect(r.reply.asked).toBe("follow_up");
    expect(r.reply.question).toBe("你负责了哪个模块？");
    expect(r.state.followUps).toBe(1);
    const answered = r.state.turns.find((t) => t.role === "candidate");
    expect(answered?.feedback?.consistency).toBe("mismatch");
    expect(answered?.feedback?.mismatch.join("")).toContain("参与");

    state = r.state;
    r = await answerTurn(llm, ctx(), state, "我写了查询接口");
    expect(r.state.followUps).toBe(2);
    r = await answerTurn(llm, ctx(), r.state, "还写了单测");
    expect(r.reply.asked).toBe("question");
    expect(r.reply.questionId).toBe("q2");
    expect(r.state.followUps).toBe(0);
    expect(r.reply.text).not.toContain("你简历上写着");
  });

  it("最后一题答完结束；说要结束或被注入时不会写画像（没有任何写画像的出口）", async () => {
    const { llm } = fake(() => turnOut());
    let r = await answerTurn(llm, ctx(), startSession(ctx()), "答1");
    r = await answerTurn(llm, ctx(), r.state, "答2");
    expect(r.state.status).toBe("finished");
    expect(r.reply.asked).toBe("closing");
    await expect(answerTurn(llm, ctx(), r.state, "再答")).rejects.toThrow("已经结束");
  });

  it("新经历只有逐字出自回答、且原话里没有时才提示", async () => {
    const answer = "我还在校科协带过一次十人的招新活动";
    const { llm } = fake(() =>
      turnOut({
        newExperiences: [
          { quote: "在校科协带过一次十人的招新活动", summary: "校科协招新" },
          { quote: "他编造的原话", summary: "编造" },
          { quote: "参与了订单查询接口的开发", summary: "已有" },
        ],
      }),
    );
    const r = await answerTurn(llm, ctx(), startSession(ctx()), answer);
    const fresh = r.state.turns.find((t) => t.role === "candidate")?.newExperiences;
    expect(fresh).toEqual([{ quote: "在校科协带过一次十人的招新活动", summary: "校科协招新" }]);
  });

  it("planQueue 优先放简历里风险高的条目，其余题型各取一道", () => {
    const more: InterviewQuestion[] = [
      ...questions,
      {
        id: "q3",
        kind: "technical",
        question: "t",
        focus: "f",
        approach: [],
        source: {},
        answerPoints: [],
        risks: [],
      },
      {
        id: "q4",
        kind: "motivation",
        question: "m",
        focus: "f",
        approach: [],
        source: {},
        answerPoints: [],
        risks: [],
      },
    ];
    expect(planQueue(more)).toEqual(["q1", "q3", "q2", "q4"]);
  });
});
