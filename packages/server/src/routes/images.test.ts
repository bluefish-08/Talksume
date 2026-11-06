import { deflateSync } from "node:zlib";
import {
  createFauxCore,
  type FauxResponseStep,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { createDb, type DbHandle, migrate, schema } from "@talksume/db";
import { close } from "@talksume/resume-render";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { type AppDeps, buildApp } from "../app.ts";
import { IMAGE_LIMITS } from "../images.ts";

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (b: Buffer) => {
  let c = 0xffffffff;
  for (const x of b) c = (crcTable[(c ^ x) & 255] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "latin1");
  data.copy(out, 8);
  out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};

function makePng(width = 16, height = 12, extra: Buffer[] = []): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height, 7);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    ...extra,
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

interface Sse {
  event: string;
  data: Record<string, unknown>;
}
const parseSse = (body: string): Sse[] =>
  body
    .split("\n\n")
    .filter((c) => c.startsWith("event:"))
    .map((c) => {
      const [event, data] = c.split("\n");
      return { event: (event ?? "").slice(7), data: JSON.parse((data ?? "").slice(6)) };
    });

let handle: DbHandle;
let app: FastifyInstance;
const seen: string[] = [];

function fakeLlm(steps: FauxResponseStep[]): NonNullable<AppDeps["llm"]> {
  const core = createFauxCore({ models: [{ id: "fake-model" }] });
  core.setResponses(steps);
  return {
    models: [{ id: "fake-model", label: "测试", hint: "" }],
    resolve: () => ({
      model: core.getModel(),
      streamFn: (m, c, o) => {
        seen.push(JSON.stringify(c));
        return core.streamSimple(m, c, o);
      },
    }),
  };
}

async function boot(llm?: AppDeps["llm"]) {
  app = buildApp({ edition: "cloud", version: "t", db: handle.db, ...(llm && { llm }) });
  await app.ready();
}

async function newUser(email: string) {
  const [u] = await handle.db.insert(schema.users).values({ email }).returning({ id: schema.users.id });
  return { "x-talksume-user": u?.id ?? "" };
}

const upload = (body: Buffer, headers: Record<string, string>, type = "image/png") =>
  app.inject({
    method: "POST",
    url: "/api/v1/images",
    headers: { ...headers, "content-type": type },
    payload: body,
  });

beforeEach(async () => {
  seen.length = 0;
  handle = await createDb({ pglite: "memory://" });
  await migrate(handle);
});
afterEach(async () => {
  await app?.close();
  await handle.close();
});
afterAll(() => close());

