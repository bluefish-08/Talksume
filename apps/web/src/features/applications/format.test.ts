import { describe, expect, it } from "vitest";
import { relativeTime } from "./format.ts";

describe("relativeTime", () => {
  const now = new Date("2026-11-02T12:00:00Z").getTime();
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it("按量级输出中文相对时间", () => {
    expect(relativeTime(ago(10_000), now)).toBe("刚刚");
    expect(relativeTime(ago(3 * 60_000), now)).toBe("3 分钟前");
    expect(relativeTime(ago(5 * 3_600_000), now)).toBe("5 小时前");
    expect(relativeTime(ago(2 * 86_400_000), now)).toBe("2 天前");
  });
});
