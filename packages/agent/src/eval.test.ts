import { readFileSync } from "node:fs";
import { createFauxCore, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { Profile } from "@talksume/core";
import { describe, expect, it } from "vitest";
import { type ExpectedProfile, parseDataset } from "../eval/dataset.ts";
import { scoreProfile, summarize, summarizeBySection } from "../eval/metrics.ts";
import { renderReport } from "../eval/report.ts";
import { EvalAbortError, runSample } from "../eval/runner.ts";
import { createIntakeController } from "./controller.ts";

const samples = parseDataset(readFileSync(new URL("../eval/samples.jsonl", import.meta.url), "utf8"));

/** 把期望值还原成一份「完美预测」的画像，用来验证样例本身格式正确且自洽。 */
function oracleProfile(expected: ExpectedProfile): Profile {
  const text = (v: unknown): unknown =>
    typeof v === "object" && v !== null && !Array.isArray(v) && "$contains" in v
      ? (v as { $contains: string[] }).$contains.join(" ")
      : v;
  const fill = (rec: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, Array.isArray(v) ? v : text(v)]));
  const list = (items: Record<string, unknown>[] | undefined, extra: Record<string, unknown> = {}) =>
    (items ?? []).map((item, i) => {
      const filled = fill(item);
      if (typeof filled.bullets === "string") filled.bullets = [filled.bullets];
      return { id: `x${i}`, sourceFactIds: [], ...extra, ...filled };
    });
  return Profile.parse({
    basics: fill((expected.basics ?? {}) as Record<string, unknown>),
    education: list(expected.education as Record<string, unknown>[] | undefined),
    experiences: list(expected.experiences as Record<string, unknown>[] | undefined),
    projects: list(expected.projects as Record<string, unknown>[] | undefined),
    skills: list(expected.skills as Record<string, unknown>[] | undefined),
    awards: list(expected.awards as Record<string, unknown>[] | undefined),
    intention: fill((expected.intention ?? {}) as Record<string, unknown>),
  });
}

describe("eval dataset", () => {
  it("ships three well-formed sample dialogues", () => {
    expect(samples.map((s) => s.id)).toEqual(["campus-backend", "experienced-architect", "intern-analyst"]);
    for (const s of samples) expect(s.turns.length).toBeGreaterThanOrEqual(5);
  });

  it("scores a perfect prediction at F1 = 1 for every sample", () => {
    for (const s of samples) {
      const units = scoreProfile(oracleProfile(s.expected), s.expected);
      expect(units.length).toBeGreaterThan(10);
      expect(
        units.filter((u) => u.status !== "tp"),
        s.id,
      ).toEqual([]);
      expect(summarize(units).f1).toBe(1);
    }
  });

  it("rejects malformed lines with the line number", () => {
    expect(() => parseDataset('{"id":"x","description":"d","turns":[],"expected":{}}')).toThrow(/第 1 行/);
  });
});

describe("field-level metrics", () => {
  const expected: ExpectedProfile = {
    basics: { name: "陈思远", city: "杭州" },
    projects: [
      { name: "二手交易小程序", techStack: ["Vue", "Node.js"], result: { $contains: ["2000", "120"] } },
    ],
    intention: { cities: ["杭州", "上海"], jobType: "campus" },
  };

  it("counts wrong values as both a false positive and a false negative", () => {
    const predicted = Profile.parse({ basics: { name: "陈思远", city: "上海" } });
    const m = summarize(scoreProfile(predicted, expected));
    const basics = summarizeBySection(scoreProfile(predicted, expected)).basics;
    expect(basics).toMatchObject({ tp: 1, fp: 1, fn: 1 });
    expect(m.recall).toBeLessThan(1);
  });

  it("counts extra fields as false positives and missing ones as false negatives", () => {
    const predicted = Profile.parse({
      basics: { name: "陈思远", city: "杭州", phone: "13900002222" },
      intention: { cities: ["杭州"], roles: [], jobType: "campus" },
    });
    const bySection = summarizeBySection(scoreProfile(predicted, expected));
    expect(bySection.basics).toMatchObject({ tp: 2, fp: 1, fn: 0 });
    expect(bySection.intention).toMatchObject({ tp: 2, fp: 0, fn: 1 });
    expect(bySection.projects).toMatchObject({ tp: 0, fp: 0 });
    expect(bySection.projects?.fn).toBe(4);
  });

  it("aligns items by name tolerantly and checks keywords and list elements", () => {
    const predicted = Profile.parse({
      projects: [
        {
          id: "p1",
          sourceFactIds: [],
          name: "校园二手交易小程序",
          techStack: ["vue", "nodejs", "Redis"],
          result: "上线三个月 2000 多用户，响应时间降到 120ms",
        },
      ],
    });
    const projects = summarizeBySection(scoreProfile(predicted, expected)).projects;
    expect(projects).toMatchObject({ tp: 4, fp: 1, fn: 0 });
  });

  it("treats a predicted item that matches nothing as all false positives", () => {
    const predicted = Profile.parse({
      skills: [{ id: "s", sourceFactIds: [], name: "Go" }],
    });
    const skills = summarizeBySection(scoreProfile(predicted, { skills: [{ name: "Java" }] })).skills;
    expect(skills).toMatchObject({ tp: 0, fp: 1, fn: 1 });
  });
});

describe("eval runner", () => {
  const sample = samples[0];
  if (!sample) throw new Error("no sample");

  it("runs a scripted conversation end to end and renders a markdown report", async () => {
    const core = createFauxCore({ models: [{ id: "fake" }] });
    core.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall("upsert_facts", {
            facts: [
              { section: "basics", payload: { name: "陈思远" }, quote: "我叫陈思远" },
              {
                section: "education",
                payload: { school: "浙江大学", degree: "bachelor", major: "计算机科学与技术" },
                quote: "浙江大学读计算机科学与技术专业的本科",
              },
            ],
          }),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage([fauxToolCall("ask_user", { question: "方便留个手机号吗？" })], {
        stopReason: "toolUse",
      }),
      ...Array.from({ length: 10 }, () => fauxAssistantMessage("好的")),
    ]);
    const controller = createIntakeController({ streamFn: core.streamSimple, model: core.getModel() });
    const short = { ...sample, turns: sample.turns.slice(0, 1) };
    const run = await runSample(short, controller);
    expect(run.profile.basics.name).toBe("陈思远");
    expect(run.asks).toBeGreaterThanOrEqual(1);
    expect(run.metrics.tp).toBeGreaterThanOrEqual(4);
    expect(run.metrics.recall).toBeLessThan(1);

    const report = renderReport([run], {
      model: "fake",
      fallbackModel: "fake2",
      dataset: "x.jsonl",
      startedAt: new Date("2026-11-02T00:00:00Z"),
      llmCalls: 3,
      llmFailures: 0,
      totalTokens: 100,
    });
    expect(report).toContain("# 对话信息抽取评测报告");
    expect(report).toContain("| 全部 |");
    expect(report).toContain("campus-backend");
    expect(report).toContain("漏报");
  });

  it("aborts with a recognizable error when the model reports an unrecoverable failure", async () => {
    const core = createFauxCore({ models: [{ id: "x" }] });
    core.setResponses([
      fauxAssistantMessage([], {
        stopReason: "error",
        errorMessage: "[llm:quota_exhausted] budget exceeded",
      }),
    ]);
    const controller = createIntakeController({ streamFn: core.streamSimple, model: core.getModel() });
    await expect(runSample(sample, controller)).rejects.toBeInstanceOf(EvalAbortError);
  });
});
