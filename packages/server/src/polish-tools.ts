import type {
  PolishCard,
  PolishCardItem,
  PolishDecisionOptions,
  PolishOptions,
  PolishOutcome,
  ResumePolisher,
} from "@talksume/agent";
import { type Profile, profileToResume } from "@talksume/core";
import type { Db } from "@talksume/db";
import { polishTargetsWithLlm, type StructuredLlm } from "./polish-llm.ts";
import {
  decidePolishes,
  loadPolishRows,
  type PolishEntry,
  polishEntries,
  savePolishOutcomes,
  splitPolishOutcomes,
} from "./polish-store.ts";

type PolishRow = Awaited<ReturnType<typeof loadPolishRows>>[number];

// 没有显式注入 busy 时按 db 共享，REST 和对话工具仍会互相挡住
const busyByDb = new WeakMap<Db, Set<string>>();

export function polishBusyFor(db: Db): Set<string> {
  let busy = busyByDb.get(db);
  if (!busy) {
    busy = new Set<string>();
    busyByDb.set(db, busy);
  }
  return busy;
}

export class PolishBusyError extends Error {
  constructor() {
    super("上一次润色还没完成，请稍后再试");
  }
}

export function clipPolish(text: string, limit: number): string {
  const chars = Array.from(text.trim());
  return chars.length > limit ? `${chars.slice(0, limit).join("")}…` : chars.join("");
}

const STATE_LABEL = { pending: "待定", accepted: "已采用", dismissed: "不要" } as const;

export function polishItemLine(item: PolishCardItem): string {
  if (item.blocked)
    return `- ${item.heading} [${item.id}]：不能用（没改：${(item.violations ?? []).join("、")} 你没说过）`;
  return `- ${item.number}. ${item.heading}：「${clipPolish(item.before, 12)}」→「${clipPolish(item.after, 20)}」 [${item.id}]：${STATE_LABEL[item.state]}`;
}

/** 有采用的、还有未处理（含被拦下）的就是部分采用。 */
export function polishStatus(items: readonly PolishCardItem[]): NonNullable<PolishCard["status"]> {
  const accepted = items.some((item) => !item.blocked && item.state === "accepted");
  const pending = items.some((item) => item.state === "pending");
  if (accepted) return pending ? "partial" : "adopted";
  const live = items.filter((item) => !item.blocked);
  return live.length > 0 && live.every((item) => item.state === "dismissed") ? "none" : "draft";
}

/** 当前所有已生成建议的行按简历顺序排成卡片；编号和右侧预览一致。 */
export function polishCardOf(entries: readonly PolishEntry[], kind?: PolishCard["kind"]): PolishCard {
  let number = 0;
  const items = entries.flatMap((entry): PolishCardItem[] => {
    const polish = entry.polish;
    if (!polish) return [];
    const blocked = polish.violations.length > 0;
    if (!blocked) number++;
    return [
      {
        id: polish.id,
        ...(blocked ? {} : { number }),
        heading: entry.heading,
        before: entry.text,
        after: polish.status === "accepted" ? (polish.accepted ?? polish.suggestion) : polish.suggestion,
        state: polish.status,
        blocked,
        ...(blocked && { violations: polish.violations }),
      },
    ];
  });
  return {
    ...(kind && { kind }),
    status: polishStatus(items),
    items,
  };
}

function uniqueHeadings(entries: readonly PolishEntry[]): string[] {
  return [...new Set(entries.map((entry) => entry.heading))];
}

function matchItems(
  entries: readonly PolishEntry[],
  names: readonly string[],
): { picked: PolishEntry[]; unknown: string[] } {
  const picked = new Set<PolishEntry>();
  const unknown: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    let hits = entries.filter((entry) => entry.heading.trim() === name);
    if (hits.length === 0)
      hits = entries.filter((entry) => entry.heading.includes(name) || name.includes(entry.heading));
    if (hits.length === 0) unknown.push(raw);
    else for (const entry of hits) picked.add(entry);
  }
  return { picked: [...picked], unknown: [...new Set(unknown)] };
}

async function snapshot(db: Db, userId: string, profile: Profile, kind?: PolishCard["kind"]) {
  const rows = await loadPolishRows(db, userId);
  const entries = polishEntries(profileToResume(profile), rows);
  const card = polishCardOf(entries, kind);
  return { card, entries };
}