describe("图片上传", () => {
  it("上传 PNG：返回 id 和尺寸，原样取回；元数据被剥掉", async () => {
    await boot();
    const me = await newUser("li@example.com");
    const dirty = makePng(16, 12, [chunk("tEXt", Buffer.from("Author\0李明 13800138000"))]);
    const res = await upload(dirty, me);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ mimeType: "image/png", width: 16, height: 12 });
    const got = await app.inject({ method: "GET", url: `/api/v1/images/${res.json().id}`, headers: me });
    expect(got.statusCode).toBe(200);
    expect(got.headers["content-type"]).toBe("image/png");
    expect(got.headers["x-content-type-options"]).toBe("nosniff");
    expect(got.rawPayload.includes("13800138000")).toBe(false);
  });

  it("类型按内容判断：声明成 png 的 SVG、GIF、文本都拒绝", async () => {
    await boot();
    const me = await newUser("li@example.com");
    for (const body of [
      Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"),
      Buffer.from("GIF89a\x01\x00\x01\x00"),
      Buffer.from("not an image"),
    ]) {
      const res = await upload(body, me);
      expect(res.statusCode).toBe(415);
      expect(res.json()).toMatchObject({ code: "unsupported_type" });
    }
    expect((await upload(Buffer.from("x"), me, "image/svg+xml")).statusCode).toBe(415);
  });

  it("超过大小上限拒绝", async () => {
    await boot();
    const me = await newUser("li@example.com");
    const res = await upload(Buffer.concat([makePng(), Buffer.alloc(IMAGE_LIMITS.maxBytes)]), me);
    expect(res.statusCode).toBe(413);
  });

  it("每个用户只留最近 30 张", async () => {
    await boot();
    const me = await newUser("li@example.com");
    const first = (await upload(makePng(), me)).json().id;
    for (let i = 0; i < IMAGE_LIMITS.perUser; i++) await upload(makePng(16 + i, 12), me);
    const rows = await handle.db.select().from(schema.userImages);
    expect(rows).toHaveLength(IMAGE_LIMITS.perUser);
    expect(
      (await app.inject({ method: "GET", url: `/api/v1/images/${first}`, headers: me })).statusCode,
    ).toBe(404);
  });

  it("按用户隔离：别人读不到、删不掉，也不能在消息里引用", async () => {
    await boot(fakeLlm([]));
    const me = await newUser("li@example.com");
    const other = await newUser("chen@example.com");
    const { id } = (await upload(makePng(), me)).json();
    expect(
      (await app.inject({ method: "GET", url: `/api/v1/images/${id}`, headers: other })).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: "DELETE", url: `/api/v1/images/${id}`, headers: other })).statusCode,
    ).toBe(404);
    const conv = (await app.inject({ method: "POST", url: "/api/v1/conversations", headers: other })).json()
      .id;
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conv}/messages`,
      headers: other,
      payload: { content: "照这个做", imageIds: [id] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "image_not_found" });
    expect((await app.inject({ method: "GET", url: `/api/v1/images/${id}`, headers: me })).statusCode).toBe(
      200,
    );
    expect(
      (await app.inject({ method: "DELETE", url: `/api/v1/images/${id}`, headers: me })).statusCode,
    ).toBe(204);
  });

  it("删除账号时图片一并删掉", async () => {
    await boot();
    const me = await newUser("li@example.com");
    const other = await newUser("chen@example.com");
    await upload(makePng(), me);
    await upload(makePng(), other);
    await handle.db.delete(schema.users).where(eq(schema.users.id, me["x-talksume-user"] ?? ""));
    const rows = await handle.db.select().from(schema.userImages);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.userId).toBe(other["x-talksume-user"]);
  });
});

describe("对话里带图", () => {
  it("图片只在发出的这一轮传给模型，之后只剩文字说明；消息里留着图片引用", async () => {
    await boot(
      fakeLlm([
        fauxAssistantMessage([fauxText("看到了，这是一份左侧深色的两栏简历。")]),
        fauxAssistantMessage([fauxText("好的。")]),
      ]),
    );
    const me = await newUser("li@example.com");
    const { id: imageId } = (await upload(makePng(), me)).json();
    const conv = (await app.inject({ method: "POST", url: "/api/v1/conversations", headers: me })).json().id;
    const send = (content: string, imageIds?: string[]) =>
      app.inject({
        method: "POST",
        url: `/api/v1/conversations/${conv}/messages`,
        headers: me,
        payload: { content, ...(imageIds && { imageIds }) },
      });
    const first = await send("这张图什么风格？", [imageId]);
    expect(parseSse(first.body).some((e) => e.event === "error")).toBe(false);
    expect(seen[0]).toContain('"type":"image"');

    seen.length = 0;
    await send("好的谢谢");
    expect(seen[0]).not.toContain('"type":"image"');
    expect(seen[0]).toContain("张图片");

    const detail = (
      await app.inject({ method: "GET", url: `/api/v1/conversations/${conv}`, headers: me })
    ).json();
    const userMsg = detail.messages.find((m: { images?: unknown[] }) => m.images);
    expect(userMsg.images).toEqual([{ id: imageId, mimeType: "image/png" }]);
  });

  it("复刻一轮走完：保存 CSS、预览（真渲染）把图片回给模型，样式落库且按它导出", async () => {
    const css =
      ".head { background: var(--accent); padding: 8mm } .head h1, .head .headline, .head .contacts { color: #fff }";
    await boot(
      fakeLlm([
        fauxAssistantMessage([fauxToolCall("set_resume_css", { css })], { stopReason: "toolUse" }),
        fauxAssistantMessage([fauxToolCall("preview_resume", {})], { stopReason: "toolUse" }),
        fauxAssistantMessage([fauxText("复刻了色块抬头，其余和参考图有差距。")]),
      ]),
    );
    const me = await newUser("li@example.com");
    const { id: imageId } = (await upload(makePng(), me)).json();
    const conv = (await app.inject({ method: "POST", url: "/api/v1/conversations", headers: me })).json().id;
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conv}/messages`,
      headers: me,
      payload: { content: "照这张图的风格做", imageIds: [imageId] },
    });
    const events = parseSse(res.body);
    expect(
      events.filter((e) => e.event === "style_progress").map((e) => `${e.data.stage}${e.data.round}`),
    ).toEqual(["styling1", "previewing1"]);
    expect(events.some((e) => e.event === "error")).toBe(false);
    const afterPreview = seen.at(-1) ?? "";
    expect(afterPreview).toContain('"type":"image"');
    expect(afterPreview).toContain("image/png");

    const style = (await app.inject({ method: "GET", url: "/api/v1/resume/style", headers: me })).json()
      .style;
    expect(style.css).toContain(".resume.resume .head{");
  });
});
