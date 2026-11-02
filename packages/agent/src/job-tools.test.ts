import {
  createFauxCore,
  type FauxResponseStep,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import type { Profile } from "@talksume/core";
import { describe, expect, it } from "vitest";
import { computeCompleteness } from "./completeness.ts";
import { createIntakeController } from "./controller.ts";
import { buildSystemPrompt } from "./prompt.ts";
import { createIntakeState, type IntakeEvent, type JobCard, type JobTools } from "./types.ts";

const JOBS: JobCard[] = [
  {
    id: "demo:1",
    title: "后端开发实习生",
    company: "星河科技",
    cities: ["上海"],
    jobType: "internship",
    score: 82,
  },
  {
    id: "demo:2",
    title: "Java 后台开发实习",
    company: "云帆网络",
    cities: ["杭州"],
    jobType: "internship",
    score: 71,
  },
  {
    id: "demo:3",
    title: "服务端研发实习",
    company: "北辰数据",
    cities: ["北京"],
    jobType: "internship",
    score: 64,
  },
];

interface Calls {
  recommend: Parameters<JobTools["recommend"]>[];
  search: Parameters<JobTools["search"]>[];
  explain: Parameters<JobTools["explain"]>[];
}

function fakeJobs(overrides: Partial<JobTools> = {}): { jobs: JobTools; calls: Calls } {
  const calls: Calls = { recommend: [], search: [], explain: [] };
  const jobs: JobTools = {
    async recommend(profile, query) {
      calls.recommend.push([profile, query]);
      return { jobs: JOBS.slice(0, query.limit), total: JOBS.length };
    },
    async search(profile, query) {
      calls.search.push([profile, query]);
      return { jobs: JOBS.filter((j) => j.company.includes(query.company ?? "")).slice(0, 1), total: 1 };
    },
    async explain(profile, jobId) {
      calls.explain.push([profile, jobId]);
      const job = JOBS.find((j) => j.id === jobId);
      if (!job) return null;
      return {
        job,
        summary: "技能对口，缺少分布式项目经历",
        strengths: ["熟悉 Java 和 MySQL"],
        gaps: ["没有高并发项目"],
        dims: [{ label: "技能匹配", score: 80, evidence: ["技能命中 Java"] }],
      };
    },
    ...overrides,
  };
  return { jobs, calls };
}

let n = 0;
const genId = (prefix: string) => `${prefix}_${++n}`;

function fake(steps: FauxResponseStep[], jobs?: JobTools, prompts: string[] = []) {
  const core = createFauxCore({ models: [{ id: "fake-model" }] });
  core.setResponses(steps);
  const controller = createIntakeController({
    streamFn: (model, context, options) => {
      prompts.push(JSON.stringify(context.messages.filter((m) => m.role === "system")));
      return core.streamSimple(model, context, options);
    },
    model: core.getModel(),
    genId,
    ...(jobs && { jobs }),
  });
  return { controller };
}

async function collect(gen: AsyncGenerator<IntakeEvent, void>): Promise<IntakeEvent[]> {
  const events: IntakeEvent[] = [];
  for await (const e of gen) events.push(e);
  return events;
}

const toolTurn = (...calls: ReturnType<typeof fauxToolCall>[]) =>
  fauxAssistantMessage(calls, { stopReason: "toolUse" });
const jobEvents = (events: IntakeEvent[]) => events.flatMap((e) => (e.type === "jobs" ? [e] : []));

describe("岗位工具", () => {
  it("用户要推荐时调用 recommend_jobs，发出 jobs 事件，不再强行追问建档", async () => {
    const { jobs, calls } = fakeJobs();
    const { controller } = fake(
      [
        toolTurn(fauxToolCall("recommend_jobs", { jobType: "internship", keyword: "后端", limit: 10 })),
        fauxAssistantMessage([fauxText("给你挑了几个后端实习，第一个星河科技最对口。")]),
      ],
      jobs,
    );
    const state = createIntakeState();
    const events = await collect(
      controller.handleUserMessage(state, { id: "u1", text: "给我推荐几个后端实习" }),
    );

    expect(calls.recommend).toHaveLength(1);
    expect(calls.recommend[0]?.[1]).toEqual({ jobType: "internship", keyword: "后端", limit: 5 });
    const [cards] = jobEvents(events);
    expect(cards).toMatchObject({ source: "recommend" });
    expect(cards?.jobs.map((j) => j.id)).toEqual(["demo:1", "demo:2", "demo:3"]);
    expect(events.some((e) => e.type === "ask")).toBe(false);
    expect(events.some((e) => e.type === "error")).toBe(false);

    const reply = state.history.at(-1);
    expect(reply?.content).toBe("给你挑了几个后端实习，第一个星河科技最对口。");
    expect(reply?.meta?.jobs).toHaveLength(3);
    expect(reply?.meta?.tools?.[0]).toMatchObject({ name: "recommend_jobs" });
    expect(reply?.meta?.tools?.[0]?.result).toContain("jobId=demo:2");
    expect(reply?.meta?.tools?.[0]?.result).toContain("画像里还没有求职意向和技能");
  });

  it("追问「第二个」时，上一轮的工具结果在上下文里，可据此调用 explain_job", async () => {
    const { jobs, calls } = fakeJobs();
    let seen = "";
    const { controller } = fake(
      [
        toolTurn(fauxToolCall("recommend_jobs", {})),
        fauxAssistantMessage([fauxText("推荐了三个岗位。")]),
        (context) => {
          seen = JSON.stringify(context.messages);
          const results = context.messages.filter((m) => m.role === "toolResult");
          const text = JSON.stringify(results.at(-1)?.content ?? "");
          const second = /2\. jobId=([^｜]+)/.exec(text)?.[1] ?? "missing";
          return toolTurn(fauxToolCall("explain_job", { jobId: second }));
        },
        fauxAssistantMessage([fauxText("云帆网络这个技能挺对口，差在高并发项目。")]),
      ],
      jobs,
    );
    const state = createIntakeState();
    await collect(controller.handleUserMessage(state, { id: "u1", text: "推荐几个岗位" }));
    const events = await collect(controller.handleUserMessage(state, { id: "u2", text: "第二个怎么样" }));

    expect(seen).toContain("recommend_jobs");
    expect(calls.explain.map(([, id]) => id)).toEqual(["demo:2"]);
    const [card] = jobEvents(events);
    expect(card).toMatchObject({ source: "explain" });
    expect(card?.jobs[0]).toMatchObject({ id: "demo:2", reason: "技能对口，缺少分布式项目经历" });
    expect(state.history.at(-1)?.meta?.tools?.[0]?.result).toContain("没有高并发项目");
  });

  it("问具体公司时用 search_jobs，画像会传给岗位服务", async () => {
    const { jobs, calls } = fakeJobs();
    const { controller } = fake(
      [
        toolTurn(fauxToolCall("search_jobs", { query: "后台开发", company: "云帆" })),
        fauxAssistantMessage([fauxText("搜到了云帆网络的后台开发实习。")]),
      ],
      jobs,
    );
    const state = createIntakeState();
    state.profile.skills.push({ id: "s1", name: "Java" } as Profile["skills"][number]);
    const events = await collect(controller.handleUserMessage(state, { id: "u1", text: "云帆的后台开发呢" }));
    expect(calls.search[0]?.[1]).toEqual({ query: "后台开发", company: "云帆", limit: 3 });
    expect(calls.search[0]?.[0].skills[0]?.name).toBe("Java");
    expect(jobEvents(events)[0]?.jobs.map((j) => j.id)).toEqual(["demo:2"]);
  });

  it("岗位服务出错时如实返回给模型，不当作写入失败触发兜底追问", async () => {
    const { jobs } = fakeJobs({
      recommend: async () => {
        throw new Error("数据库连接超时");
      },
    });
    let toolResult = "";
    const { controller } = fake(
      [
        toolTurn(fauxToolCall("recommend_jobs", {})),
        (context) => {
          toolResult = JSON.stringify(context.messages.at(-1));
          return fauxAssistantMessage([fauxText("岗位暂时查不到，稍后再试试。")]);
        },
      ],
      jobs,
    );
    const events = await collect(
      controller.handleUserMessage(createIntakeState(), { id: "u1", text: "推荐几个岗位" }),
    );
    expect(toolResult).toContain("岗位服务出错：数据库连接超时");
    expect(events.some((e) => e.type === "error" || e.type === "ask")).toBe(false);
    expect(jobEvents(events)).toHaveLength(0);
  });

  it("没注入岗位能力时不注册岗位工具", async () => {
    const prompts: string[] = [];
    const { controller } = fake(
      [fauxAssistantMessage([fauxText("可以去职位推荐页看看。你叫什么？")])],
      undefined,
      prompts,
    );
    await collect(controller.handleUserMessage(createIntakeState(), { id: "u1", text: "推荐岗位" }));
    expect(prompts[0]).toContain("upsert_facts");
    expect(prompts[0]).not.toContain("recommend_jobs");
    expect(prompts[0]).toContain("职位推荐");
    expect(prompts[0]).not.toContain("## 岗位问题");
  });
});

describe("岗位相关的系统提示", () => {
  const input = (jobTools: boolean) => {
    const state = createIntakeState();
    return {
      profile: state.profile,
      completeness: computeCompleteness(state.profile),
      slot: null,
      completedSections: [],
      conflicts: [],
      jobTools,
    };
  };

  it("开放岗位工具后要求先查再答，投递留给用户确认", () => {
    const prompt = buildSystemPrompt(input(true));
    expect(prompt).toContain("## 岗位问题");
    expect(prompt).toContain("不要推说「等画像补完再推荐」");
    expect(prompt).toContain("recommend_jobs");
    expect(prompt).toContain("去投递");
    expect(prompt).not.toContain("比如生成简历、改写措辞、重点突出某条、投递");
  });
});
