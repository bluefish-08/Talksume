import { applyTailoring, type TailorChange } from "@talksume/core";
import { useMemo } from "react";
import { ApiError } from "../../api/client.ts";
import type { ChangeMarks } from "../resume/ResumePreview.tsx";
import type { TailoringView } from "./queries.ts";
import { selectedChanges, useExcluded, usableChanges } from "./selection.ts";

const KIND_LABEL: Record<TailorChange["kind"], string> = {
  summary: "个人摘要",
  bullet: "要点措辞",
  bullet_order: "要点顺序",
  item_order: "经历顺序",
  skill_order: "技能顺序",
};

export const errorText = (e: unknown) => (e instanceof ApiError ? e.message : "操作失败，请稍后再试");

/** 预览里给每处改动挂上原文和编号；顺序类改动标在条目或分区标题上。 */
export function changeMarks(
  changes: readonly TailorChange[],
  numbers: ReadonlyMap<string, number> = new Map(),
): ChangeMarks {
  const marks = { bullets: new Map(), items: new Map(), sections: new Map() } satisfies ChangeMarks;
  let summary: ChangeMarks["summary"];
  for (const c of changes) {
    const number = numbers.get(c.id);
    if (c.kind === "summary")
      summary = {
        label: KIND_LABEL.summary,
        ...(number !== undefined && { number }),
        before: [c.before ?? "（原来没有摘要）"],
      };
    else if (c.kind === "bullet")
      marks.bullets.set(c.after.trim(), {
        label: KIND_LABEL.bullet,
        ...(number !== undefined && { number }),
        before: [c.before],
      });
    else if (c.kind === "bullet_order") {
      marks.items.set(c.heading, {
        label: KIND_LABEL.bullet_order,
        ...(number !== undefined && { number }),
        before: c.before.map((t, i) => `${i + 1}. ${t}`),
      });
    } else if (c.kind === "item_order") {
      marks.sections.set(c.section, {
        label: KIND_LABEL.item_order,
        ...(number !== undefined && { number }),
        before: [c.before.join(" → ")],
      });
    } else
      marks.sections.set("skills", {
        label: KIND_LABEL.skill_order,
        ...(number !== undefined && { number }),
        before: [c.before.join("、")],
      });
  }
  return summary ? { ...marks, summary } : marks;
}

type Draft = NonNullable<TailoringView["tailoring"]>;

export function useTailorDraft(jobId: string, draft: Draft) {
  const { off, toggle } = useExcluded(jobId, draft.updatedAt);
  const usable = useMemo(() => usableChanges(draft), [draft]);
  const chosen = useMemo(() => selectedChanges(draft, off), [draft, off]);
  const numbers = useMemo(() => new Map(usable.map((c, i) => [c.id, i + 1] as const)), [usable]);
  const preview = useMemo(() => applyTailoring(draft.base, chosen), [draft.base, chosen]);
  const marks = useMemo(() => changeMarks(chosen, numbers), [chosen, numbers]);
  return { usable, chosen, numbers, preview, marks, toggle };
}

export function changeTitle(c: TailorChange): string {
  if (c.kind === "summary" || c.kind === "skill_order") return KIND_LABEL[c.kind];
  if (c.kind === "item_order") return KIND_LABEL.item_order;
  return `${c.heading} · ${KIND_LABEL[c.kind]}`;
}
