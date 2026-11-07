import { randomUUID } from "node:crypto";
import type { DesignOption, ResumeStyler } from "@talksume/agent";
import {
  applyCustomCss,
  applyThemePatch,
  clearCustomCss,
  directionById,
  type Profile,
  pickPalettes,
  profileToResume,
  type ResumeContent,
  type ResumeStyle,
  resolveResumeStyle,
  styleFromDesign,
  styleFromDirection,
} from "@talksume/core";
import { type Db, schema } from "@talksume/db";
import {
  atsCheck,
  auditStyle,
  maskContacts,
  renderPdf,
  renderResumePng,
  sampleResume,
} from "@talksume/resume-render";
import { eq, sql } from "drizzle-orm";
import { recordResumeStyleDesign, type StyleDesignSource } from "./style-designs.ts";

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
  audit?: typeof auditStyle;
  /** 导出成 PDF 再做网申可读性自检。 */
  ats?: (content: ResumeContent, style: ResumeStyle) => Promise<{ ok: boolean; issues: string[] }>;
  random?: () => number;
  record?: typeof recordResumeStyleDesign;
  log?: { warn: (obj: unknown, message: string) => void };
}

export function storeResumeStyler(db: Db, userId: string, options: StylerOptions = {}): ResumeStyler {
  const save = async (style: ResumeStyle) => {
    if (!(await saveResumeStyle(db, userId, style))) throw new Error("用户不存在");
  };
  const record = options.record ?? recordResumeStyleDesign;
  // 历史记录只是附加能力，写失败不能影响用户已经保存的样式
  const remember = async (style: ResumeStyle, source: StyleDesignSource, name?: string) => {
    try {
      await record(db, userId, style, source, name);
    } catch (error) {
      options.log?.warn({ err: error }, "resume style design record failed");
    }
  };
  const render = options.render ?? renderResumePng;
  const { profile } = options;
  const audit = options.audit ?? auditStyle;
  const random = options.random ?? Math.random;
  const ats =
    options.ats ??
    (async (content: ResumeContent, style: ResumeStyle) =>
      atsCheck(await renderPdf(content, style), content));
  return {
    async design(patch) {
      const change = applyThemePatch(await loadResumeStyle(db, userId), patch);
      if (!change) throw new Error("样式参数不合法");
      await save(change.style);
      await remember(change.style, "chat");
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
        await remember(style, "chat");
        return { ok: true, style, rules: 0, dropped: [] };
      }
      const result = applyCustomCss(current, css);
      if (!result.ok) return result;
      const mine = profile ? profileToResume(profile()) : sampleResume;
      const audited = await audit(mine.sections.length === 0 ? sampleResume : mine, result.style);
      if (!audited.ok) return { ok: false, errors: audited.problems };
      await save(result.style);
      await remember(result.style, "chat");
      return { ok: true, style: result.style, rules: result.rules, dropped: result.dropped };
    },
    async recentDirections() {
      const rows = await db.execute(sql`
        select o->>'direction' as direction
        from ${schema.messages} m
        join ${schema.conversations} c on c.id = m.conversation_id,
        jsonb_array_elements(m.metadata->'designs') o
        where c.user_id = ${userId} and m.metadata ? 'designs' and o->>'direction' is not null
        order by m.created_at desc
        limit 60`);
      const list = (Array.isArray(rows) ? rows : (rows as { rows: unknown[] }).rows) as {
        direction: string;
      }[];
      return [...new Set(list.map((r) => r.direction))];
    },
    async propose(designs) {
      const mine = profile ? profileToResume(profile()) : sampleResume;
      const content = maskContacts(mine.sections.length === 0 ? sampleResume : mine);
      const palettes = pickPalettes(
        designs.map((d) => (d.direction ? directionById(d.direction) : undefined)),
        random,
      );
      const settled = await Promise.all(
        designs.map(async (d, index) => {
          const direction = d.direction ? directionById(d.direction) : undefined;
          if (d.direction && !direction)
            return { index, errors: [`没有方向「${d.direction}」，只能用本轮候选里的方向 id`] };
          if (!direction && !d.theme) return { index, errors: ["要么给 direction，要么给完整的 theme"] };
          const built = direction
            ? styleFromDirection(direction, {
                ...(d.accent ? { accent: d.accent } : { palette: palettes[index] ?? 0 }),
              })
            : styleFromDesign(d.theme, d.css);
          if (!built.ok) return { index, errors: built.errors };
          const audited = await audit(content, built.style, { scale: 0.5, format: "jpeg" });
          if (!audited.ok) return { index, errors: audited.problems };
          const { pages, overflowX, hiddenText, overlaps, lowContrast, covered } = audited.check;
          const readable = await ats(content, built.style).catch(() => ({ ok: true, issues: [] }));
          const option: DesignOption = {
            id: randomUUID(),
            ...(direction && { direction: direction.id }),
            name: built.style.theme?.name ?? "设计",
            summary: d.summary ?? direction?.summary ?? built.style.theme?.name ?? "",
            style: built.style,
            thumbnail: `data:image/jpeg;base64,${Buffer.from(audited.image).toString("base64")}`,
            check: { pages, overflowX, hiddenText, overlaps, lowContrast, covered },
            ats: { ok: readable.ok, issues: readable.issues },
          };
          return { index, option, notes: built.notes };
        }),
      );
      const options = settled.flatMap((r) => ("option" in r ? [r.option] : []));
      // 顺序记录，避免同一轮里两版相同的样式在去重查询时互相看不见
      for (const option of options) await remember(option.style, "options", option.name);
      return {
        options,
        rejected: settled.flatMap((r) => ("errors" in r ? [{ index: r.index, errors: r.errors }] : [])),
      };
    },
    ...(profile && {
      async preview() {
        const style = await loadResumeStyle(db, userId);
        const mine = profileToResume(profile());
        // 资料还很少时用虚构示例，免得对着一张空白页比版式
        const content = mine.sections.length === 0 ? sampleResume : mine;
        const { png, check } = await render(maskContacts(content), style);
        const { pages, overflowX, hiddenText, overlaps, lowContrast, covered } = check;
        return { png, check: { pages, overflowX, hiddenText, overlaps, lowContrast, covered } };
      },
    }),
  };
}
