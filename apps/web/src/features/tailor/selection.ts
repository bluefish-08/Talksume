import type { TailorChange } from "@talksume/core";
import { useCallback, useSyncExternalStore } from "react";
import type { TailoringView } from "./queries.ts";

type Draft = NonNullable<TailoringView["tailoring"]>;

const NONE: ReadonlySet<string> = new Set();
const excluded = new Map<string, ReadonlySet<string>>();
const listeners = new Set<() => void>();
const keyOf = (jobId: string, stamp: string) => `${jobId}|${stamp}`;

/** 采用前在界面上取消掉的改动；按生成时间分桶，重新生成后自动回到全选。 */
export function useExcluded(jobId: string, stamp: string | undefined) {
  const key = keyOf(jobId, stamp ?? "");
  const off = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => excluded.get(key) ?? NONE,
    () => NONE,
  );
  const toggle = useCallback(
    (id: string) => {
      const next = new Set(excluded.get(key) ?? NONE);
      if (!next.delete(id)) next.add(id);
      excluded.set(key, next);
      for (const fn of listeners) fn();
    },
    [key],
  );
  return { off, toggle };
}

export const usableChanges = (draft: Draft): TailorChange[] =>
  draft.changes.filter((c) => c.violations.length === 0);

/** 采用后以服务端为准；草稿阶段在服务端选中的基础上再去掉界面上取消的。 */
export function selectedChanges(draft: Draft, off: ReadonlySet<string>): TailorChange[] {
  const usable = usableChanges(draft);
  const picked = new Set(draft.selected);
  const base = draft.selected.length === 0 ? usable : usable.filter((c) => picked.has(c.id));
  const adopted = Boolean(draft.adopted && draft.selected.length > 0);
  return adopted ? base : base.filter((c) => !off.has(c.id));
}
