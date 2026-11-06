import { describe, expect, it } from "vitest";
import { safeNext, withNext } from "./redirect.ts";

describe("safeNext", () => {
  it("保留站内路径和查询串", () => {
    expect(safeNext("/jobs?q=前端")).toBe("/jobs?q=前端");
    expect(safeNext("/c/abc")).toBe("/c/abc");
  });

  it("拒绝外站地址和认证页自身", () => {
    expect(safeNext("https://evil.example.org")).toBe("/");
    expect(safeNext("//evil.example.org")).toBe("/");
    expect(safeNext("/\\evil.example.org")).toBe("/");
    expect(safeNext("/login?next=/jobs")).toBe("/");
    expect(safeNext(null)).toBe("/");
    expect(safeNext("javascript:alert(1)", "/hr")).toBe("/hr");
  });

  it("withNext 回到首页时不带参数", () => {
    expect(withNext("/login", "/")).toBe("/login");
    expect(withNext("/login", "/jobs?q=a")).toBe("/login?next=%2Fjobs%3Fq%3Da");
  });
});
