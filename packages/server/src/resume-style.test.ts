import { createDb, migrate, schema } from "@talksume/db";
import { close } from "@talksume/resume-render";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";
import { loadResumeStyle, storeResumeStyler } from "./resume-style.ts";
import {
  applyResumeStyleDesign,
  deleteResumeStyleDesign,
  listResumeStyleDesigns,
  MAX_STYLE_DESIGNS,
  recordResumeStyleDesign,
  styleKey,
} from "./style-designs.ts";

const handle = await createDb({ pglite: "memory://" });
await migrate(handle);
const [user] = await handle.db
  .insert(schema.users)
  .values({ email: "style-audit@example.com" })
  .returning({ id: schema.users.id });
const userId = (user as { id: string }).id;
afterAll(async () => {
  await close();
  await handle.close();
});

const styler = storeResumeStyler(handle.db, userId);
const cover =
  ".item::after { content: ''; position: absolute; top: 0; left: 0; width: 100%; height: 100%; background-color: #ffffff }";
const behind =
  ".head::after { content: ''; position: absolute; top: 0; right: 0; width: 40mm; height: 14mm; background-color: var(--accent-soft); clip-path: polygon(0 0, 100% 0, 100% 100%, 20% 100%); z-index: -1 }";

describe("setCss 保存前的渲染复核", () => {
  it("伪元素盖住文字：拒绝保存，样式不变", async () => {
    const r = await styler.setCss?.(cover);
    expect(r?.ok).toBe(false);
    if (r && !r.ok) expect(r.errors.join("")).toContain("盖住");
    expect((await loadResumeStyle(handle.db, userId)).css).toBeUndefined();
  });

  it("放在文字下面的装饰：保存", async () => {
    const r = await styler.setCss?.(behind);
    expect(r?.ok).toBe(true);
    expect((await loadResumeStyle(handle.db, userId)).css).toContain("clip-path");
  });
});

describe("propose 三版设计", () => {
  const theme = (name: string, skeleton: string) => ({
    name,
    accent: "#1d4ed8",
    bodyFont: "sans",
    headingFont: "sans",
    header: "plain",
    headerAlign: "left",
    headingStyle: "underline",
    layout: "single",
    skeleton,
    bullet: "dot",
    skills: "line",
    density: "auto",
  });

  it("并行渲染缩略图；有盖住文字的版本被拒绝，样式不保存", async () => {
    const before = await loadResumeStyle(handle.db, userId);
    const r = await styler.propose?.([
      { summary: "侧栏", theme: theme("侧栏", "side-left") },
      { summary: "时间线", theme: theme("时间线", "timeline"), css: behind },
      { summary: "盖住的", theme: theme("盖住", "cards"), css: cover },
    ]);
    expect(r?.options.map((o) => o.name)).toEqual(["侧栏", "时间线"]);
    expect(r?.options[0]?.thumbnail).toMatch(/^data:image\/jpeg;base64,/);
    expect(r?.rejected).toHaveLength(1);
    expect(r?.rejected[0]?.index).toBe(2);
    expect(r?.rejected[0]?.errors.join("")).toContain("盖住");
    expect(await loadResumeStyle(handle.db, userId)).toEqual(before);
  });

  it("主题不合法：整版拒绝", async () => {
    const r = await styler.propose?.([{ summary: "坏", theme: { name: "坏" } }]);
    expect(r?.options).toEqual([]);
    expect(r?.rejected[0]?.errors[0]).toContain("主题");
  });
});

const themeOf = (name: string) => ({
  name,
  accent: "#1d4ed8",
  bodyFont: "sans" as const,
  headingFont: "sans" as const,
  header: "plain" as const,
  headerAlign: "left" as const,
  headingStyle: "underline" as const,
  layout: "single" as const,
  bullet: "dot" as const,
  skills: "line" as const,
  density: "auto" as const,
});

async function clearHistory() {
  await handle.db.delete(schema.resumeStyleDesigns);
  await handle.db.update(schema.users).set({ resumeStyle: null }).where(eq(schema.users.id, userId));
}

