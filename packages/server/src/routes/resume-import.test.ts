import { Profile } from "@talksume/core";
import { createDb, type DbHandle, migrate, schema } from "@talksume/db";
import { close, renderPdf } from "@talksume/resume-render";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.ts";
import type { StructuredLlm } from "../polish-llm.ts";
import { DOCX_MIME } from "../resume-import/extract.ts";
import { imageOnlyPdf, LI_MING_TEXT, liMingResume } from "../resume-import/fixtures.ts";

// biome-ignore lint/suspicious/noExplicitAny: 测试里的响应体不做类型约束
type Json = any;

const PARSED = [
  {
    section: "basics",
    payload: { name: "李明", phone: "139-0000-1234", email: "liming@example.com", city: "江城" },
    quote: "李明 … 电话：139-0000-1234 | 邮箱：liming@example.com | 江城",
  },
  {
    section: "education",
    payload: { school: "江城大学", degree: "bachelor", major: "软件工程", gpa: "3.6/4.0", start: "2023-09" },
    quote: "江城大学 · 软件工程 · 本科 2023.09 – 2027.06",
  },
  {
    section: "projects",
    payload: {
      name: "校园食堂点餐小程序",
      role: "后端开发",
      techStack: ["Spring Boot", "MySQL", "Redis"],
      highlights: [
        { title: "订单模块", detail: "负责订单模块和支付回调接口的开发" },
        { title: "菜单缓存", detail: "使用 Redis 缓存菜单数据，高峰期接口响应从 600ms 降到 150ms" },
      ],
    },
    quote: "校园食堂点餐小程序 · 后端开发 2024.09 – 2025.01",
  },
  { section: "skills", payload: { name: "Java", level: "familiar" }, quote: "熟悉 Java、Spring Boot" },
  {
    section: "experiences",
    payload: { company: "星河科技", kind: "internship", title: "后端开发实习生" },
    quote: "星河科技 后端开发实习生",
  },
];

let handle: DbHandle;
let app: FastifyInstance;
let userId: string;
let prompts: string[];

function fakeLlm(facts: unknown[] = PARSED): StructuredLlm {
  return {
    completeStructured: async <T>(req: Parameters<StructuredLlm["completeStructured"]>[0]) => {
      prompts.push(req.prompt ?? "");
      const value = req.validate({ facts }) as T;
      return { value, text: JSON.stringify(value), model: "fake" };
    },
  };
}

beforeAll(async () => {
  handle = await createDb({ pglite: "memory://" });
  await migrate(handle);
}, 60_000);

afterAll(async () => {
  await close();
  await handle.close();
});

beforeEach(async () => {
  prompts = [];
  const [user] = await handle.db
    .insert(schema.users)
    .values({ email: `${crypto.randomUUID()}@example.com`, displayName: "李明" })
    .returning();
  userId = user?.id ?? "";
});

afterEach(() => app?.close());

async function boot(llm: StructuredLlm | null = fakeLlm()) {
  app = buildApp({
    edition: "cloud",
    version: "t",
    db: handle.db,
    resumeLlm: llm,
    matching: { llm: null, embedder: null, reranker: null, minScore: 0 },
  });
  await app.ready();
}

async function call(method: "GET" | "POST", url: string, payload?: object) {
  const res = await app.inject({
    method,
    url,
    headers: { "x-talksume-user": userId },
    ...(payload && { payload }),
  });
  return { status: res.statusCode, body: res.json() as Json };
}

async function upload(bytes: Uint8Array, type: string, name: string) {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/resume-import/parse",
    headers: { "x-talksume-user": userId, "content-type": type, "x-file-name": encodeURIComponent(name) },
    payload: Buffer.from(bytes),
  });
  return { status: res.statusCode, body: res.json() as Json };
}

const parsePaste = (text = LI_MING_TEXT) => call("POST", "/api/v1/resume-import/parse", { text });

describe("POST /api/v1/resume-import/parse", () => {
  it("粘贴文本：返回核对后的预览，编造的条目被丢弃", async () => {
    await boot();
    const { status, body } = await parsePaste();
    expect(status).toBe(200);
    expect(prompts[0]).toContain("江城大学");
    expect(body.source).toMatchObject({ kind: "paste" });
    expect(body.items.map((i: Json) => i.label)).toEqual(["李明", "江城大学", "校园食堂点餐小程序", "Java"]);
    expect(body.items.every((i: Json) => i.status === "new" || i.status === "update")).toBe(true);
    expect(body.dropped).toEqual([expect.objectContaining({ section: "experiences", label: "星河科技" })]);
    expect(body.groups.map((g: Json) => g.section)).toEqual(["basics", "education", "projects", "skills"]);
  });

  it("上传 PDF：抽取文字后交给模型", { timeout: 60_000 }, async () => {
    await boot();
    const pdf = await renderPdf(liMingResume);
    const { status, body } = await upload(new Uint8Array(pdf), "application/pdf", "李明简历.pdf");
    expect(status).toBe(200);
    expect(body.source).toMatchObject({ kind: "pdf", fileName: "李明简历.pdf" });
    expect(body.text.replace(/\s/g, "")).toContain("校园食堂点餐小程序");
    expect(prompts[0]?.replace(/\s/g, "")).toContain("负责订单模块和支付回调接口的开发");
  });

  it("预告和已有画像冲突的条目", async () => {
    await handle.db.insert(schema.profiles).values({
      userId,
      data: Profile.parse({
        education: [
          { id: "e1", school: "江城大学", degree: "bachelor", major: "计算机科学", sourceFactIds: [] },
        ],
      }),
    });
    await boot();
    const { body } = await parsePaste();
    expect(body.items.find((i: Json) => i.label === "江城大学")?.status).toBe("conflict");
  });

  it("图片 PDF、超限、老版 doc 给出友好提示，不调用模型", async () => {
    await boot();
    const image = await upload(imageOnlyPdf(), "application/pdf", "扫描件.pdf");
    expect(image.status).toBe(422);
    expect(image.body).toMatchObject({ code: "image_pdf" });
    expect(image.body.message).toContain("粘贴文本");

    const big = await upload(new Uint8Array(5 * 1024 * 1024 + 10), "application/pdf", "big.pdf");
    expect(big.status).toBe(413);
    expect(big.body.message).toContain("5MB");

    const doc = await upload(new Uint8Array([1, 2, 3]), "application/msword", "旧简历.doc");
    expect(doc.status).toBe(415);
    expect(doc.body.message).toContain(".docx");

    const short = await parsePaste("李明 江城大学");
    expect(short.status).toBe(422);
    expect(short.body.code).toBe("text_too_short");
    expect(prompts).toEqual([]);
  });

  it("没有配置模型时返回 503", async () => {
    await boot(null);
    expect((await parsePaste()).status).toBe(503);
  });

  it("docx 走同一入口", async () => {
    await boot();
    const res = await upload(new Uint8Array([0x50, 0x4b, 3, 4]), DOCX_MIME, "简历.docx");
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("bad_file");
  });
});

