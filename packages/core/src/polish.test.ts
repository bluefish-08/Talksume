import { describe, expect, it } from "vitest";
import { applyPolish, polishItemKey, polishSourceHash, polishTargets, ungroundedTokens } from "./polish.ts";
import { Profile } from "./profile.ts";
import { profileToResume } from "./profile-to-resume.ts";

const profile = Profile.parse({
  basics: { name: "李明" },
  education: [{ id: "e1", school: "江城大学", degree: "bachelor", gpa: "3.6", sourceFactIds: ["f0"] }],
  projects: [
    {
      id: "p1",
      name: "江城闲置",
      role: "后端负责人",
      techStack: ["Spring Boot", "Redis"],
      situation: "校内二手交易都在群里，很乱",
      action: "我用 Redis 做了个缓存，然后搞了个搜索",
      result: "上线后有三百多人用，接口快了 40%",
      sourceFactIds: ["f1", "f2"],
    },
  ],
  awards: [
    { id: "a1", name: "校程序设计竞赛二等奖", description: "带两个同学一起拿的", sourceFactIds: ["f3"] },
  ],
});

describe("polishTargets", () => {
  it("只取项目、经历、获奖的要点，带上 factIds 和哈希", () => {
    const targets = polishTargets(profileToResume(profile));
    expect(targets.map((t) => t.sectionKind)).toEqual(["projects", "projects", "projects", "awards"]);
    const action = targets[1];
    expect(action).toMatchObject({
      itemKey: polishItemKey("projects", "江城闲置"),
      slot: 1,
      subheading: "后端负责人 · Spring Boot / Redis",
      factIds: ["f1", "f2"],
    });
    expect(action?.sourceHash).toBe(polishSourceHash(action?.text ?? ""));
  });
});

describe("polishSourceHash", () => {
  it("稳定、对首尾空白不敏感、内容一变就变", () => {
    expect(polishSourceHash("做了缓存")).toBe(polishSourceHash("  做了缓存 "));
    expect(polishSourceHash("做了缓存")).not.toBe(polishSourceHash("做了缓存和搜索"));
    expect(polishSourceHash("x")).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("applyPolish", () => {
  const resume = profileToResume(profile);
  const [, action] = polishTargets(resume);
  if (!action) throw new Error("fixture");

  it("命中的要点换成润色文字，factIds 不变，其他要点和教育背景不动", () => {
    const next = applyPolish(resume, [
      { itemKey: action.itemKey, sourceHash: action.sourceHash, text: "引入 Redis 缓存并实现搜索功能" },
    ]);
    const project = next.sections.find((s) => s.kind === "projects")?.items[0];
    expect(project?.bullets[1]).toEqual({ text: "引入 Redis 缓存并实现搜索功能", factIds: ["f1", "f2"] });
    expect(project?.bullets[0]).toEqual(
      resume.sections.find((s) => s.kind === "projects")?.items[0]?.bullets[0],
    );
    expect(next.sections[0]).toEqual(resume.sections[0]);
  });

  it("原文变了就失效，回退原文", () => {
    const changed = Profile.parse({
      ...profile,
      projects: [{ ...profile.projects[0], action: "我用 Redis 做了缓存，还接了 Elasticsearch 搜索" }],
    });
    const next = applyPolish(profileToResume(changed), [
      { itemKey: action.itemKey, sourceHash: action.sourceHash, text: "引入 Redis 缓存并实现搜索功能" },
    ]);
    expect(next.sections.find((s) => s.kind === "projects")?.items[0]?.bullets[1]?.text).toBe(
      "我用 Redis 做了缓存，还接了 Elasticsearch 搜索",
    );
  });

  it("同样原文但条目不同不串用", () => {
    const next = applyPolish(resume, [
      { itemKey: polishItemKey("projects", "别的项目"), sourceHash: action.sourceHash, text: "改写" },
    ]);
    expect(next).toEqual(resume);
  });
});

describe("ungroundedTokens", () => {
  const source = "我用 Redis 和 spring boot 做了缓存，上线后有三百多人用，接口快了 40%，响应 1,200ms";

  it("原文出现过的数字、中文数字、技术词都放行", () => {
    expect(
      ungroundedTokens(
        source,
        "基于 Redis 与 Spring Boot 构建缓存，服务 300+ 用户，接口提速 40%，响应 1200ms",
      ),
    ).toEqual([]);
  });

  it("拦截编造的数字", () => {
    expect(ungroundedTokens(source, "服务 500 名用户，接口提速 40%")).toEqual(["500"]);
  });

  it("拦截编造的英文技术词，大小写不敏感但要整词出现", () => {
    expect(ungroundedTokens(source, "基于 REDIS 与 Kafka 构建消息链路")).toEqual(["Kafka"]);
    expect(ungroundedTokens("用了 Vue", "使用 Vue3 开发前端")).toEqual(["Vue3"]);
    expect(ungroundedTokens("用了 React.js", "使用 React 开发前端")).toEqual([]);
  });

  it("小数、百分比按数值比较", () => {
    expect(ungroundedTokens("GPA 3.80，排名前 5%", "GPA 3.8，专业前 5%")).toEqual([]);
    expect(ungroundedTokens("GPA 3.8", "GPA 3.9")).toEqual(["3.9"]);
  });
});
