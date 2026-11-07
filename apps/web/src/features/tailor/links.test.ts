import { describe, expect, it } from "vitest";
import { conversationPath, jobDetailPath, tailoringHref, tailorRedirectPath } from "./links.ts";
import type { TailoringView } from "./queries.ts";

const view = (conversationId: string | null): TailoringView =>
  ({
    available: true,
    job: { id: "demo:mt1", company: "美团", title: "后端开发工程师（实习）" },
    tailoring: {
      base: { basics: {}, sections: [] },
      changes: [],
      selected: [],
      adopted: null,
      conversationId,
      stale: false,
      updatedAt: "2026-10-01T00:00:00.000Z",
    },
  }) as unknown as TailoringView;

describe("旧 /tailor 地址的去向", () => {
  it("有生成它的对话就去对话", () => {
    expect(tailorRedirectPath(view("c_123"), "demo:mt1")).toBe("/c/c_123");
    expect(conversationPath("c_123")).toBe("/c/c_123");
  });

  it("没有对话、没有定制版或加载失败时回岗位详情", () => {
    expect(tailorRedirectPath(view(null), "demo:mt1")).toBe("/jobs?job=demo%3Amt1");
    expect(tailorRedirectPath(undefined, "demo:mt1")).toBe("/jobs?job=demo%3Amt1");
    expect(jobDetailPath("demo:mt1")).toBe("/jobs?job=demo%3Amt1");
  });

  it("对话链接和岗位回退都做编码", () => {
    expect(tailoringHref({ conversationId: "c 1" }, "j")).toBe("/c/c%201");
    expect(tailoringHref(null, "demo:mt1")).toBe("/jobs?job=demo%3Amt1");
  });
});
