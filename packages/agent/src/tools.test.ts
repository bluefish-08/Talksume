import { Profile } from "@talksume/core";
import { describe, expect, it } from "vitest";
import { OPTIONAL_BUDGET } from "./completeness.ts";
import {
  buildUserCorpus,
  createIntakeTools,
  isPleasantry,
  nextSlotOf,
  planNext,
  quoteInCorpus,
  type RunContext,
  skipDeclined,
  skipSlot,
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
  const setup = (userText: string | undefined, asked?: string) => {
    const state = createIntakeState();
    if (asked) {
      state.history.push({
        id: "a0",
        role: "assistant",
        content: "你的手机号是多少？",
        meta: { slot: asked },
      });
    }
    const ctx: RunContext = {
      state,
      messageId: "m1",
      ...(userText !== undefined ? { userText } : {}),
      userCorpus: buildUserCorpus([userText ?? "不想说"]),
      verifyQuote: true,
      genId: (prefix) => `${prefix}_1`,
      emit: () => {},
      flags: { asked: false, changed: false },
    };
    const skipField = createIntakeTools(ctx).find((t) => t.name === "skip_field");
    const run = async (args: Record<string, unknown>) => {
      const result = await skipField?.execute("c1", args as never);
      return result?.content.map((c) => (c.type === "text" ? c.text : "")).join("") ?? "";
    };
    return { state, run };
  };

  it("refuses when nothing was asked on the previous turn", async () => {
    const { state, run } = setup("不想说");
    expect(await run({ quote: "不想说" })).toContain("现在没有这样的字段");
    expect(state.skipped).toEqual([]);
  });

  it("refuses a message that declines nothing, such as chit-chat", async () => {
    const { state, run } = setup("哈哈你是真人还是 AI 啊", "basics:_:phone");
    expect(await run({ quote: "哈哈你是真人还是 AI 啊" })).toContain("没有拒答");
    expect(state.skipped).toEqual([]);
  });

  it("only skips the slot asked on the previous turn, whatever key the model passes", async () => {
    const { state, run } = setup("不想说", "basics:_:phone");
    expect(await run({ key: "basics:_:email", quote: "不想说" })).toContain("只能跳过上一轮问的那一项");
    expect(state.skipped).toEqual([]);
    expect(await run({ key: "phone", quote: "不想说" })).toContain("以后不会再问");
    expect(state.skipped.map((e) => e.key)).toEqual(["basics:_:phone"]);
  });
});

describe("planNext", () => {
  const filled = () =>
    createIntakeState({
      profile: Profile.parse({
        basics: { name: "李明", phone: "13800001111", email: "liming@example.com" },
        education: [{ id: "edu_1", school: "江城大学", degree: "bachelor", major: "软件工程" }],
        projects: [{ id: "prj_1", name: "江城闲置", role: "后端" }],
        skills: ["Java", "MySQL", "Git"].map((name, i) => ({ id: `skl_${i}`, name })),
        intention: { roles: ["后端开发"], cities: ["江城"], jobType: "campus" },
      }),
      completedSections: ["experiences", "awards"],
    });

  it("asks the next slot while there is one", () => {
    expect(planNext(filled())).toMatchObject({ kind: "ask", slot: { field: "techStack" } });
  });

  it("stops asking depth and optional slots once the budget is spent, never breadth", () => {
    const state = filled();
    const optional = [
      "basics:_:city",
      "basics:_:summary",
      "basics:_:links",
      "education:edu_1:gpa",
      "education:edu_1:courses",
      "projects:prj_1:techStack",
    ];
    expect(optional).toHaveLength(OPTIONAL_BUDGET);
    for (const key of optional) state.askCounts[key] = 1;
    expect(planNext(state)).toMatchObject({ kind: "ask", slot: { kind: "probe" } });
    for (const field of ["probe_course", "probe_selfmade", "probe_campus", "probe_work"]) {
      state.askCounts[`projects:_:${field}`] = 2;
    }
    expect(planNext(state)).toEqual({ kind: "wrap" });
    state.profile.basics.phone = "";
    expect(planNext(state)).toMatchObject({ kind: "ask", slot: { field: "phone" } });
  });

  it("is closed once a reply was marked closed, and a pending conflict holds a wrap", () => {
    const state = filled();
    for (let guard = 0; guard < 40 && nextSlotOf(state); guard++) {
      const slot = nextSlotOf(state);
      if (slot) skipSlot(state, slot, "没有");
    }
    expect(planNext(state)).toEqual({ kind: "wrap" });
    state.conflicts = [{ factId: "f1" } as never];
    expect(planNext(state)).toEqual({ kind: "hold" });
    state.conflicts = [];
    state.history.push({ id: "a1", role: "assistant", content: "收尾", meta: { closed: true } });
    expect(planNext(state)).toEqual({ kind: "closed" });
  });
});

describe("isPleasantry", () => {
  it("accepts thanks and politeness only", () => {
    for (const t of ["好的谢谢", "好的，谢谢你！", "嗯嗯", "OK", "辛苦了", "太好了，谢谢"]) {
      expect(isPleasantry(t), t).toBe(true);
    }
    for (const t of ["我还有个项目", "谢谢，不过我想改一下手机号", "好的，我还做过一个小程序", ""]) {
      expect(isPleasantry(t), t).toBe(false);
    }
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
