import { describe, expect, it } from "vitest";
import {
  APPLICATION_STATUSES,
  canTransition,
  InvalidTransitionError,
  statusChangeTitle,
  transition,
} from "./application.ts";

describe("投递状态机", () => {
  it("沿主链路逐步推进", () => {
    const steps = [
      ["pending", "applied"],
      ["applied", "viewed"],
      ["viewed", "interviewing"],
    ] as const;
    for (const [from, to] of steps) expect(canTransition(from, to)).toBe(true);
  });

  it("已读或已投递后可以直接结束", () => {
    expect(transition("viewed", "closed", "hr", "rejected").outcome).toBe("rejected");
    expect(transition("applied", "closed", "platform", "rejected").to).toBe("closed");
  });

  it("拒绝跳步和回退", () => {
    expect(() => transition("pending", "interviewing", "user")).toThrow(InvalidTransitionError);
    expect(() => transition("viewed", "applied", "platform")).toThrow(InvalidTransitionError);
  });

  it("终态不能再迁移", () => {
    for (const to of APPLICATION_STATUSES) expect(canTransition("closed", to)).toBe(false);
  });

  it("closed 必须带结果，其他状态不能带", () => {
    expect(() => transition("interviewing", "closed", "hr")).toThrow();
    expect(() => transition("applied", "viewed", "platform", "offer")).toThrow();
  });

  it("待投递时可以直接撤回，withdrawn 只能由用户触发", () => {
    expect(transition("pending", "closed", "user", "withdrawn").outcome).toBe("withdrawn");
    expect(transition("interviewing", "closed", "user", "withdrawn").to).toBe("closed");
    expect(() => transition("applied", "closed", "hr", "withdrawn")).toThrow();
  });

  it("生成中文状态通知标题", () => {
    expect(statusChangeTitle("腾讯", "后端开发实习生", "interviewing")).toBe(
      "「腾讯·后端开发实习生」状态更新为：面试中",
    );
    expect(statusChangeTitle("腾讯", "后端开发实习生", "closed", "offer")).toContain("已录用");
  });
});
