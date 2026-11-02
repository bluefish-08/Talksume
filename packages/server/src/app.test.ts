import { describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";

describe("buildApp", () => {
  const app = buildApp({ edition: "cloud", version: "0.0.0-test" });

  it("健康检查", async () => {
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("返回版本信息", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/meta" });
    expect(res.json()).toMatchObject({ edition: "cloud", version: "0.0.0-test" });
  });
});
