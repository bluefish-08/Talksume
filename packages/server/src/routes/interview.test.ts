import { type InterviewQuestion, type Job, Profile, type ResumeContent } from "@talksume/core";
import { createDb, type DbHandle, JobRepo, migrate, schema } from "@talksume/db";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.ts";
import type { StructuredLlm } from "../polish-llm.ts";

// biome-ignore lint/suspicious/noExplicitAny: 测试里的响应体不做类型约束
type Json = any;

const JOB = "demo:mt1";
const QUOTE = "我在星河科技实习时参与了订单查询接口的开发";

const profileOf = (factId: string) =>
  Profile.parse({
    basics: { name: "李明", email: "liming@example.com" },
    experiences: [
      {
        id: "x1",
        kind: "internship",
        company: "星河科技",
        title: "后端开发实习生",
        highlights: [{ title: "订单查询", detail: "主导订单查询接口开发，响应时间提升 40%" }],
        sourceFactIds: [factId],
      },
    ],
  });

const job: Job = {
  id: JOB,
  source: "demo",
  sourceJobId: JOB,
  company: "美团",
  title: "后端开发工程师",
  cities: ["上海"],
  jobType: "campus",
  jdText: "负责高并发后端服务开发，熟悉 Java、Redis。",
  tags: ["Java"],
  fetchedAt: new Date("2026-10-01"),
};

function fakeLlm() {
  const purposes: string[] = [];
  const llm: StructuredLlm = {
    completeStructured: async <T>(req: Parameters<StructuredLlm["completeStructured"]>[0]) => {
      purposes.push(req.purpose);
      const prompt = req.prompt ?? "";
      let raw: unknown;
      if (req.purpose === "interview_prep") {
        raw = prompt.includes("## 简历要点\n")
          ? {
              questions: [
                {
                  ref: "r1",
                  question: "订单查询接口里你具体做了哪部分？",
                  focus: "本人贡献",
                  approach: ["先给结论", "举 2 个例子", "我负责过支付模块"],
                  answerPoints: [
                    { text: "参与了订单查询接口的开发", quote: "参与了订单查询接口的开发" },
                    { text: "QPS 提升 50%", quote: "参与了订单查询接口的开发" },
                  ],
                  think: [],
                },
              ],
            }
          : {
              questions: [
                {
                  kind: "motivation",
                  question: "为什么选美团？",
                  focus: "动机",
                  answerPoints: [],
                  think: ["你对美团的哪块业务感兴趣"],
                },
              ],
            };
      } else if (req.purpose === "interview_turn") {
        raw = {
          intent: "answer",
          feedback: { star: null, notes: ["缺少量化结果"], consistency: "unknown" },
          comment: "好的。",
          followUp: "那你具体写了哪些接口？",
          newExperiences: [{ quote: "科协招新", summary: "校科协招新" }],
        };
      } else {
        raw = { overall: "整体不错", strengths: [], improvements: ["补上量化结果"], consistency: [] };
      }
      const value = req.validate(raw) as T;
      return { value, text: JSON.stringify(value), model: "fake" };
    },
  };
  return { llm, purposes };
}

let handle: DbHandle;
let app: FastifyInstance;
let userId: string;

beforeAll(async () => {
  handle = await createDb({ pglite: "memory://" });
  await migrate(handle);
  await new JobRepo(handle.db).upsertMany([job]);
}, 60_000);

afterAll(() => handle.close());

beforeEach(async () => {
  const [user] = await handle.db
    .insert(schema.users)
    .values({ email: `${crypto.randomUUID()}@example.com`, displayName: "李明" })
    .returning();
  userId = user?.id ?? "";
  const factId = `f-${crypto.randomUUID()}`;
  await handle.db.insert(schema.profiles).values({ userId, data: profileOf(factId) });
  await handle.db
    .insert(schema.profileFacts)
    .values({ id: factId, userId, section: "experiences", payload: {}, quote: QUOTE, status: "confirmed" });
});

afterEach(() => app?.close());

async function boot(llm: StructuredLlm | null) {
  app = buildApp({
    edition: "cloud",
    version: "t",
    db: handle.db,
    resumeLlm: llm,
    matching: { llm: null, embedder: null, reranker: null, minScore: 0 },
  });
  await app.ready();
}

async function call(method: "GET" | "POST", url: string, payload?: object) {
  const res = await app.inject({
    method,
    url,
    headers: { "x-talksume-user": userId },
    ...(payload && { payload }),
  });
  return { status: res.statusCode, body: res.json() as Json };
}

const prepUrl = `/api/v1/jobs/${encodeURIComponent(JOB)}/interview-prep`;

