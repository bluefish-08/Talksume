import { describe, expect, it } from "vitest";
import { APPLICATION_STATUSES, canTransition, InvalidTransitionError, transition } from "./application.ts";

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
});
