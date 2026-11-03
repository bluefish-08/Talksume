import { describe, expect, it } from "vitest";
import { polishItemKey, polishSourceHash } from "./polish.ts";
import type { ResumeContent } from "./resume.ts";
import { applyTailoring, skillNames } from "./tailor.ts";

const resume: ResumeContent = {
  basics: { name: "李明", contacts: [] },
  sections: [
    {
      kind: "projects",
      title: "项目经历",
      items: [
        {
          heading: "江城闲置",
          bullets: [
            { text: "做了前端页面", factIds: ["f1"] },
            { text: "用 Redis 做缓存", factIds: ["f1"] },
          ],
        },
        { heading: "校园跑腿", bullets: [{ text: "写了后端接口", factIds: ["f2"] }] },
      ],
    },
    {
      kind: "skills",
      title: "专业技能",
      items: [
        { heading: "熟练", bullets: [{ lead: "熟练", text: "Vue、Java", factIds: ["f3"] }] },
        { heading: "了解", bullets: [{ lead: "了解", text: "Redis、Go", factIds: ["f3"] }] },
      ],
    },
  ],
};

const key = polishItemKey("projects", "江城闲置");

describe("applyTailoring", () => {
  it("先重排再按原文哈希替换，factIds 保持不变", () => {
    const out = applyTailoring(resume, [
      {
        id: "a",
        kind: "bullet",
        itemKey: key,
        heading: "江城闲置",
        sourceHash: polishSourceHash("用 Redis 做缓存"),
        before: "用 Redis 做缓存",
        after: "基于 Redis 实现缓存",
        violations: [],
      },
      {
        id: "b",
        kind: "bullet_order",
        itemKey: key,
        heading: "江城闲置",
        order: [polishSourceHash("用 Redis 做缓存"), polishSourceHash("做了前端页面")],
        before: [],
        after: [],
        violations: [],
      },
      { id: "c", kind: "item_order", section: "projects", before: [], after: ["校园跑腿"], violations: [] },
      { id: "d", kind: "summary", after: "熟悉 Redis 缓存", violations: [] },
    ]);
    const projects = out.sections[0];
    expect(projects?.items.map((i) => i.heading)).toEqual(["校园跑腿", "江城闲置"]);
    expect(projects?.items[1]?.bullets).toEqual([
      { text: "基于 Redis 实现缓存", factIds: ["f1"] },
      { text: "做了前端页面", factIds: ["f1"] },
    ]);
    expect(out.basics.summary).toBe("熟悉 Redis 缓存");
    expect(resume.sections[0]?.items[0]?.heading).toBe("江城闲置");
  });

  it("技能只在行内重排，按熟练度分组的条目顺序不动", () => {
    expect(skillNames(resume)).toEqual(["Vue", "Java", "Redis", "Go"]);
    const out = applyTailoring(resume, [
      { id: "s", kind: "skill_order", before: [], after: ["Go", "Java", "Redis", "Vue"], violations: [] },
    ]);
    expect(out.sections[1]?.items.map((i) => [i.heading, i.bullets[0]?.text])).toEqual([
      ["熟练", "Java、Vue"],
      ["了解", "Go、Redis"],
    ]);
  });
});
