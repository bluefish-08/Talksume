import {
  createFauxCore,
  type FauxResponseStep,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { Profile } from "@talksume/core";
import { describe, expect, it } from "vitest";
import { computeCompleteness } from "./completeness.ts";
import { createIntakeController } from "./controller.ts";
import { clipText, polishItemLine } from "./polish-tools.ts";
import { buildSystemPrompt } from "./prompt.ts";
import { createIntakeState, type IntakeEvent, type PolishCard, type ResumePolisher } from "./types.ts";

const CARD: PolishCard = {
  kind: "generation",
  status: "draft",
  items: [
    {
      id: "p1",
      number: 1,
      heading: "云图数据",
      before: "我用 Redis 搞了个缓存，然后接口快了很多",
      after: "基于 Redis 实现热点数据缓存，接口响应从 800ms 降至 200ms",
      state: "pending",
      blocked: false,
    },
    {
      id: "p2",
      heading: "校园二手交易平台",
      before: "做了个二手交易平台",
      after: "开发校园二手交易平台，支持商品发布与检索",
      state: "pending",
      blocked: true,
      violations: ["校招"],
    },
  ],
};

interface Calls {
  polish: Parameters<ResumePolisher["polish"]>[];
  decide: Parameters<ResumePolisher["decide"]>[];
}

function fakePolisher(overrides: Partial<ResumePolisher> = {}): { polisher: ResumePolisher; calls: Calls } {
  const calls: Calls = { polish: [], decide: [] };
  const polisher: ResumePolisher = {
    async polish(profile, options) {
      calls.polish.push([profile, options]);
      return {
        card: CARD,
        lines: CARD.items.map(polishItemLine),
        polished: 1,
        headings: ["云图数据", "校园二手交易平台"],
      };
    },
    async decide(profile, options) {
      calls.decide.push([profile, options]);
      const card: PolishCard = {
        ...CARD,
        kind: "update",
        status: "adopted",
        items: CARD.items.map((item) => ({ ...item, state: "accepted" as const })),
      };
      return {
        card,
        lines: card.items.map(polishItemLine),
        polished: 0,
        blockedIds: ["p2"],
      };
    },
    ...overrides,
  };
  return { polisher, calls };
}

const toolTurn = (...calls: ReturnType<typeof fauxToolCall>[]) =>
  fauxAssistantMessage(calls, { stopReason: "toolUse" });

async function collect(gen: AsyncGenerator<IntakeEvent, void>): Promise<IntakeEvent[]> {
  const events: IntakeEvent[] = [];
  for await (const e of gen) events.push(e);
  return events;
}

function fake(steps: FauxResponseStep[], polisher?: ResumePolisher) {
  const core = createFauxCore({ models: [{ id: "fake-model" }] });
  core.setResponses(steps);
  const prompts: string[] = [];
  const controller = createIntakeController({
    streamFn: (model, context, options) => {
      prompts.push(JSON.stringify(context.messages.filter((m) => m.role === "system")));
      return core.streamSimple(model, context, options);
    },
    model: core.getModel(),
    genId: (prefix) => `${prefix}_${prompts.length}`,
    ...(polisher && { polisher }),
  });
  return { controller, prompts };
}

const state = () =>
  createIntakeState({
    profile: Profile.parse({
      basics: { name: "李明" },
      experiences: [
        {
          id: "e1",
          kind: "internship",
          company: "云图数据",
          title: "后端开发实习生",
          highlights: [{ title: "缓存", detail: "我用 Redis 搞了个缓存，然后接口快了很多" }],
          techStack: [],
        },
      ],
    }),
  });

describe("润色工具", () => {
  it("polish_resume 发出 generation 卡片，行格式带编号和 id", async () => {
    const { polisher, calls } = fakePolisher();
    const { controller } = fake(
      [
        toolTurn(fauxToolCall("polish_resume", { items: ["云图数据"], instruction: "更专业" })),
        fauxAssistantMessage([fauxText("已经生成润色建议，你先看看。")]),
      ],
      polisher,
    );
    const s = state();
    const events = await collect(controller.handleUserMessage(s, { id: "m1", text: "帮我润色云图数据" }));
    const event = events.find((e) => e.type === "polish");
    expect(event).toMatchObject({ type: "polish", polish: { kind: "generation", status: "draft" } });
    expect(calls.polish[0]?.[1]).toMatchObject({ items: ["云图数据"], instruction: "更专业" });
    const reply = events.flatMap((e) => (e.type === "token" ? [e.text] : [])).join("");
    expect(reply).not.toContain("[p1]");
    const result = s.history.at(-1)?.meta?.tools?.[0]?.result ?? "";
    expect(result).toContain("改动列在对话里的润色卡片上");
    expect(result).toContain("「在右边看」");
    expect(result).not.toContain("右侧卡片");
  });

  it("全部原样返回时不发卡片，提示没有需要改的", async () => {
    const { polisher } = fakePolisher({
      async polish() {
        return {
          card: { status: "draft", items: [] },
          lines: [],
          polished: 0,
          noopItems: [
            { heading: "云图数据", before: "用 Redis 缓存热点数据" },
            { heading: "云图数据", before: "接口响应从 800ms 降到 200ms" },
          ],
        };
      },
    });
    const { controller } = fake(
      [
        toolTurn(fauxToolCall("polish_resume", { items: ["云图数据"] })),
        fauxAssistantMessage([fauxText("这两条已经够清楚了。")]),
      ],
      polisher,
    );
    const s = state();
    const events = await collect(controller.handleUserMessage(s, { id: "m1", text: "润色云图数据" }));
    expect(events.some((e) => e.type === "polish")).toBe(false);
    const result = s.history.at(-1)?.meta?.tools?.[0]?.result ?? "";
    expect(result).toContain("这 2 条原本就写得够清楚，没改：");
    expect(result).toContain("云图数据「用 Redis 缓存热点");
    expect(result).toContain("没有需要改动的地方");
  });

  it("工具结果用紧凑行格式，编号稳定", () => {
    const [first, second] = CARD.items;
    if (!first || !second) throw new Error("缺少测试数据");
    expect(polishItemLine(first)).toBe(
      `- 1. 云图数据：「${clipText(first.before, 12)}」→「${clipText(first.after, 20)}」 [p1]：待定`,
    );
    expect(polishItemLine(first)).toContain("「我用 Redis 搞了个");
    expect(polishItemLine(second)).toBe("- 校园二手交易平台 [p2]：不能用（没改：校招 你没说过）");
    expect(clipText("一二三四五六七八九十一二三", 12)).toBe("一二三四五六七八九十一二…");
  });

  it("点名的条目找不到时列出可用标题，不编造卡片", async () => {
    const { polisher } = fakePolisher({
      async polish() {
        return {
          card: { status: "draft", items: [] },
          lines: [],
          polished: 0,
          unknownItems: ["不存在公司"],
          headings: ["云图数据", "校园二手交易平台"],
        };
      },
    });
    const { controller } = fake(
      [
        toolTurn(fauxToolCall("polish_resume", { items: ["不存在公司"] })),
        fauxAssistantMessage([fauxText("没找到这一段。")]),
      ],
      polisher,
    );
    const s = state();
    const events = await collect(controller.handleUserMessage(s, { id: "m1", text: "润色不存在公司" }));
    expect(events.some((e) => e.type === "polish")).toBe(false);
    expect(s.history.at(-1)?.meta?.tools?.[0]?.result).toContain("找不到这些条目：不存在公司");
    expect(s.history.at(-1)?.meta?.tools?.[0]?.result).toContain("云图数据、校园二手交易平台");
  });

  it("decide_polish 原样传递 all，并在结果里说明被拦下的建议", async () => {
    const { polisher, calls } = fakePolisher();
    const { controller } = fake(
      [
        toolTurn(fauxToolCall("decide_polish", { all: "accept" })),
        fauxAssistantMessage([fauxText("能用的都采用了。")]),
      ],
      polisher,
    );
    const s = state();
    const events = await collect(controller.handleUserMessage(s, { id: "m1", text: "都用上" }));
    expect(calls.decide[0]?.[1]).toEqual({ all: "accept" });
    const polish = events.find((e) => e.type === "polish");
    expect(polish).toMatchObject({ polish: { kind: "update" } });
    expect(s.history.at(-1)?.meta?.tools?.[0]?.result).toContain("不能采用");
  });

  it("润色轮不追加建档追问和快捷回复", async () => {
    const { polisher } = fakePolisher();
    const { controller } = fake(
      [
        toolTurn(
          fauxToolCall("polish_resume", { items: ["云图数据"] }),
          fauxToolCall("ask_user", {
            question: "你还有别的项目吗？",
            quickReplies: ["有", "没有"],
          }),
        ),
        fauxAssistantMessage([fauxText("润色建议已经放在卡片里了。")]),
      ],
      polisher,
    );
    const s = state();
    const events = await collect(controller.handleUserMessage(s, { id: "m1", text: "润色云图数据" }));
    expect(events.some((e) => e.type === "ask")).toBe(false);
    const reply = s.history.at(-1);
    expect(reply?.meta?.quickReplies).toBeUndefined();
    expect(reply?.content).not.toContain("还有别的项目");
  });

  it("提示词只在开放润色工具时包含润色规则", () => {
    const base = {
      profile: state().profile,
      completeness: computeCompleteness(state().profile),
      slot: null,
      completedSections: [],
      conflicts: [],
    };
    expect(buildSystemPrompt(base)).not.toContain("## 简历润色");
    const on = buildSystemPrompt({ ...base, polishTool: true });
    expect(on).toContain("## 简历润色");
    expect(on).toContain("polish_resume");
    expect(on).toContain("decide_polish");
  });
});