describe("POST /api/v1/resume-import/confirm", () => {
  it("新建会话写入画像，开场只问缺的内容，原话记录标记来自简历", async () => {
    await boot();
    const preview = (await parsePaste()).body;
    const { status, body } = await call("POST", "/api/v1/resume-import/confirm", {
      text: preview.text,
      fileName: "李明简历.pdf",
      facts: preview.items.map((i: Json) => i.fact),
    });
    expect(status).toBe(200);
    expect(body).toMatchObject({ imported: 4, conflicts: 0 });

    const profile = (await call("GET", "/api/v1/profile")).body.profile;
    expect(profile.basics.phone).toBe("139-0000-1234");
    expect(profile.education[0]).toMatchObject({ school: "江城大学", gpa: "3.6/4.0" });
    expect(profile.projects[0].highlights).toHaveLength(2);
    expect(profile.experiences).toEqual([]);

    const conv = (await call("GET", `/api/v1/conversations/${body.conversationId}`)).body;
    expect(conv.title).toBe("导入简历");
    expect(conv.messages.map((m: Json) => m.role)).toEqual(["user", "assistant"]);
    expect(conv.messages[0].resumeImport).toEqual({ fileName: "李明简历.pdf", facts: 4 });
    const opening = conv.messages[1].content as string;
    expect(opening).toContain("我从你的简历里读到了 4 条信息");
    expect(opening).not.toMatch(/怎么称呼|手机号|你的学校和专业/);
    expect(conv.messages[1].changes.length).toBeGreaterThan(0);

    const facts = (await call("GET", "/api/v1/facts")).body.items;
    expect(facts).toHaveLength(4);
    expect(facts.every((f: Json) => f.source === "resume" && f.sourceMessageId === conv.messages[0].id)).toBe(
      true,
    );
  });

  it("导入到已有会话；和画像冲突的进入待确认", async () => {
    await handle.db.insert(schema.profiles).values({
      userId,
      data: Profile.parse({
        education: [
          { id: "e1", school: "江城大学", degree: "bachelor", major: "计算机科学", sourceFactIds: [] },
        ],
      }),
    });
    await boot();
    const created = await call("POST", "/api/v1/conversations");
    const id = created.body.id;
    const preview = (await parsePaste()).body;
    const { body } = await call("POST", "/api/v1/resume-import/confirm", {
      text: preview.text,
      facts: preview.items.map((i: Json) => i.fact),
      conversationId: id,
    });
    expect(body).toMatchObject({ conversationId: id, conflicts: 1 });

    const conv = (await call("GET", `/api/v1/conversations/${id}`)).body;
    expect(conv.messages.map((m: Json) => m.role)).toEqual(["assistant", "user", "assistant"]);
    expect(conv.messages[2].content).toContain("和之前记录的不一样");
    expect(conv.conflicts).toEqual([
      expect.objectContaining({ field: "major", previous: "计算机科学", proposed: "软件工程" }),
    ]);
    expect(conv.profile.education[0].major).toBe("计算机科学");

    const pending = await handle.db
      .select()
      .from(schema.profileFacts)
      .where(eq(schema.profileFacts.status, "pending"));
    expect(pending.filter((f) => f.userId === userId)).toHaveLength(1);

    const resolved = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${id}/conflicts/${conv.conflicts[0].factId}`,
      headers: { "x-talksume-user": userId },
      payload: { choice: "proposed" },
    });
    expect(resolved.statusCode).toBe(200);
    expect((await call("GET", "/api/v1/profile")).body.profile.education[0].major).toBe("软件工程");
  });

  it("回传的事实重新按原文核对，篡改的被拒", async () => {
    await boot();
    const preview = (await parsePaste()).body;
    const tampered = {
      section: "awards",
      payload: { name: "国家奖学金" },
      quote: "国家奖学金",
    };
    const { body } = await call("POST", "/api/v1/resume-import/confirm", {
      text: preview.text,
      facts: [preview.items[3].fact, tampered],
    });
    expect(body.imported).toBe(1);
    expect(body.dropped).toEqual([expect.objectContaining({ label: "国家奖学金" })]);

    const onlyFake = await call("POST", "/api/v1/resume-import/confirm", {
      text: preview.text,
      facts: [tampered],
    });
    expect(onlyFake.status).toBe(422);
    expect(onlyFake.body.code).toBe("nothing_to_import");
  });
});
