import { describe, expect, it } from "vitest";
import {
  buildUserCorpus,
  createIntakeTools,
  quoteInCorpus,
  type RunContext,
  skipDeclined,
  unconfirmedValues,
} from "./tools.ts";
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

function upsertWith(texts: string[], spoken = "") {
  const state = createIntakeState();
  const ctx: RunContext = {
    state,
    messageId: "m1",
    userCorpus: buildUserCorpus(texts),
    verifyQuote: true,
    genId: (prefix) => `${prefix}_${Math.random().toString(36).slice(2, 8)}`,
    emit: () => {},
    flags: { asked: false, changed: false },
    spoken: () => spoken,
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

  it("gives no next target once the reply already asked something", async () => {
    const said = "好的，记下了。期望薪资想写在简历上吗？";
    const { run } = upsertWith(["想找江城的 Java 开发校招岗位"], said);
    const fact = {
      section: "intention",
      payload: { cities: ["江城"] },
      quote: "想找江城的 Java 开发校招岗位",
    };
    const text = await run([fact]);
    expect(text).not.toContain("下一个目标");
    expect(text).toContain("不要换个说法再问");
    const plain = await upsertWith(["想找江城的 Java 开发校招岗位"]).run([fact]);
    expect(plain).toContain("下一个目标");
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

describe("confirming a proposal", () => {
  const question = "课上学 Java、MySQL 的时候，有没有做过课程设计或者大作业？";

  it("only lets a bare yes confirm what the question proposed or the user said", () => {
    const corpus = buildUserCorpus(["我学过 Java 和 MySQL", "做过"]);
    expect(unconfirmedValues({ name: "MySQL" }, "做过", corpus, question)).toEqual([]);
    expect(unconfirmedValues({ name: "Java 课程设计" }, "做过", corpus, question)).toEqual([]);
    expect(
      unconfirmedValues(
        { name: "Java 课程设计", role: "组长", techStack: ["Redis"] },
        "做过",
        corpus,
        question,
      ),
    ).toEqual(["组长", "Redis"]);
  });

  it("leaves facts quoted from the user's own words alone", () => {
    const corpus = buildUserCorpus(["做过课程设计，学生成绩管理系统，我是组长"]);
    expect(
      unconfirmedValues({ name: "学生成绩管理系统", role: "组长" }, "我是组长", corpus, question),
    ).toEqual([]);
  });

  it("rejects an upsert that slips unasked details in behind a yes", async () => {
    const { state, run } = upsertWith(["我学过 Java 和 MySQL", "用过"]);
    state.history.push({ id: "a1", role: "assistant", content: "课上用过 MySQL 吗？" });
    const text = await run([
      { section: "skills", payload: { name: "MySQL" }, quote: "用过" },
      { section: "skills", payload: { name: "Redis" }, quote: "用过" },
    ]);
    expect(state.profile.skills.map((s) => s.name)).toEqual(["MySQL"]);
    expect(text).toContain("「Redis」用户没说过");
  });
});

describe("probing for experience", () => {
  it("marks the probe answered when it turns up a new experience", async () => {
    const { state, run } = upsertWith(["做过课程设计，学生成绩管理系统"]);
    state.history.push({
      id: "a1",
      role: "assistant",
      content: "课程设计做过吗？",
      meta: { slot: "projects:_:probe_course" },
    });
    await run([{ section: "projects", payload: { name: "学生成绩管理系统" }, quote: "学生成绩管理系统" }]);
    expect(state.askCounts["projects:_:probe_course"]).toBeGreaterThanOrEqual(2);
  });

  it("records a short no to a probe as skipped", () => {
    const state = createIntakeState();
    state.history.push({
      id: "a1",
      role: "assistant",
      content: "参加过比赛、社团吗？",
      meta: { slot: "projects:_:probe_campus" },
    });
    expect(skipDeclined(state, "都没参加过")?.key).toBe("projects:_:probe_campus");
    expect(skipDeclined(state, "参加过计算机协会，组织过义诊")).toBeNull();
  });
});