const linesOf = (card: PolishCard) => card.items.map(polishItemLine);

export function polishIdsForAll(
  rows: readonly PolishRow[],
  action: "accept" | "dismiss" | "revert",
): string[] {
  if (action === "revert")
    return rows.filter((row) => row.status === "accepted" && !!row.accepted).map((row) => row.id);
  return rows
    .filter((row) => row.status === "pending" && (action === "dismiss" || row.violations.length === 0))
    .map((row) => row.id);
}

/** 对话里的润色：复用 REST 的落库、校验和决策逻辑。 */
export function storeResumePolisher(
  db: Db,
  llm: StructuredLlm,
  userId: string,
  busy: Set<string> = polishBusyFor(db),
): ResumePolisher {
  return {
    async polish(profile: Profile, options: PolishOptions): Promise<PolishOutcome> {
      if (busy.has(userId)) throw new PolishBusyError();
      const { entries } = await snapshot(db, userId, profile);
      const headings = uniqueHeadings(entries);
      const wanted = options.items?.filter((name) => name.trim().length > 0) ?? [];
      const { picked, unknown } =
        wanted.length > 0
          ? matchItems(entries, wanted)
          : {
              picked: entries.filter((entry) => !entry.polish || entry.polish.status === "dismissed"),
              unknown: [],
            };
      if (picked.length === 0) {
        return {
          card: polishCardOf(entries, "generation"),
          lines: [],
          polished: 0,
          ...(unknown.length > 0 && { unknownItems: unknown }),
          headings,
        };
      }

      const previous = new Map(
        picked.flatMap((entry) =>
          entry.polish ? [[entry.sourceHash, entry.polish.suggestion] as const] : [],
        ),
      );
      busy.add(userId);
      try {
        const outcomes = await polishTargetsWithLlm(llm, picked, {
          ...(previous.size > 0 && { previous }),
          ...(options.instruction && { instruction: options.instruction }),
        });
        const { changed, noops } = splitPolishOutcomes(outcomes);
        await savePolishOutcomes(db, userId, changed);
        const noopItems = noops.map((outcome) => ({
          heading: outcome.target.heading,
          before: outcome.target.text,
        }));
        const next = await snapshot(db, userId, profile, "generation");
        return {
          card: next.card,
          lines: linesOf(next.card),
          polished: changed.length,
          ...(noopItems.length > 0 && { noopItems }),
          ...(unknown.length > 0 && { unknownItems: unknown }),
          headings: uniqueHeadings(next.entries),
        };
      } finally {
        busy.delete(userId);
      }
    },

    async decide(profile: Profile, options: PolishDecisionOptions): Promise<PolishOutcome> {
      const rows = await loadPolishRows(db, userId);
      const byId = new Map(rows.map((row) => [row.id, row]));
      const groups: Record<"accept" | "dismiss" | "revert", Set<string>> = {
        accept: new Set(),
        dismiss: new Set(),
        revert: new Set(),
      };
      const explicit: string[] = [];

      if (options.all) {
        for (const id of polishIdsForAll(rows, options.all)) groups[options.all].add(id);
      }
      for (const action of ["accept", "dismiss", "revert"] as const) {
        for (const id of options[action] ?? []) {
          groups[action].add(id);
          explicit.push(id);
        }
      }

      const unknownIds = [...new Set(explicit)].filter((id) => !byId.has(id));
      const blocked = new Set<string>();
      if (options.all === "accept") {
        for (const row of rows)
          if (row.status === "pending" && row.violations.length > 0) blocked.add(row.id);
      }
      for (const id of groups.accept) {
        const row = byId.get(id);
        if (row && row.violations.length > 0) blocked.add(id);
      }

      for (const action of ["accept", "dismiss", "revert"] as const) {
        const ids = [...groups[action]];
        if (ids.length > 0) await decidePolishes(db, userId, ids, action);
      }

      const next = await snapshot(db, userId, profile, "update");
      return {
        card: next.card,
        lines: linesOf(next.card),
        polished: 0,
        ...(unknownIds.length > 0 && { unknownIds }),
        ...(blocked.size > 0 && { blockedIds: [...blocked] }),
      };
    },
  };
}
