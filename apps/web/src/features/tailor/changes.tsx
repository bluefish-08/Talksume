import { applyTailoring, type TailorChange } from "@talksume/core";
import { useMemo, useState } from "react";
import { ApiError } from "../../api/client.ts";
import type { ChangeMarks } from "../resume/ResumePreview.tsx";
import styles from "./changes.module.css";
import type { TailoringView } from "./queries.ts";

const KIND_LABEL: Record<TailorChange["kind"], string> = {
  summary: "个人摘要",
  bullet: "要点措辞",
  bullet_order: "要点顺序",
  item_order: "经历顺序",
  skill_order: "技能顺序",
};

const SECTION_LABEL = { experiences: "实习与工作经历", projects: "项目经历" } as const;

export const errorText = (e: unknown) => (e instanceof ApiError ? e.message : "操作失败，请稍后再试");

export function titleOf(c: TailorChange): string {
  if (c.kind === "bullet" || c.kind === "bullet_order") return `${KIND_LABEL[c.kind]} · ${c.heading}`;
  if (c.kind === "item_order") return `${SECTION_LABEL[c.section]}顺序`;
  return KIND_LABEL[c.kind];
}

function Marked({ text, marks }: { text: string; marks: string[] }) {
  if (marks.length === 0) return <>{text}</>;
  const pattern = new RegExp(
    `(${marks.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "g",
  );
  return (
    <>
      {text.split(pattern).map((part, i) =>
        marks.includes(part) ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: 切分结果顺序固定
          <mark key={i} className={styles.bad}>
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}

export function Diff({ change }: { change: TailorChange }) {
  if (change.kind === "summary" || change.kind === "bullet") {
    return (
      <>
        <p className={styles.before}>
          <span className={styles.tag}>原版</span>
          {change.before ?? "（无）"}
        </p>
        <p className={styles.after} data-bad={change.violations.length > 0 || undefined}>
          <span className={styles.tag}>定制</span>
          <span>
            <Marked text={change.after} marks={change.violations} />
          </span>
        </p>
      </>
    );
  }
  const separator = change.kind === "skill_order" ? "、" : " → ";
  if (change.kind === "bullet_order") {
    return (
      <div className={styles.orders}>
        {(["before", "after"] as const).map((side) => (
          <div key={side}>
            <span className={styles.tag}>{side === "before" ? "原版" : "定制"}</span>
            <ol className={styles.ol}>
              {change[side].map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    );
  }
  return (
    <>
      <p className={styles.before}>
        <span className={styles.tag}>原版</span>
        {change.before.join(separator)}
      </p>
      <p className={styles.after}>
        <span className={styles.tag}>定制</span>
        {change.after.join(separator)}
      </p>
    </>
  );
}

/** 预览里给每处改动挂上原文；顺序类改动标在条目或分区标题上。 */
export function changeMarks(changes: readonly TailorChange[]): ChangeMarks {
  const marks = { bullets: new Map(), items: new Map(), sections: new Map() } satisfies ChangeMarks;
  let summary: ChangeMarks["summary"];
  for (const c of changes) {
    if (c.kind === "summary")
      summary = { label: KIND_LABEL.summary, before: [c.before ?? "（原来没有摘要）"] };
    else if (c.kind === "bullet")
      marks.bullets.set(c.after.trim(), { label: KIND_LABEL.bullet, before: [c.before] });
    else if (c.kind === "bullet_order") {
      marks.items.set(c.heading, {
        label: KIND_LABEL.bullet_order,
        before: c.before.map((t, i) => `${i + 1}. ${t}`),
      });
    } else if (c.kind === "item_order") {
      marks.sections.set(c.section, { label: KIND_LABEL.item_order, before: [c.before.join(" → ")] });
    } else marks.sections.set("skills", { label: KIND_LABEL.skill_order, before: [c.before.join("、")] });
  }
  return summary ? { ...marks, summary } : marks;
}

type Draft = NonNullable<TailoringView["tailoring"]>;

/** 勾选状态以上次采用的为准，没采用过就默认全选可用的调整。 */
export function useTailorDraft(draft: Draft) {
  const usable = useMemo(() => draft.changes.filter((c) => c.violations.length === 0), [draft.changes]);
  const [picked, setPicked] = useState<ReadonlySet<string>>(
    () => new Set(draft.selected.length > 0 ? draft.selected : usable.map((c) => c.id)),
  );
  const chosen = useMemo(() => usable.filter((c) => picked.has(c.id)), [usable, picked]);
  const preview = useMemo(() => applyTailoring(draft.base, chosen), [draft.base, chosen]);
  const marks = useMemo(() => changeMarks(chosen), [chosen]);
  const toggle = (id: string) =>
    setPicked((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  return { usable, picked, toggle, chosen, preview, marks };
}
