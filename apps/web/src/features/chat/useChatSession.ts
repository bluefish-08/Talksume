import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { ApiError, api } from "../../api/client.ts";
import { qk } from "../../api/queries.ts";
import { postSse } from "../../api/sse.ts";
import type { Completeness, ProfileSection, ResumeContent } from "../../api/types.ts";
import { useToast } from "../../components/Toast.tsx";
import { factsKey } from "../resume/queries.ts";
import { diffAdded } from "../resume/resumeUtils.ts";
import type { ChatMessage, Conflict, ConversationDetail, ProfileChange } from "./types.ts";

interface Frame {
  event: string;
  data: Record<string, unknown>;
}

const STOPPED = "已停止，这一句没有保存";
const LOST = "连接中断了，这一句没有保存";

let seq = 0;
const nextKey = () => `m${++seq}`;

function seed(detail: ConversationDetail): ChatMessage[] {
  return detail.messages.map((m) => ({
    key: m.id,
    serverId: m.id,
    role: m.role,
    text: m.content,
    asks: [],
    changes: [],
    state: "done",
  }));
}

/** 一场对话的全部客户端状态：消息、流式回复、简历与完整度快照。 */
export function useChatSession(detail: ConversationDetail) {
  const client = useQueryClient();
  const toast = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>(() => seed(detail));
  const [resume, setResume] = useState<ResumeContent>(detail.resume);
  const [completeness, setCompleteness] = useState<Completeness>(detail.completeness);
  const [focus, setFocus] = useState<ProfileSection | undefined>(
    () => (detail.completeness.missing.find((m) => m.required) ?? detail.completeness.missing[0])?.section,
  );
  const [conflicts, setConflicts] = useState<Conflict[]>(detail.conflicts);
  const [highlights, setHighlights] = useState<ReadonlySet<string>>(new Set());
  const [streaming, setStreaming] = useState(false);
  const [resolving, setResolving] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const resumeRef = useRef(resume);
  resumeRef.current = resume;
  const busy = useRef(false);

  const patch = useCallback((key: string, fn: (m: ChatMessage) => ChatMessage) => {
    setMessages((all) => all.map((m) => (m.key === key ? fn(m) : m)));
  }, []);

  const applyResume = useCallback((next: ResumeContent) => {
    setHighlights(diffAdded(resumeRef.current, next));
    setResume(next);
  }, []);

  const refreshShared = useCallback(() => {
    void client.invalidateQueries({ queryKey: qk.conversations });
    void client.invalidateQueries({ queryKey: qk.profile });
    void client.invalidateQueries({ queryKey: qk.resume });
    void client.invalidateQueries({ queryKey: factsKey });
  }, [client]);

  const run = useCallback(
    async (userKey: string, content: string) => {
      busy.current = true;
      setStreaming(true);
      const replyKey = nextKey();
      setMessages((all) => [
        ...all.map((m) => (m.key === userKey ? { ...m, state: "done" as const, error: undefined } : m)),
        { key: replyKey, role: "assistant", text: "", asks: [], changes: [], state: "streaming" },
      ]);
      const controller = new AbortController();
      abort.current = controller;

      let failure: string | undefined;
      let finished = false;
      try {
        for await (const { event, data } of postSse(
          `/api/v1/conversations/${detail.id}/messages`,
          { content },
          controller.signal,
        ) as AsyncIterable<Frame>) {
          switch (event) {
            case "token":
              patch(replyKey, (m) => ({ ...m, text: m.text + String(data.text ?? "") }));
              break;
            case "profile_patch":
              patch(replyKey, (m) => ({
                ...m,
                changes: [...m.changes, ...(data.changes as ProfileChange[])],
              }));
              break;
            case "ask": {
              const question = String(data.question ?? "");
              patch(replyKey, (m) =>
                m.text.includes(question) || m.asks.includes(question)
                  ? m
                  : { ...m, asks: [...m.asks, question] },
              );
              const conflict = data.conflict as Conflict | undefined;
              if (conflict) {
                setConflicts((all) =>
                  all.some((c) => c.factId === conflict.factId) ? all : [...all, conflict],
                );
              }
              break;
            }
            case "completeness":
              setCompleteness(data.completeness as Completeness);
              setFocus((data.nextSlot as { section: ProfileSection } | null)?.section);
              break;
            case "error":
              failure = String(data.message ?? "对话处理失败，请重试");
              break;
            case "done": {
              finished = true;
              const messageId = data.messageId as string | null;
              if (messageId) {
                const userId = messageId.replace(/:reply$/, "");
                setMessages((all) =>
                  all.map((m) =>
                    m.key === userKey
                      ? { ...m, serverId: userId }
                      : m.key === replyKey
                        ? { ...m, serverId: messageId, state: "done" }
                        : m,
                  ),
                );
                applyResume(data.resume as ResumeContent);
                if (failure) toast(failure, { tone: "error" });
                failure = undefined;
              } else {
                failure ??= "这一句没有保存，请重试";
              }
              break;
            }
          }
        }
        if (!finished) failure = LOST;
      } catch (error) {
        if (controller.signal.aborted) failure = STOPPED;
        else failure = error instanceof ApiError ? error.message : LOST;
      } finally {
        abort.current = null;
        busy.current = false;
        setStreaming(false);
      }

      if (failure) {
        setMessages((all) =>
          all
            .filter((m) => m.key !== replyKey)
            .map((m) => (m.key === userKey ? { ...m, state: "failed" as const, error: failure } : m)),
        );
      }
      refreshShared();
    },
    [applyResume, detail.id, patch, refreshShared, toast],
  );

  const send = useCallback(
    (text: string) => {
      const content = text.trim();
      if (!content || busy.current) return false;
      const key = nextKey();
      setHighlights(new Set());
      setMessages((all) => [
        ...all.filter((m) => m.state !== "failed"),
        { key, role: "user", text: content, asks: [], changes: [], state: "done" },
      ]);
      void run(key, content);
      return true;
    },
    [run],
  );

  const retry = useCallback(
    (key: string) => {
      if (busy.current) return;
      const target = messages.find((m) => m.key === key);
      if (!target) return;
      setHighlights(new Set());
      void run(key, target.text);
    },
    [messages, run],
  );

  const stop = useCallback(() => abort.current?.abort(), []);

  const resolveConflict = useCallback(
    async (conflict: Conflict, choice: "proposed" | "previous") => {
      setResolving(true);
      try {
        const res = await api.post<{
          events: { type: string; changes?: ProfileChange[]; question?: string }[];
          completeness: Completeness;
          resume: ResumeContent;
          conflicts: Conflict[];
        }>(`/api/v1/conversations/${detail.id}/conflicts/${encodeURIComponent(conflict.factId)}`, { choice });
        setCompleteness(res.completeness);
        setConflicts(res.conflicts);
        applyResume(res.resume);
        const changes = res.events.flatMap((e) => (e.type === "profile_patch" ? (e.changes ?? []) : []));
        const asks = res.events.flatMap((e) => (e.type === "ask" && e.question ? [e.question] : []));
        if (changes.length > 0 || asks.length > 0) {
          setMessages((all) => [
            ...all,
            { key: nextKey(), role: "assistant", text: "", asks, changes, state: "done" },
          ]);
        }
        refreshShared();
      } catch (error) {
        toast(error instanceof ApiError ? error.message : "操作失败，请稍后再试", { tone: "error" });
      } finally {
        setResolving(false);
      }
    },
    [applyResume, detail.id, refreshShared, toast],
  );

  return {
    messages,
    resume,
    completeness,
    conflicts,
    focus,
    highlights,
    streaming,
    resolving,
    send,
    retry,
    stop,
    resolveConflict,
  };
}
