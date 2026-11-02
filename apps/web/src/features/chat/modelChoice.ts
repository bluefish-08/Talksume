import { useQuery } from "@tanstack/react-query";
import { useMemo, useSyncExternalStore } from "react";
import { api } from "../../api/client.ts";
import { qk } from "../../api/queries.ts";

export interface LlmModelOption {
  id: string;
  label: string;
  hint: string;
}

export interface LlmChoice {
  model: string;
  thinking: boolean;
}

export interface LlmOptions {
  models: LlmModelOption[];
  default: LlmChoice;
}

const STORAGE_KEY = "talksume.llmChoice";
const listeners = new Set<() => void>();

function load(): Partial<LlmChoice> {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, unknown>;
    return {
      ...(typeof raw.model === "string" && { model: raw.model }),
      ...(typeof raw.thinking === "boolean" && { thinking: raw.thinking }),
    };
  } catch {
    return {};
  }
}

let stored = load();

function save(next: Partial<LlmChoice>) {
  stored = { ...stored, ...next };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {}
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useLlmOptions() {
  return useQuery({
    queryKey: qk.llmOptions,
    queryFn: () => api.get<LlmOptions>("/api/v1/llm/options"),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}

/** 选项没拉到时 choice 为 undefined，消息里不带 model/thinking，由服务端用默认值。 */
export function useModelChoice() {
  const options = useLlmOptions().data;
  const saved = useSyncExternalStore(subscribe, () => stored);
  const choice = useMemo<LlmChoice | undefined>(
    () =>
      options && {
        model: options.models.some((m) => m.id === saved.model)
          ? (saved.model as string)
          : options.default.model,
        thinking: saved.thinking ?? options.default.thinking,
      },
    [options, saved],
  );
  return { options, choice, setChoice: save };
}
