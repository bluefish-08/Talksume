import { describe, expect, it } from "vitest";
import { explainMatch, extractJdKeywords, summarizeKeywords } from "./explain.ts";
import { makeJob, makeProfile } from "./fixtures.ts";

const JD = [
  "岗位职责：",
  "1. 负责后端服务的设计与开发",
  "2. 参与核心接口的性能优化",
  "任职要求：",
  "熟悉 Java、Spring Boot、MySQL",
  "加分项：了解 Kafka、Docker",
].join("\n");

const skills = (...names: string[]) => names.map((name, i) => ({ id: `s${i}`, name }));

describe("extractJdKeywords", () => {
  const kw = extractJdKeywords(makeJob({ title: "后端开发实习生", jdText: JD }));

  it("必备与加分技能分开", () => {
    expect(kw.required.map((s) => s.name)).toEqual(expect.arrayContaining(["Java", "Spring", "MySQL"]));
    expect(kw.bonus.map((s) => s.name)).toEqual(expect.arrayContaining(["Kafka", "Docker"]));
    expect(kw.required.map((s) => s.name)).not.toContain("Kafka");
  });

  it("每个词都有 JD 原文片段", () => {
    const flat = JD.replace(/\s+/g, " ").toLowerCase();
    for (const s of [...kw.required, ...kw.bonus]) {
      expect(flat).toContain(s.snippet.replace(/…/g, "").toLowerCase());
    }
  });

  it("职责取自职责段落原句", () => {
    expect(kw.responsibilities).toHaveLength(2);
    for (const r of kw.responsibilities) expect(JD).toContain(r);
  });

  it("识别方向词；只顺带提到一次的协作方不算", () => {
    const names = kw.concepts.map((c) => c.name);
    expect(names).toContain("后端开发");
    const mention = extractJdKeywords(makeJob({ title: "后端开发", jdText: "与前端同学协作联调" }));
    expect(mention.concepts.map((c) => c.name)).not.toContain("前端开发");
  });
});

describe("explainMatch", () => {
  const job = makeJob({ title: "后端开发实习生", jdText: JD });

  it("写了 Java后端 和 MySQL 的画像覆盖后端开发与 MySQL 要求", () => {
    const profile = makeProfile({
      skills: skills("Java", "MySQL"),
      intention: { roles: ["Java后端"], cities: ["上海"] },
    });
    const e = explainMatch(profile, job);
    expect(e.concepts.find((c) => c.name === "后端开发")?.status).toBe("have");
    expect(e.required.find((i) => i.name === "MySQL")?.status).toBe("have");
    expect(e.required.find((i) => i.name === "Spring")?.status).toBe("missing");
    expect(e.bonus.every((i) => i.status === "missing")).toBe(true);
  });

  it("JD 写数据库时，画像里的 MySQL 算覆盖并注明是相近技能", () => {
    const e = explainMatch(
      makeProfile({ skills: skills("MySQL") }),
      makeJob({ title: "后端开发", jdText: "任职要求：熟悉数据库原理" }),
    );
    const item = e.required.find((i) => i.name === "数据库");
    expect(item?.status).toBe("have");
    expect(item?.source).toContain("相近技能「MySQL」");
  });

  it("不可评估的项从权重里剔除，其余之和为 1", () => {
    const e = explainMatch(makeProfile(), makeJob({ title: "后端开发实习生", jdText: "负责相关工作。" }));
    const s = e.components.find((c) => c.key === "skills");
    expect(s?.applicable).toBe(false);
    expect(s?.weight).toBe(0);
    expect(e.components.reduce((sum, c) => sum + c.weight, 0)).toBeCloseTo(1, 2);
  });

  it("没有意向岗位时岗位名一项被剔除", () => {
    const e = explainMatch(makeProfile({ intention: { roles: [], cities: [] } }), job);
    expect(e.components.find((c) => c.key === "title")?.applicable).toBe(false);
    expect(e.score).toBeGreaterThanOrEqual(0);
    expect(e.score).toBeLessThanOrEqual(100);
  });

  it("技能覆盖越多分数越高", () => {
    const weak = explainMatch(makeProfile({ skills: skills("Photoshop") }), job);
    const strong = explainMatch(
      makeProfile({ skills: skills("Java", "Spring Boot", "MySQL", "Kafka", "Docker") }),
      job,
    );
    expect(strong.score).toBeGreaterThan(weak.score);
  });

  it("summarizeKeywords 给出已有与缺失", () => {
    const e = explainMatch(makeProfile({ skills: skills("Java") }), job);
    const s = summarizeKeywords(e);
    expect(s.have).toContain("Java");
    expect(s.missing).toContain("MySQL");
  });
});
