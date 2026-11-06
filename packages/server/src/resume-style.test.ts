import { createDb, migrate, schema } from "@talksume/db";
import { close } from "@talksume/resume-render";
import { afterAll, describe, expect, it } from "vitest";
import { loadResumeStyle, storeResumeStyler } from "./resume-style.ts";

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
