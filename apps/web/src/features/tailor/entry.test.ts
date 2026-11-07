import { describe, expect, it } from "vitest";
import { tailorEntry } from "./entry.ts";
import type { TailoringView } from "./queries.ts";

const view = (over: {
  adopted: boolean;
  selected?: string[];
  conversationId?: string | null;
}): TailoringView =>
  ({
    available: true,
    job: { id: "demo:mt1", company: "美团", title: "后端开发工程师（实习）" },
    tailoring: {
      base: { basics: {}, sections: [] },
      changes: [],
      selected: over.selected ?? (over.adopted ? ["summary"] : []),
      adopted: over.adopted ? { resumeVersionId: "v1", adoptedAt: "2026-10-01T00:00:00.000Z" } : null,
      conversationId: over.conversationId ?? null,
      stale: false,
      updatedAt: "2026-10-01T00:00:00.000Z",
    },
  }) as unknown as TailoringView;

describe("岗位详情下一步：两种状态", () => {
  it("还没有定制版：显示主简历，按钮走改成定制版的对话", () => {
    expect(tailorEntry(undefined)).toEqual({
      adopted: false,
      company: "",
      conversationId: null,
      primaryAction: "tailor",
    });
    expect(tailorEntry(view({ adopted: false, conversationId: "c1" }))).toMatchObject({
      adopted: false,
      company: "美团",
      conversationId: "c1",
      primaryAction: "tailor",
    });
  });

  it("已采用：显示公司定制版，并能回到生成它的对话", () => {
    expect(tailorEntry(view({ adopted: true, conversationId: "c1" }))).toMatchObject({
      adopted: true,
      company: "美团",
      conversationId: "c1",
      primaryAction: "apply",
    });
  });

  it("只有草稿、没采用时仍按主简历投递", () => {
    expect(tailorEntry(view({ adopted: false, selected: [] })).adopted).toBe(false);
  });
});
