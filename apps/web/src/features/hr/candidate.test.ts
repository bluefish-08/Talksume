import { describe, expect, it } from "vitest";
import { candidateIdentity } from "./candidate.ts";
import type { HrApplication } from "./types.ts";

const candidate = { id: "u1", displayName: "演示用户", email: "demo@example.com" };
const resumeOf = (name: string, contacts: string[]): HrApplication["resume"] => ({
  id: "r1",
  template: "campus",
  createdAt: "2026-11-01T00:00:00Z",
  content: { basics: { name, contacts }, sections: [] },
});

describe("candidateIdentity", () => {
  it("优先用简历里的姓名、邮箱和电话", () => {
    const resume = resumeOf("陈晓", ["13800001111", "chenxiao@school.edu.cn", "杭州"]);
    expect(candidateIdentity({ candidate, resume })).toEqual({
      name: "陈晓",
      contacts: ["chenxiao@school.edu.cn", "13800001111"],
    });
  });

  it("简历里没有邮箱和电话时用账号邮箱，姓名为空时用账号名", () => {
    expect(candidateIdentity({ candidate, resume: resumeOf("", ["杭州"]) })).toEqual({
      name: "演示用户",
      contacts: ["demo@example.com"],
    });
  });

  it("没有简历时回落到账号信息", () => {
    expect(candidateIdentity({ candidate, resume: null })).toEqual({
      name: "演示用户",
      contacts: ["demo@example.com"],
    });
  });
});