describe("设计历史", () => {
  it("propose 的每一版都记录成 options 来源，未通过的版本不记录", async () => {
    await clearHistory();
    const r = await styler.propose?.([
      { summary: "a", theme: themeOf("第一版") },
      { summary: "b", theme: themeOf("第二版") },
      { summary: "坏", theme: { name: "坏" } },
    ]);
    expect(r?.options).toHaveLength(2);
    const rows = await listResumeStyleDesigns(handle.db, userId);
    expect(new Set(rows.map((row) => row.name))).toEqual(new Set(["第一版", "第二版"]));
    expect(rows.every((row) => row.source === "options")).toBe(true);
    expect(new Set(rows.map((row) => styleKey(row.style)))).toEqual(
      new Set(r?.options.map((option) => styleKey(option.style))),
    );
  }, 30_000);

  it("design 记录 chat 来源；reset 回到预设时不记录", async () => {
    await clearHistory();
    const { style } = await styler.design({ accent: "#166534", layout: "sidebar" });
    let rows = await listResumeStyleDesigns(handle.db, userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: style.theme?.name, source: "chat", style });
    await styler.reset();
    rows = await listResumeStyleDesigns(handle.db, userId);
    expect(rows).toHaveLength(1);
  });

  it("setCss 记录参考图复刻；清掉 CSS 回到预设后不再记录", async () => {
    await clearHistory();
    await styler.reset();
    const r = await styler.setCss?.(behind);
    expect(r?.ok).toBe(true);
    let rows = await listResumeStyleDesigns(handle.db, userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "参考图复刻", source: "chat" });
    expect(rows[0]?.style.css).toContain("clip-path");
    await styler.setCss?.(null);
    rows = await listResumeStyleDesigns(handle.db, userId);
    expect(rows).toHaveLength(1);
  });

  it("相同样式只留一条", async () => {
    await clearHistory();
    const style = { template: "tech" as const, accent: "teal" as const, theme: themeOf("去重") };
    expect(await recordResumeStyleDesign(handle.db, userId, style, "chat")).not.toBeNull();
    expect(await recordResumeStyleDesign(handle.db, userId, { ...style }, "options")).toBeNull();
    const rows = await listResumeStyleDesigns(handle.db, userId);
    expect(rows).toHaveLength(1);
  });

  it("最多保留 30 条，最旧的被删掉", async () => {
    await clearHistory();
    for (let i = 0; i < MAX_STYLE_DESIGNS + 1; i++) {
      await recordResumeStyleDesign(
        handle.db,
        userId,
        { template: "tech", accent: "teal", theme: themeOf(`第${i}版`) },
        "chat",
      );
    }
    const rows = await handle.db
      .select({ name: schema.resumeStyleDesigns.name })
      .from(schema.resumeStyleDesigns)
      .where(eq(schema.resumeStyleDesigns.userId, userId));
    expect(rows).toHaveLength(MAX_STYLE_DESIGNS);
    expect(rows.map((row) => row.name)).not.toContain("第0版");
    expect(rows.map((row) => row.name)).toContain(`第${MAX_STYLE_DESIGNS}版`);
  });

  it("老用户当前定制样式没有历史时，列出会补到最前面且不重复", async () => {
    await clearHistory();
    const style = { template: "modern" as const, accent: "wine" as const, theme: themeOf("老设计") };
    await handle.db.update(schema.users).set({ resumeStyle: style }).where(eq(schema.users.id, userId));
    const first = await listResumeStyleDesigns(handle.db, userId);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ name: "老设计", source: "chat", style });
    const second = await listResumeStyleDesigns(handle.db, userId);
    expect(second).toHaveLength(1);
    expect(second[0]?.id).toBe(first[0]?.id);
  });

  it("正在使用的设计不能删；换回预设后可以删，删除不改样式", async () => {
    await clearHistory();
    const style = { template: "tech" as const, accent: "teal" as const, theme: themeOf("要应用的") };
    const saved = await recordResumeStyleDesign(handle.db, userId, style, "options");
    expect(saved).not.toBeNull();
    const applied = await applyResumeStyleDesign(handle.db, userId, saved?.id ?? "");
    expect(applied?.theme?.name).toBe("要应用的");
    expect((await loadResumeStyle(handle.db, userId)).theme?.name).toBe("要应用的");
    expect(await deleteResumeStyleDesign(handle.db, userId, saved?.id ?? "")).toBe("current");
    expect((await loadResumeStyle(handle.db, userId)).theme?.name).toBe("要应用的");
    await styler.reset();
    expect(await deleteResumeStyleDesign(handle.db, userId, saved?.id ?? "")).toBe("deleted");
    expect((await loadResumeStyle(handle.db, userId)).theme).toBeUndefined();
    expect(await deleteResumeStyleDesign(handle.db, userId, saved?.id ?? "")).toBe("not_found");
  });

  it("记录失败只记日志，样式保存照常成功", async () => {
    await clearHistory();
    const log = { warn: vi.fn() };
    const failing = storeResumeStyler(handle.db, userId, {
      log,
      record: async () => {
        throw new Error("history down");
      },
    });
    const { style } = await failing.design({ accent: "#166534", layout: "sidebar" });
    expect(style.theme?.accent).toBe("#166534");
    expect((await loadResumeStyle(handle.db, userId)).theme?.accent).toBe("#166534");
    expect(log.warn).toHaveBeenCalledWith({ err: expect.any(Error) }, "resume style design record failed");
  });
});
