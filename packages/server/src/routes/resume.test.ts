import { Profile } from "@talksume/core";
import { createDb, type DbHandle, migrate, schema } from "@talksume/db";
import { close } from "@talksume/resume-render";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.ts";
import { loadResumeStyle, storeResumeStyler } from "../resume-style.ts";
import type { TemplateAdvisor } from "../template-advisor.ts";
import { profileDigest } from "../template-advisor.ts";

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
    expect(resume.updatedAt).toBeNull();
  });

  it("按当前用户返回画像与由它生成的简历", async () => {
    await seedProfile();
    const resume = (await app.inject({ method: "GET", url: "/api/v1/resume", headers })).json();
    expect(resume.profileVersion).toBe(1);
    expect(Number.isNaN(Date.parse(resume.updatedAt))).toBe(false);
    expect(resume.resume.basics).toMatchObject({ name: "李明", contacts: ["liming@example.com"] });
    expect(resume.resume.sections.map((s: { kind: string }) => s.kind)).toEqual(["education", "skills"]);
  });
});

describe("事实原话", () => {
  it("只返回当前用户的事实，按创建时间排序", async () => {
    await seedProfile();
    const [other] = await handle.db
      .insert(schema.users)
      .values({ email: "other@example.com" })
      .returning({ id: schema.users.id });
    const mine = headers["x-talksume-user"] ?? "";
    await handle.db.insert(schema.profileFacts).values([
      { userId: mine, section: "skills", payload: { name: "Go" }, quote: "我会 Go", status: "confirmed" },
      { userId: other?.id ?? "", section: "basics", payload: {}, quote: "别人的话", status: "confirmed" },
    ]);
    const res = await app.inject({ method: "GET", url: "/api/v1/facts", headers });
    expect(res.statusCode).toBe(200);
    const { items } = res.json();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ section: "skills", quote: "我会 Go", status: "confirmed" });
    expect(items[0]).not.toHaveProperty("payload");
  });

  it("没有事实时返回空列表", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/facts" });
    expect(res.json()).toEqual({ items: [] });
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

describe("简历模板偏好", () => {
  it("默认经典校园 + 品牌蓝，保存后读回，并用于导出", async () => {
    await seedProfile();
    const initial = await app.inject({ method: "GET", url: "/api/v1/resume/style", headers });
    expect(initial.json()).toEqual({ style: { template: "campus", accent: "blue" } });
    const saved = await app.inject({
      method: "PUT",
      url: "/api/v1/resume/style",
      headers,
      payload: { template: "minimal", accent: "ink" },
    });
    expect(saved.statusCode).toBe(200);
    const after = await app.inject({ method: "GET", url: "/api/v1/resume/style", headers });
    expect(after.json().style).toEqual({ template: "minimal", accent: "ink" });
  });

  it("不在可选范围内的模板返回 400", async () => {
    await seedProfile();
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/resume/style",
      headers,
      payload: { template: "fancy", accent: "blue" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("导出参数里的模板和强调色优先，坏值回落到已保存的偏好", async () => {
    await seedProfile();
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/resume/export?format=docx&template=modern&accent=wine",
      headers,
    });
    expect(res.statusCode).toBe(200);
    const bad = await app.inject({
      method: "GET",
      url: "/api/v1/resume/export?format=docx&template=fancy",
      headers,
    });
    expect(bad.statusCode).toBe(200);
  });
});

describe("智能推荐模板", () => {
  const withAdvisor = async (advisor: TemplateAdvisor) => {
    await app.close();
    app = buildApp({ edition: "cloud", version: "t", db: handle.db, templateAdvisor: advisor });
    await app.ready();
  };

  it("没配模型时返回 503", async () => {
    await seedProfile();
    const res = await app.inject({ method: "POST", url: "/api/v1/resume/style/recommend", headers });
    expect(res.statusCode).toBe(503);
  });

  it("画像为空时返回 409，不调模型", async () => {
    let called = false;
    await withAdvisor(async () => {
      called = true;
      return { template: "tech", accent: "blue", reason: "x" };
    });
    const res = await app.inject({ method: "POST", url: "/api/v1/resume/style/recommend" });
    expect(res.statusCode).toBe(409);
    expect(called).toBe(false);
  });

  it("返回模型挑的组合与理由，失败时 503 可重试", async () => {
    await seedProfile();
    await withAdvisor(async () => ({
      template: "tech",
      accent: "teal",
      reason: "技术方向内容多，紧凑版式放得下",
    }));
    const res = await app.inject({ method: "POST", url: "/api/v1/resume/style/recommend", headers });
    expect(res.json()).toEqual({
      recommendation: { template: "tech", accent: "teal", reason: "技术方向内容多，紧凑版式放得下" },
    });
    await withAdvisor(async () => {
      throw new Error("boom");
    });
    const failed = await app.inject({ method: "POST", url: "/api/v1/resume/style/recommend", headers });
    expect(failed.statusCode).toBe(503);
    expect(failed.json().retryable).toBe(true);
  });

  it("发给模型的摘要不含姓名、联系方式和学校", () => {
    const digest = profileDigest(
      Profile.parse({
        basics: { name: "李明", phone: "13900000000", email: "liming@example.com" },
        education: [{ id: "e1", school: "江城大学", degree: "bachelor", major: "软件工程" }],
        experiences: [{ id: "x1", kind: "internship", company: "江城数科", title: "后端开发实习生" }],
        intention: { roles: ["后端开发"], cities: [] },
      }),
    );
    expect(digest).toContain("后端开发");
    expect(digest).toContain("软件工程 本科");
    for (const secret of ["李明", "13900000000", "liming@example.com", "江城大学", "江城数科"]) {
      expect(digest).not.toContain(secret);
    }
  });
});

describe("对话定制样式", () => {
  const theme = {
    name: "稳重深绿",
    accent: "#166534",
    bodyFont: "sans",
    headingFont: "serif",
    header: "rule",
    headerAlign: "left",
    headingStyle: "underline",
    layout: "sidebar",
    bullet: "square",
    skills: "line",
    density: "auto",
  };

  it("PUT 带主题时校验并归一化，带多余字段的拒绝", async () => {
    await seedProfile();
    const bad = await app.inject({
      method: "PUT",
      url: "/api/v1/resume/style",
      headers,
      payload: { template: "tech", accent: "teal", theme: { ...theme, css: "h2{}" } },
    });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({
      method: "PUT",
      url: "/api/v1/resume/style",
      headers,
      payload: { template: "tech", accent: "teal", theme: { ...theme, accent: "#FDE047" } },
    });
    expect(ok.statusCode).toBe(200);
    const style = (await app.inject({ method: "GET", url: "/api/v1/resume/style", headers })).json().style;
    expect(style.theme.layout).toBe("sidebar");
    expect(style.theme.accent).not.toBe("#fde047");
  });

  it("工具端口合并保存、reset 回到预设；导出默认按主题", async () => {
    await seedProfile();
    const userId = headers["x-talksume-user"] ?? "";
    const styler = storeResumeStyler(handle.db, userId);
    const { style } = await styler.design({ accent: "#166534", layout: "sidebar" });
    expect(style).toMatchObject({ template: "tech", accent: "teal", theme: { layout: "sidebar" } });
    expect((await loadResumeStyle(handle.db, userId)).theme?.accent).toBe("#166534");

    const pdf = await app.inject({ method: "GET", url: "/api/v1/resume/export?format=pdf", headers });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");

    expect(await styler.reset()).toEqual({ template: "tech", accent: "teal" });
    expect((await loadResumeStyle(handle.db, userId)).theme).toBeUndefined();
  }, 30_000);
});
