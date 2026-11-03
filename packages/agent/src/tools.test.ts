import { describe, expect, it } from "vitest";
import { buildUserCorpus, createIntakeTools, quoteInCorpus, type RunContext } from "./tools.ts";
import { createIntakeState } from "./types.ts";

const corpus = buildUserCorpus(["我在示例大学读计算机，2021年9月入学，预计2025年6月毕业。", "我叫李明"]);

describe("quoteInCorpus", () => {
  it("accepts a contiguous quote ignoring punctuation and spaces", () => {
    expect(quoteInCorpus(corpus, "2021年9月入学, 预计2025年6月毕业")).toBe(true);
  });

  it("accepts non-adjacent segments joined by … or ...", () => {
    expect(quoteInCorpus(corpus, "我在示例大学…2025年6月毕业")).toBe(true);
    expect(quoteInCorpus(corpus, "示例大学...2021年9月入学……预计2025年6月毕业")).toBe(true);
  });

  it("rejects when any segment is not in the corpus", () => {
    expect(quoteInCorpus(corpus, "我在示例大学…2026年6月毕业")).toBe(false);
  });

  it("does not let a too-short segment count as a hit", () => {
    expect(quoteInCorpus(corpus, "示例大学…年")).toBe(false);
    expect(quoteInCorpus(corpus, "示例大学…，月")).toBe(false);
  });

  it("rejects quotes with no content", () => {
    expect(quoteInCorpus(corpus, "……")).toBe(false);
    expect(quoteInCorpus(corpus, "，。")).toBe(false);
  });
});

function upsertWith(texts: string[]) {
  const state = createIntakeState();
  const ctx: RunContext = {
    state,
    messageId: "m1",
    userCorpus: buildUserCorpus(texts),
    verifyQuote: true,
    genId: (prefix) => `${prefix}_${Math.random().toString(36).slice(2, 8)}`,
    emit: () => {},
    flags: { asked: false, changed: false },
  };
  const tool = createIntakeTools(ctx).find((t) => t.name === "upsert_facts");
  if (!tool) throw new Error("upsert_facts missing");
  const run = async (facts: unknown[]) => {
    const result = await tool.execute("call_1", { facts } as never);
    return result.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
  };
  return { state, run };
}

describe("upsert_facts tool", () => {
  it("writes a fact whose quote stitches together non-adjacent user words", async () => {
    const { state, run } = upsertWith(["我在示例大学读本科，专业是计算机，2021年9月入学，2025年6月毕业"]);
    const text = await run([
      {
        section: "education",
        payload: {
          school: "示例大学",
          degree: "bachelor",
          major: "计算机",
          start: "2021-09",
          end: "2025-06",
        },
        quote: "我在示例大学读本科…2021年9月入学，2025年6月毕业",
      },
    ]);
    expect(text).not.toContain("被拒绝");
    expect(state.profile.education[0]).toMatchObject({ start: "2021-09", end: "2025-06" });
  });

  it("tells the model which guessed fields were dropped", async () => {
    const { state, run } = upsertWith(["Python 和 Java 用得比较多，拿过校级一等奖学金"]);
    const text = await run([
      {
        section: "skills",
        payload: { name: "Python", level: "proficient" },
        quote: "Python 和 Java 用得比较多",
      },
      {
        section: "awards",
        payload: { name: "校级一等奖学金", date: "2023-06" },
        quote: "拿过校级一等奖学金",
      },
    ]);
    expect(state.profile.skills).toEqual([expect.objectContaining({ name: "Python" })]);
    expect(state.profile.skills[0]?.level).toBeUndefined();
    expect(state.profile.awards[0]?.date).toBeUndefined();
    expect(text).toContain("第 1 条的 level");
    expect(text).toContain("第 2 条的 date");
  });
});

describe("skip_field", () => {
  it("lists the usable keys when neither the key nor the last asked slot matches", async () => {
    const state = createIntakeState();
    const ctx: RunContext = {
      state,
      messageId: "m1",
      userCorpus: buildUserCorpus(["不想说"]),
      verifyQuote: true,
      genId: (prefix) => `${prefix}_1`,
      emit: () => {},
      flags: { asked: false, changed: false },
    };
    const skipField = createIntakeTools(ctx).find((t) => t.name === "skip_field");
    const result = await skipField?.execute("c1", { key: "nope", quote: "不想说" } as never);
    const out = result?.content.map((c) => (c.type === "text" ? c.text : "")).join("") ?? "";
    expect(out).toContain("找不到 key=nope");
    expect(out).toContain("可用的 key：");
    expect(out).toContain("basics:_:name");
    expect(state.skipped).toEqual([]);
  });
});
