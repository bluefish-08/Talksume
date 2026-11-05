import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { ApiError } from "../../api/client.ts";
import { qk } from "../../api/queries.ts";
import { postSse } from "../../api/sse.ts";
import type { Completeness, ProfileSection, ResumeContent } from "../../api/types.ts";
import { useToast } from "../../components/Toast.tsx";
import { factsKey } from "../resume/queries.ts";
import { diffAdded } from "../resume/resumeUtils.ts";
import { useModelChoice } from "./modelChoice.ts";
import type {
  ChatMessage,
  Conflict,
  ConversationDetail,
  JobCard,
  ProfileChange,
  TailorCard,
} from "./types.ts";

interface Frame {
  event: string;
  data: Record<string, unknown>;
}

let seq = 0;
const nextKey = () => `m${++seq}`;

// 标题在回复结束后由服务端异步生成，没有推送，按几个时间点重拉列表
const TITLE_REFETCH_MS = [1500, 4000, 9000];

function seed(detail: ConversationDetail): ChatMessage[] {
  return detail.messages.map((m) => ({
    key: m.id,
    serverId: m.id,
    role: m.role,
    text: m.content,
    asks: [],
    changes: m.changes ?? [],
    quickReplies: m.quickReplies ?? [],
    jobs: m.jobs ?? [],
    ...(m.about && { about: m.about }),
    ...(m.tailor && { tailor: m.tailor }),
    ...(m.resumeImport && { resumeImport: m.resumeImport }),
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
  const { choice } = useModelChoice();

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

  /** 发消息与解决矛盾共用的一轮流式回复：userKey 有值表示由这条用户消息触发。 */
  const stream = useCallback(
    async (path: string, body: unknown, userKey?: string) => {
      busy.current = true;
      setStreaming(true);
      const replyKey = nextKey();
      setMessages((all) => [
        ...all.map((m) => (m.key === userKey ? { ...m, state: "done" as const, error: undefined } : m)),
        {
          key: replyKey,
          role: "assistant",
          text: "",
          asks: [],
          changes: [],
          quickReplies: [],
          jobs: [],
          state: "streaming",
        },
      ]);
      const controller = new AbortController();
      abort.current = controller;
      const unit = userKey ? "这一句" : "这次选择";

      let failure: string | undefined;
      let finished = false;
      try {
        for await (const { event, data } of postSse(path, body, controller.signal) as AsyncIterable<Frame>) {
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
            case "jobs": {
              const incoming = (data.jobs as JobCard[] | undefined) ?? [];
              patch(replyKey, (m) => ({
                ...m,
                jobs: [
                  ...m.jobs.map((j) => incoming.find((n) => n.id === j.id) ?? j),
                  ...incoming.filter((n) => !m.jobs.some((j) => j.id === n.id)),
                ],
              }));
              break;
            }
            case "about_job":
              patch(replyKey, (m) => ({ ...m, about: data.job as JobCard }));
              break;
            case "tailor":
              patch(replyKey, (m) => ({ ...m, tailor: data.tailor as TailorCard }));
              break;
            case "ask": {
              const question = String(data.question ?? "");
              const quickReplies = Array.isArray(data.quickReplies) ? (data.quickReplies as string[]) : [];
              patch(replyKey, (m) => ({
                ...m,
                asks: data.inText || m.asks.includes(question) ? m.asks : [...m.asks, question],
                quickReplies,
              }));
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
              if (data.titlePending) {
                for (const ms of TITLE_REFETCH_MS) {
                  setTimeout(() => void client.invalidateQueries({ queryKey: qk.conversations }), ms);
                }
              }
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
                if (Array.isArray(data.conflicts)) setConflicts(data.conflicts as Conflict[]);
                if (failure) toast(failure, { tone: "error" });
                failure = undefined;
              } else {
                failure ??= `${unit}没有保存，请重试`;
              }
              break;
            }
          }
        }
        if (!finished) failure = `连接中断了，${unit}没有保存`;
      } catch (error) {
        if (controller.signal.aborted) failure = `已停止，${unit}没有保存`;
        else failure = error instanceof ApiError ? error.message : `连接中断了，${unit}没有保存`;
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
        if (!userKey) toast(failure, { tone: "error" });
      }
      refreshShared();
    },
    [applyResume, client, patch, refreshShared, toast],
  );

  const run = useCallback(
    (userKey: string, content: string) =>
      stream(`/api/v1/conversations/${detail.id}/messages`, { content, ...choice }, userKey),
    [detail.id, stream, choice],
  );

  const send = useCallback(
    (text: string) => {
      const content = text.trim();
      if (!content || busy.current) return false;
      const key = nextKey();
      setHighlights(new Set());
      setMessages((all) => [
        ...all.filter((m) => m.state !== "failed"),
        {
          key,
          role: "user",
          text: content,
          asks: [],
          changes: [],
          quickReplies: [],
          jobs: [],
          state: "done",
        },
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
      if (busy.current) return;
      setResolving(true);
      setHighlights(new Set());
      try {
        await stream(`/api/v1/conversations/${detail.id}/conflicts/${encodeURIComponent(conflict.factId)}`, {
          choice,
        });
      } finally {
        setResolving(false);
      }
    },
    [detail.id, stream],
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
