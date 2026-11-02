import { Profile } from "@talksume/core";
import { createDb, type DbHandle, migrate, schema } from "@talksume/db";
import { close } from "@talksume/resume-render";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.ts";

let handle: DbHandle;
let app: FastifyInstance;
let headers: Record<string, string>;

const profile = Profile.parse({
  basics: { name: "李明", email: "liming@example.com" },
  education: [
    { id: "edu_1", school: "浙江大学", degree: "bachelor", major: "计算机科学与技术", start: "2023-09" },
  ],
  skills: [{ id: "skl_1", name: "Go", level: "proficient" }],
});

async function seedProfile() {
  const [user] = await handle.db
    .insert(schema.users)
    .values({ email: "resume@example.com" })
    .returning({ id: schema.users.id });
  const userId = user?.id ?? "";
  await handle.db.insert(schema.profiles).values({ userId, data: profile });
  headers = { "x-talksume-user": userId };
}

beforeEach(async () => {
  handle = await createDb({ pglite: "memory://" });
  await migrate(handle);
  app = buildApp({ edition: "cloud", version: "t", db: handle.db });
  await app.ready();
  headers = {};
});

afterEach(async () => {
  await app.close();
  await handle.close();
});

afterAll(() => close());

describe("画像与简历预览", () => {
  it("没有画像时返回空画像和空简历", async () => {
    const profileRes = (await app.inject({ method: "GET", url: "/api/v1/profile" })).json();
    expect(profileRes).toMatchObject({ version: 0, profile: { education: [] } });
    expect(profileRes.completeness.score).toBe(0);
    const resume = (await app.inject({ method: "GET", url: "/api/v1/resume" })).json();
    expect(resume.resume.sections).toEqual([]);
  });

  it("按当前用户返回画像与由它生成的简历", async () => {
    await seedProfile();
    const resume = (await app.inject({ method: "GET", url: "/api/v1/resume", headers })).json();
    expect(resume.profileVersion).toBe(1);
    expect(resume.resume.basics).toMatchObject({ name: "李明", contacts: ["liming@example.com"] });
    expect(resume.resume.sections.map((s: { kind: string }) => s.kind)).toEqual(["education", "skills"]);
  });
});

describe("简历导出", () => {
  it("没有内容时返回 409", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/resume/export?format=docx" });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("profile_empty");
  });

  it("format 不合法返回 400", async () => {
    await seedProfile();
    const res = await app.inject({ method: "GET", url: "/api/v1/resume/export?format=txt", headers });
    expect(res.statusCode).toBe(400);
  });

  it("docx：合法 zip，中文文件名用 filename* 编码", async () => {
    await seedProfile();
    const res = await app.inject({ method: "GET", url: "/api/v1/resume/export?format=docx", headers });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("wordprocessingml.document");
    expect(res.rawPayload.length).toBeGreaterThan(1000);
    expect(res.rawPayload.subarray(0, 2).toString()).toBe("PK");
    const disposition = String(res.headers["content-disposition"]);
    expect(disposition).toContain('filename="resume.docx"');
    const encoded = /filename\*=UTF-8''(.+)$/.exec(disposition)?.[1] ?? "";
    expect(decodeURIComponent(encoded)).toBe("李明-简历.docx");
    expect(disposition).toMatch(/^[\x20-\x7e]+$/);
  });

  it("pdf：以 %PDF 开头的非空文件", async () => {
    await seedProfile();
    const res = await app.inject({ method: "GET", url: "/api/v1/resume/export?format=pdf", headers });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.rawPayload.subarray(0, 4).toString()).toBe("%PDF");
    expect(res.rawPayload.length).toBeGreaterThan(1000);
  }, 30_000);
});
