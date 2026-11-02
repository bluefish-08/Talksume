import { afterEach, describe, expect, it, vi } from "vitest";
import type { Completeness, MissingField, ResumeContent } from "../../api/types.ts";
import {
  missingPrompt,
  PAPER_HEIGHT_PX,
  PAPER_WIDTH_PX,
  paperScale,
  parseZoom,
  quickPrompts,
  readFlag,
  readZoom,
  resumeSubtitle,
  resumeSuggestions,
  stepZoom,
  writeFlag,
  writeZoom,
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

describe("paperScale", () => {
  it("适合页面取宽高中较小的比例", () => {
    const tall = { width: 1000, height: PAPER_HEIGHT_PX / 2 };
    expect(paperScale("page", tall)).toBeCloseTo(0.5);
    const narrow = { width: PAPER_WIDTH_PX / 4, height: 2000 };
    expect(paperScale("page", narrow)).toBeCloseTo(0.25);
  });

  it("适合宽度不看高度，且不放大超过 100%", () => {
    expect(paperScale("width", { width: PAPER_WIDTH_PX / 2, height: 100 })).toBeCloseTo(0.5);
    expect(paperScale("width", { width: 5000, height: 100 })).toBe(1);
    expect(paperScale("page", { width: 5000, height: 5000 })).toBe(1);
  });

  it("固定档位按百分比，视口未量出时按 100%", () => {
    expect(paperScale(80, { width: 10, height: 10 })).toBe(0.8);
    expect(paperScale("page", { width: 0, height: 0 })).toBe(1);
  });
});

describe("stepZoom", () => {
  it("落在整十百分比上", () => {
    expect(stepZoom(0.63, 1)).toBe(70);
    expect(stepZoom(0.63, -1)).toBe(60);
    expect(stepZoom(0.8, 1)).toBe(90);
    expect(stepZoom(0.8, -1)).toBe(70);
  });

  it("限制在 50%–150%", () => {
    expect(stepZoom(1.5, 1)).toBe(150);
    expect(stepZoom(0.5, -1)).toBe(50);
    expect(stepZoom(0.38, 1)).toBe(50);
  });
});

describe("parseZoom / readZoom / writeZoom", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("只接受合法档位，其余回落默认", () => {
    expect(parseZoom("width")).toBe("width");
    expect(parseZoom("90")).toBe(90);
    expect(parseZoom(null)).toBe("page");
    expect(parseZoom("40")).toBe("page");
    expect(parseZoom("151", "width")).toBe("width");
    expect(parseZoom("abc")).toBe("page");
  });

  it("没有 localStorage 时回落默认值且不抛错", () => {
    expect(readZoom("z")).toBe("page");
    expect(() => writeZoom("z", 80)).not.toThrow();
  });

  it("读写同一个档位", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    });
    writeZoom("z", 120);
    expect(readZoom("z")).toBe(120);
    writeZoom("z", "width");
    expect(readZoom("z")).toBe("width");
  });
});
