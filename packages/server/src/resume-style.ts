import type { ResumeStyler } from "@talksume/agent";
import {
  applyCustomCss,
  applyThemePatch,
  clearCustomCss,
  type Profile,
  profileToResume,
  type ResumeStyle,
  resolveResumeStyle,
} from "@talksume/core";
import { type Db, schema } from "@talksume/db";
import { maskContacts, renderResumePng, sampleResume } from "@talksume/resume-render";
import { eq } from "drizzle-orm";

export async function loadResumeStyle(db: Db, userId: string): Promise<ResumeStyle> {
  const [row] = await db
    .select({ style: schema.users.resumeStyle })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  return resolveResumeStyle(row?.style);
}

export async function saveResumeStyle(db: Db, userId: string, style: ResumeStyle): Promise<boolean> {
  const updated = await db
    .update(schema.users)
    .set({ resumeStyle: style })
    .where(eq(schema.users.id, userId))
    .returning({ id: schema.users.id });
  return updated.length > 0;
}

export interface StylerOptions {
  /** 预览用的画像；对话进行中它可能比库里新。不传则没有预览能力。 */
  profile?: () => Profile;
  render?: typeof renderResumePng;
}

export function storeResumeStyler(db: Db, userId: string, options: StylerOptions = {}): ResumeStyler {
  const save = async (style: ResumeStyle) => {
    if (!(await saveResumeStyle(db, userId, style))) throw new Error("用户不存在");
  };
  const render = options.render ?? renderResumePng;
  const { profile } = options;
  return {
    async design(patch) {
      const change = applyThemePatch(await loadResumeStyle(db, userId), patch);
      if (!change) throw new Error("样式参数不合法");
      await save(change.style);
      return change;
    },
    async reset() {
      const { template, accent } = await loadResumeStyle(db, userId);
      const style = { template, accent };
      await save(style);
      return style;
    },
    async setCss(css) {
      const current = await loadResumeStyle(db, userId);
      if (css === null) {
        const style = clearCustomCss(current);
        await save(style);
        return { ok: true, style, rules: 0, dropped: [] };
      }
      const result = applyCustomCss(current, css);
      if (!result.ok) return result;
      await save(result.style);
      return { ok: true, style: result.style, rules: result.rules, dropped: result.dropped };
    },
    ...(profile && {
      async preview() {
        const style = await loadResumeStyle(db, userId);
        const mine = profileToResume(profile());
        // 资料还很少时用虚构示例，免得对着一张空白页比版式
        const content = mine.sections.length === 0 ? sampleResume : mine;
        const { png, check } = await render(maskContacts(content), style);
        const { pages, overflowX, hiddenText, overlaps, lowContrast } = check;
        return { png, check: { pages, overflowX, hiddenText, overlaps, lowContrast } };
      },
    }),
  };
}
