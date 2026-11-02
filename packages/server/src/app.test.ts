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

describe("开发期身份", () => {
  it("没带头时落到演示用户，且多次请求是同一个", async () => {
    const { createDb, migrate } = await import("@talksume/db");
    const handle = await createDb({ pglite: "memory://" });
    await migrate(handle);
    const app = buildApp({ edition: "cloud", version: "t", db: handle.db });
    const ids: string[] = [];
    app.get("/api/v1/whoami", async (req) => {
      ids.push(req.userId);
      return {};
    });
    await app.inject({ method: "GET", url: "/api/v1/whoami" });
    await app.inject({ method: "GET", url: "/api/v1/whoami" });
    expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(ids[1]).toBe(ids[0]);
    await app.close();
    await handle.close();
  });
});
