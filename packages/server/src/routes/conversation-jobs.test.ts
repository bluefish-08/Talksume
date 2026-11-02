import {
  createFauxCore,
  type FauxResponseStep,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import type { Job } from "@talksume/core";
import { createDb, type DbHandle, JobRepo, migrate } from "@talksume/db";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type AppDeps, buildApp } from "../app.ts";

interface Sse {
  event: string;
  data: Record<string, unknown>;
}

function parseSse(body: string): Sse[] {
  return body
    .split("\n\n")
    .filter((chunk) => chunk.startsWith("event:"))
    .map((chunk) => {
      const [event, data] = chunk.split("\n");
      return { event: (event ?? "").slice(7), data: JSON.parse((data ?? "").slice(6)) };
    });
}

const job = (sourceJobId: string, over: Partial<Job>): Job => ({
  id: `demo:${sourceJobId}`,
  source: "demo",
  sourceJobId,
  company: "示例公司",
  title: "岗位",
  cities: ["上海"],
  jobType: "internship",
  jdText: "",
  tags: [],
  fetchedAt: new Date("2026-10-01"),
  ...over,
});

const JOBS = [
  job("1", {
    company: "星河科技",
    title: "后端开发实习生",
    jdText: "负责后端服务开发，要求熟悉 Java、MySQL、Redis。",
  }),
  job("2", {
    company: "云帆网络",
    title: "Java 后台开发实习",
    jdText: "参与后台系统开发，熟悉 Java 与 MySQL。",
  }),
  job("3", { company: "北辰数据", title: "前端开发实习生", jdText: "使用 React 开发页面。" }),
];

const toolTurn = (...calls: ReturnType<typeof fauxToolCall>[]) =>
  fauxAssistantMessage(calls, { stopReason: "toolUse" });

let handle: DbHandle;
let app: FastifyInstance;

async function boot(steps: FauxResponseStep[]) {
  const core = createFauxCore({ models: [{ id: "fake-model" }] });
  core.setResponses(steps);
  const llm: NonNullable<AppDeps["llm"]> = {
    models: [{ id: "fake-model", label: "测试模型", hint: "" }],
    resolve: () => ({ streamFn: (m, c, o) => core.streamSimple(m, c, o), model: core.getModel() }),
  };
  app = buildApp({
    edition: "cloud",
    version: "t",
    db: handle.db,
    llm,
    matching: { llm: null, embedder: null, minScore: 0 },
  });
  await app.ready();
}

async function send(id: string, content: string) {
  const res = await app.inject({
    method: "POST",
    url: `/api/v1/conversations/${id}/messages`,
    payload: { content },
  });
  return parseSse(res.body);
}

beforeEach(async () => {
  handle = await createDb({ pglite: "memory://" });
  await migrate(handle);
  await new JobRepo(handle.db).upsertMany(JOBS);
});

afterEach(async () => {
  await app?.close();
  await handle.close();
});

describe("对话里推荐和解读岗位", () => {
  it("推荐岗位推 jobs 事件并随消息落库，追问「第二个」能拿到上一轮的 jobId", async () => {
    let replayed = "";
    await boot([
      toolTurn(
        fauxToolCall("upsert_facts", {
          facts: [
            { section: "skills", payload: { name: "Java" }, quote: "我会 Java" },
            {
              section: "intention",
              payload: { roles: ["后端开发"], cities: ["上海"], jobType: "internship" },
              quote: "想找上海的后端实习",
            },
          ],
        }),
        fauxToolCall("recommend_jobs", { jobType: "internship" }),
      ),
      fauxAssistantMessage([fauxText("挑了几个上海的后端实习，星河科技最对口。")]),
      (context) => {
        replayed = JSON.stringify(context.messages);
        const result = context.messages.filter((m) => m.role === "toolResult").at(-1);
        const second = /2\. jobId=([^｜]+)/.exec(JSON.stringify(result?.content))?.[1] ?? "missing";
        return toolTurn(fauxToolCall("explain_job", { jobId: second }));
      },
      fauxAssistantMessage([fauxText("这个岗位技能对得上，投之前可以补一个后台项目。")]),
    ]);
    const created = await app.inject({ method: "POST", url: "/api/v1/conversations" });
    const id = created.json().id as string;

    const first = await send(id, "我会 Java，想找上海的后端实习，给我推荐几个");
    const jobs = first.find((e) => e.event === "jobs");
    expect(jobs?.data.source).toBe("recommend");
    const cards = jobs?.data.jobs as { id: string; company: string; score: number }[];
    expect(
      cards
        .map((c) => c.company)
        .slice(0, 2)
        .sort(),
    ).toEqual(["云帆网络", "星河科技"]);
    expect(cards.every((c) => typeof c.score === "number")).toBe(true);
    expect(first.some((e) => e.event === "error")).toBe(false);
    expect(first.at(-1)?.event).toBe("done");

    const detail = (await app.inject({ method: "GET", url: `/api/v1/conversations/${id}` })).json();
    const reply = detail.messages.at(-1);
    expect(reply.content).toContain("星河科技最对口");
    expect(reply.jobs.map((j: { id: string }) => j.id)).toEqual(cards.map((c) => c.id));

    const second = await send(id, "第二个怎么样");
    expect(replayed).toContain("recommend_jobs");
    const explained = second.find((e) => e.event === "jobs");
    expect(explained?.data.source).toBe("explain");
    const explainedCards = (explained?.data.jobs ?? []) as { id: string }[];
    expect(explainedCards[0]?.id).toBe(cards[1]?.id);
  });
});