describe("面试准备", () => {
  it("生成题单：风险来自原话比对，编造的答题要点被丢弃", async () => {
    const { llm } = fakeLlm();
    await boot(llm);
    expect((await call("GET", prepUrl)).body.prep).toBeNull();
    const res = await call("POST", prepUrl);
    expect(res.status).toBe(200);
    const { prep } = res.body;
    expect(prep.resumeSource).toBe("current");
    const [resumeQ] = prep.questions as Json[];
    expect(resumeQ.kind).toBe("resume");
    expect(resumeQ.approach).toEqual(["先给结论"]);
    expect(resumeQ.answerPoints).toHaveLength(1);
    expect(resumeQ.risks[0].kind).toBe("stronger_than_quote");
    expect(prep.questions.at(-1).missing).toContain("你还没讲过这部分");
  });

  it("旧题单没有 approach 也能读出来，按空数组处理", async () => {
    await boot(fakeLlm().llm);
    const resume: ResumeContent = {
      basics: { name: "李明", contacts: [] },
      sections: [
        {
          kind: "experiences",
          title: "实习经历",
          items: [{ heading: "星河科技", bullets: [{ text: "做了订单接口", factIds: [] }] }],
        },
      ],
    };
    const oldQuestion = {
      id: "q1",
      kind: "motivation",
      question: "为什么选美团？",
      focus: "动机",
      source: {},
      answerPoints: [],
      missing: "你还没讲过这部分，面试前想清楚：你对哪块业务感兴趣？",
      risks: [],
    };
    await handle.db.insert(schema.interviewPreps).values({
      userId,
      jobId: JOB,
      resumeSource: "current",
      resume,
      questions: [oldQuestion] as unknown as InterviewQuestion[],
      model: "fake",
    });
    const res = await call("GET", prepUrl);
    expect(res.status).toBe(200);
    expect(res.body.prep.questions[0].approach).toEqual([]);
  });

  it("没有配置模型时不能生成；岗位不存在返回 404", async () => {
    await boot(null);
    expect((await call("POST", prepUrl)).status).toBe(503);
    const missing = await call("GET", "/api/v1/jobs/nope/interview-prep");
    expect(missing.status).toBe(404);
  });

  it("投递过的岗位用投递快照出题", async () => {
    const [version] = await handle.db
      .insert(schema.resumeVersions)
      .values({
        userId,
        profileVersion: 1,
        content: {
          basics: { name: "李明", contacts: [] },
          sections: [
            {
              kind: "projects",
              title: "项目经历",
              items: [{ heading: "投递时的项目", bullets: [{ text: "做了个爬虫", factIds: [] }] }],
            },
          ],
        },
      })
      .returning();
    await handle.db.insert(schema.applications).values({
      userId,
      jobId: JOB,
      resumeVersionId: version?.id ?? null,
      channel: "platform_api",
      status: "applied",
    });
    await boot(fakeLlm().llm);
    const res = await call("POST", prepUrl);
    expect(res.body.prep.resumeSource).toBe("application");
  });
});

describe("模拟面试", () => {
  it("没有题单不能开始；对话不改画像和事实；结束后给总结", async () => {
    const { llm } = fakeLlm();
    await boot(llm);
    const url = `/api/v1/jobs/${encodeURIComponent(JOB)}/interview-sessions`;
    expect((await call("POST", url)).status).toBe(409);
    await call("POST", prepUrl);

    const [before] = await handle.db.select().from(schema.profiles).where(eq(schema.profiles.userId, userId));
    const started = await call("POST", url);
    expect(started.status).toBe(201);
    expect(started.body.state.turns).toHaveLength(1);
    expect(started.body.state.turns[0].text).toContain("你简历上写着");

    const sid = started.body.id as string;
    const answered = await call("POST", `/api/v1/interview-sessions/${sid}/answer`, {
      text: "我参与了其中一部分，还在科协招新里带过人",
    });
    expect(answered.status).toBe(200);
    const turns = answered.body.state.turns as Json[];
    expect(turns.at(-1).asked).toBe("follow_up");
    expect(turns.find((t) => t.role === "candidate").feedback.consistency).toBe("mismatch");
    expect(turns.find((t) => t.role === "candidate").newExperiences).toEqual([
      { quote: "科协招新", summary: "校科协招新" },
    ]);

    const [after] = await handle.db.select().from(schema.profiles).where(eq(schema.profiles.userId, userId));
    expect(after?.version).toBe(before?.version);
    expect(after?.data).toEqual(before?.data);
    const facts = await handle.db
      .select()
      .from(schema.profileFacts)
      .where(eq(schema.profileFacts.userId, userId));
    expect(facts).toHaveLength(1);

    const finished = await call("POST", `/api/v1/interview-sessions/${sid}/finish`);
    expect(finished.body.state.status).toBe("finished");
    expect(finished.body.state.summary.improvements).toEqual(["补上量化结果"]);
    const again = await call("POST", `/api/v1/interview-sessions/${sid}/answer`, { text: "还有" });
    expect(again.status).toBe(409);
  });

  it("别人的会话读不到", async () => {
    await boot(fakeLlm().llm);
    await call("POST", prepUrl);
    const started = await call("POST", `/api/v1/jobs/${encodeURIComponent(JOB)}/interview-sessions`);
    const [other] = await handle.db
      .insert(schema.users)
      .values({ email: `${crypto.randomUUID()}@example.com` })
      .returning();
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/interview-sessions/${started.body.id}`,
      headers: { "x-talksume-user": other?.id ?? "" },
    });
    expect(res.statusCode).toBe(404);
  });
});
