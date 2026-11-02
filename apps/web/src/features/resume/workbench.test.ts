import { afterEach, describe, expect, it, vi } from "vitest";
import type { Completeness, MissingField, ResumeContent } from "../../api/types.ts";
import {
  missingPrompt,
  quickPrompts,
  readFlag,
  resumeSubtitle,
  resumeSuggestions,
  writeFlag,
} from "./workbench.ts";

const bullet = (text: string) => ({ text, factIds: [] });

const resume: ResumeContent = {
  basics: { name: "周一舟", contacts: [] },
  sections: [
    {
      kind: "experiences",
      title: "实习经历",
      items: [
        {
          heading: "青柚科技",
          subheading: "后端开发",
          bullets: [bullet("负责订单模块"), bullet("修复缺陷")],
        },
      ],
    },
    {
      kind: "projects",
      title: "项目经历",
      items: [
        {
          heading: "湖畔书屋",
          bullets: [
            bullet("搭建借阅平台"),
            bullet("接口耗时从 600ms 降到 90ms"),
            bullet("约 2000 名同学使用"),
          ],
        },
        { heading: "社团记账", bullets: [] },
      ],
    },
    { kind: "skills", title: "专业技能", items: [{ heading: "熟练", bullets: [bullet("Go")] }] },
  ],
};

const miss = (extra: Partial<MissingField>): MissingField => ({
  key: "k",
  section: "projects",
  field: "role",
  label: "角色",
  weight: 1,
  required: true,
  kind: "field",
  ...extra,
});

const completeness = (missing: MissingField[]): Completeness => ({
  score: 0.8,
  sections: [{ section: "projects", weight: 1, score: 0.6, completed: false }],
  missing,
});

describe("resumeSuggestions", () => {
  it("先列必填缺项，再列要点少或没量化的经历", () => {
    const list = resumeSuggestions(
      resume,
      completeness([
        miss({ itemId: "p1", itemLabel: "社团记账", label: "角色" }),
        miss({ itemId: "p1", itemLabel: "社团记账", field: "result", label: "结果（量化）" }),
        miss({ section: "awards", field: "_", label: "获奖", kind: "new_item" }),
        miss({ section: "skills", field: "_item", label: "新增技能", kind: "new_item" }),
        miss({ field: "q", label: "量化", kind: "quantify" }),
      ]),
      10,
    );
    expect(list.map((s) => s.title)).toEqual([
      "「社团记账」还缺角色、结果",
      "还没有获奖荣誉",
      "专业技能还可以再多一些",
      "青柚科技实习只有 2 条要点，没有量化结果",
      "社团记账项目还没有要点",
    ]);
    expect(list[3]?.prompt).toContain("「青柚科技」这段实习经历");
  });

  it("要点充足且有数字的经历不提示，并按上限截断", () => {
    const list = resumeSuggestions(resume, undefined, 1);
    expect(list).toHaveLength(1);
    expect(list.some((s) => s.title.startsWith("湖畔书屋"))).toBe(false);
  });
});

describe("quickPrompts", () => {
  it("带上简历里的条目名和求职方向", () => {
    expect(quickPrompts(resume, "后端开发")).toEqual([
      "帮我补充社团记账的量化结果",
      "补充后端开发岗位用得上的技能",
      "细说青柚科技实习的成果",
    ]);
  });

  it("空简历给出起步话题", () => {
    expect(quickPrompts({ basics: { name: "", contacts: [] }, sections: [] }, undefined)).toHaveLength(3);
    expect(quickPrompts(undefined, undefined)[0]).toBe("我想聊聊一段实习经历");
  });
});

describe("resumeSubtitle / missingPrompt", () => {
  const now = Date.parse("2026-11-02T10:00:00Z");

  it("拼出完整度和相对更新时间", () => {
    expect(resumeSubtitle(1, "2026-11-02T09:50:00Z", now)).toBe("完整度 100% · 10 分钟前更新");
    expect(resumeSubtitle(0.42, null, now)).toBe("完整度 42%");
  });

  it("完整度没满时给出可发送的补充请求", () => {
    const prompt = missingPrompt(completeness([miss({ section: "basics", field: "phone", label: "电话" })]));
    expect(prompt?.text).toBe("还差电话");
    expect(prompt?.prompt).toContain("还差电话");
    expect(missingPrompt(completeness([]))).toBeNull();
  });
});

describe("readFlag / writeFlag", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("没有 localStorage 时回落默认值且不抛错", () => {
    expect(readFlag("x", true)).toBe(true);
    expect(() => writeFlag("x", false)).not.toThrow();
  });

  it("读写同一个开关", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    });
    writeFlag("panel", false);
    expect(readFlag("panel", true)).toBe(false);
  });
});
