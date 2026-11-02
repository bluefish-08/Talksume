import { applyPolish } from "@talksume/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { api } from "../../api/client.ts";
import { qk } from "../../api/queries.ts";
import type { ResumeContent } from "../../api/types.ts";

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
