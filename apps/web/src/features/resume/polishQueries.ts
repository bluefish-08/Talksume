import { applyPolish } from "@talksume/core";
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { api } from "../../api/client.ts";
import { qk } from "../../api/queries.ts";
import type { ResumeContent } from "../../api/types.ts";
import type { PolishCard } from "../chat/types.ts";
import type { ChangeMarks } from "./ResumePreview.tsx";

export interface PolishEntry {
  itemKey: string;
  sectionKind: string;
  heading: string;
  subheading?: string;
  slot: number;
  text: string;
  sourceHash: string;
  factIds: string[];
  stale: boolean;
  polish: {
    id: string;
    suggestion: string;
    accepted: string | null;
    status: "pending" | "accepted" | "dismissed";
    violations: string[];
  } | null;
}

export interface PolishState {
  available: boolean;
  entries: PolishEntry[];
}

export type PolishAction = "accept" | "dismiss" | "revert";

export const POLISH_ASK_MESSAGE = "帮我润色一下简历";

// 挂在 resume 前缀下：对话一轮结束失效简历时，润色状态跟着刷新
export const polishKey = [...qk.resume, "polish"] as const;

export function usePolishState() {
  return useQuery({ queryKey: polishKey, queryFn: () => api.get<PolishState>("/api/v1/resume/polish") });
}

export function usePolishActions() {
  const client = useQueryClient();
  const settle = (state: PolishState) => {
    client.setQueryData(polishKey, { available: state.available, entries: state.entries });
    void client.invalidateQueries({ queryKey: qk.resume, exact: true });
  };
  const polish = useMutation({
    mutationFn: (targets?: Pick<PolishEntry, "itemKey" | "sourceHash">[]) =>
      api.post<PolishState>("/api/v1/resume/polish", targets ? { targets } : {}),
    onSuccess: settle,
  });
  const decide = useMutation({
    mutationFn: ({ ids, action }: { ids: string[]; action: PolishAction }) =>
      api.post<PolishState & { updated: number; rejected: number }>("/api/v1/resume/polish/decisions", {
        ids,
        action,
      }),
    onSuccess: settle,
  });
  return { polish, decide };
}

/** 对话页的简历来自会话快照，没经过服务端叠加，这里补上已采用的润色。 */
export function usePolishedResume(resume: ResumeContent): ResumeContent {
  const { data } = usePolishState();
  return useMemo(() => {
    const accepted = (data?.entries ?? []).flatMap((e) =>
      e.polish?.accepted ? [{ itemKey: e.itemKey, sourceHash: e.sourceHash, text: e.polish.accepted }] : [],
    );
    return applyPolish(resume, accepted);
  }, [resume, data]);
}

/** 流式 polish 事件只有卡片快照；先按它补缓存，再后台拉完整条目校准。 */
export function applyPolishUpdate(client: QueryClient, card: PolishCard): void {
  const current = client.getQueryData<PolishState>(polishKey);
  if (current) {
    const byId = new Map(card.items.map((item) => [item.id, item]));
    client.setQueryData<PolishState>(polishKey, {
      ...current,
      entries: current.entries.map((entry) => {
        const item = entry.polish && byId.get(entry.polish.id);
        if (!item || !entry.polish) return entry;
        return {
          ...entry,
          polish: {
            ...entry.polish,
            suggestion: item.after,
            accepted:
              item.state === "accepted"
                ? item.after
                : item.state === "dismissed"
                  ? null
                  : entry.polish.accepted,
            status: item.state,
            violations: item.violations ?? [],
          },
        };
      }),
    });
  }
  void client.invalidateQueries({ queryKey: polishKey });
  void client.invalidateQueries({ queryKey: qk.resume, exact: true });
}

export interface PolishPreview {
  /** 已叠加待定建议的简历。 */
  resume: ResumeContent;
  marks: ChangeMarks;
  /** 待定且可采用的建议数。 */
  pending: number;
  ids: string[];
}

/** 编号覆盖卡片里所有可采用的建议，和聊天卡片保持一致；只把待定的画到预览上。 */
export function buildPolishPreview(resume: ResumeContent, entries: readonly PolishEntry[]): PolishPreview {
  const numbers = new Map<string, number>();
  let n = 0;
  for (const entry of entries) {
    if (entry.polish && entry.polish.violations.length === 0) numbers.set(entry.polish.id, ++n);
  }
  const pending = entries.filter(
    (entry) => entry.polish?.status === "pending" && !entry.polish.violations.length,
  );
  const marks = new Map<string, { label: string; number?: number; before: string[] }>();
  for (const entry of pending) {
    const polish = entry.polish;
    if (!polish) continue;
    marks.set(polish.suggestion, {
      label: "润色",
      ...(numbers.has(polish.id) && { number: numbers.get(polish.id) }),
      before: [entry.text],
    });
  }
  return {
    resume: applyPolish(
      resume,
      pending.flatMap((entry) =>
        entry.polish
          ? [{ itemKey: entry.itemKey, sourceHash: entry.sourceHash, text: entry.polish.suggestion }]
          : [],
      ),
    ),
    marks: { bullets: marks, items: new Map(), sections: new Map() },
    pending: pending.length,
    ids: pending.flatMap((entry) => (entry.polish ? [entry.polish.id] : [])),
  };
}

export function usePolishPreview(resume: ResumeContent): PolishPreview {
  const { data } = usePolishState();
  return useMemo(() => buildPolishPreview(resume, data?.entries ?? []), [resume, data]);
}
