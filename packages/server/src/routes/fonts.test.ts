import { createDb, migrate } from "@talksume/db";
import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.ts";

const handle = await createDb({ pglite: "memory://" });
await migrate(handle);
const app = buildApp({ edition: "local", version: "t", db: handle.db });
afterAll(async () => {
  await app.close();
  await handle.close();
});

describe("简历字体路由", () => {
  it("样式表只含内置字体，文件地址指向本服务", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/resume-fonts/faces.css?f=song,hei" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/css");
    expect(res.body).toContain("Talksume Song");
    expect(res.body).toContain("/api/v1/resume-fonts/");
    expect(res.body).not.toMatch(/https?:/);
  });

  it("未知字体名 400", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/resume-fonts/faces.css?f=Arial" });
    expect(res.statusCode).toBe(400);
  });

  it("字体文件名只认随包列表，路径穿越 404", async () => {
    for (const name of ["..%2F..%2Fpackage.json", "evil.woff2", "x.txt"]) {
      const res = await app.inject({ method: "GET", url: `/api/v1/resume-fonts/${name}` });
      expect(res.statusCode).toBe(404);
    }
    const css = (await app.inject({ method: "GET", url: "/api/v1/resume-fonts/faces.css?f=hei" })).body;
    const file = css.match(/resume-fonts\/([a-z0-9-]+\.woff2)/)?.[1];
    expect(file).toBeTruthy();
    const ok = await app.inject({ method: "GET", url: `/api/v1/resume-fonts/${file}` });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["content-type"]).toBe("font/woff2");
    expect(ok.rawPayload.subarray(0, 4).toString()).toBe("wOF2");
  });
});
