import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Maximize2, PanelRightClose, SquarePen } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { ApiError, api } from "../../api/client.ts";
import { qk, useConversations } from "../../api/queries.ts";
import type { Completeness, ResumeContent } from "../../api/types.ts";
import { useToast } from "../../components/Toast.tsx";
import { Button, Chip, IconButton, Spinner } from "../../components/ui.tsx";
import { usePolishedResume } from "../resume/polishQueries.ts";
import type { ResumeSuggestion } from "../resume/workbench.ts";
import { useResumeImport } from "../resume-import/useResumeImport.tsx";
import { tailoringKey } from "../tailor/queries.ts";
import styles from "./ChatPanel.module.css";
import { Composer } from "./Composer.tsx";
import { MessageList } from "./MessageList.tsx";
import type { ConversationDetail, TailorCard } from "./types.ts";
import { useChatSession } from "./useChatSession.ts";
import { REPLICA_DEFAULT_TEXT, useImageDraft } from "./useImageDraft.ts";
import { useStickToBottom } from "./useStickToBottom.ts";

/** 面板里会话的最新简历快照，供页面左侧预览实时展示。 */
export interface LiveResume {
  resume: ResumeContent;
  completeness: Completeness;
  highlights: ReadonlySet<string>;
}

export interface PanelRequest {
  id: number;
  text: string;
}

interface Props {
  /** 面板被收起时仍保持挂载，展开后需要重新贴底。 */
  visible: boolean;
  /** 会话还没有用户消息时展示的快捷提示，点了直接发送。 */
  prompts: readonly string[];
  /** 「还可以补充」建议，会话还没有用户消息时和快捷提示一起展示。 */
  suggestions: readonly ResumeSuggestion[];
  /** 页面要求发送的消息，id 变化才算一次新请求。 */
  request: PanelRequest | null;
  onLive: (live: LiveResume | null) => void;
  /** 定制卡片被点开，或本轮刚生成了定制版；页面负责在简历预览里展示。 */
  onOpenTailor: (card: TailorCard) => void;
  onClose: () => void;
}

export function ChatPanel({ visible, prompts, suggestions, request, onLive, onOpenTailor, onClose }: Props) {
  const client = useQueryClient();
  const toast = useToast();
  const conversations = useConversations();
  const [chosen, setChosen] = useState<string | null>(null);
  const [queued, setQueued] = useState<PanelRequest | null>(null);
  const latest = conversations.data?.[0]?.id;
  const id = chosen ?? latest;
  const importer = useResumeImport(id);

  // 锁定进入页面时的最近会话，避免列表重排后面板跳到别的会话
  useEffect(() => {
    if (!chosen && latest) setChosen(latest);
  }, [chosen, latest]);

  const create = useMutation({
    mutationFn: () => api.post<{ id: string }>("/api/v1/conversations"),
    onSuccess: ({ id: created }) => {
      void client.invalidateQueries({ queryKey: qk.conversations });
      setChosen(created);
    },
    onError: (error) => toast(error.message, { tone: "error" }),
  });

  const detail = useQuery({
    queryKey: ["conversation-detail", id],
    queryFn: () => api.get<ConversationDetail>(`/api/v1/conversations/${encodeURIComponent(id ?? "")}`),
    enabled: !!id,
    gcTime: 0,
    staleTime: Number.POSITIVE_INFINITY,
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 1,
  });

  const enqueue = (text: string) => {
    setQueued({ id: Date.now(), text });
    if (!id && !create.isPending) create.mutate();
  };

  const handled = useRef<number | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 只响应新的请求 id
  useEffect(() => {
    if (!request || handled.current === request.id) return;
    handled.current = request.id;
    enqueue(request.text);
  }, [request?.id]);

  const title = conversations.data?.find((c) => c.id === id)?.title ?? detail.data?.title ?? "新对话";
  const loadingList = conversations.isPending;
  const noConversation = !loadingList && !id;

  return (
    <aside className={styles.panel} aria-label="AI 助手">
      <header className={styles.head}>
        <div className={styles.heading}>
          <span className={styles.kicker}>AI 助手</span>
          <span className={styles.title}>{noConversation ? "新对话" : title}</span>
        </div>
        <IconButton
          label="新对话"
          disabled={create.isPending}
          onClick={() => {
            setQueued(null);
            create.mutate();
          }}
        >
          <SquarePen size={16} strokeWidth={1.7} aria-hidden="true" />
        </IconButton>
        {id && (
          <Link to={`/c/${id}`} className={styles.iconLink} aria-label="打开完整对话" title="打开完整对话">
            <Maximize2 size={15} strokeWidth={1.7} aria-hidden="true" />
          </Link>
        )}
        <IconButton label="收起对话" onClick={onClose}>
          <PanelRightClose size={17} strokeWidth={1.7} aria-hidden="true" />
        </IconButton>
      </header>

      {detail.data ? (
        <PanelSession
          key={detail.data.id}
          detail={detail.data}
          visible={visible}
          prompts={prompts}
          suggestions={suggestions}
          queued={queued}
          onConsumed={() => setQueued(null)}
          onLive={onLive}
          onAttach={() => importer.open()}
          onOpenTailor={onOpenTailor}
        />
      ) : noConversation ? (
        <PanelStart
          prompts={prompts}
          suggestions={suggestions}
          pending={create.isPending}
          onSend={enqueue}
          onAttach={() => importer.open()}
        />
      ) : detail.isError ? (
        <div className={styles.center}>
          <p className={styles.note}>对话加载失败</p>
          <Button size="sm" onClick={() => void detail.refetch()}>
            重试
          </Button>
        </div>
      ) : (
        <div className={styles.center}>
          <Spinner />
        </div>
      )}
      {importer.dialog}
    </aside>
  );
}

function Prompts({
  label = "可以这样问",
  items,
  onPick,
}: {
  label?: string;
  items: readonly { key: string; label: string; text: string }[];
  onPick: (text: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className={styles.prompts}>
      <span className={styles.promptsLabel}>{label}</span>
      {items.map((p) => (
        <Chip key={p.key} className={styles.prompt} onClick={() => onPick(p.text)}>
          {p.label}
        </Chip>
      ))}
    </div>
  );
}

function StarterPrompts({
  prompts,
  suggestions,
  onPick,
}: {
  prompts: readonly string[];
  suggestions: readonly ResumeSuggestion[];
  onPick: (text: string) => void;
}) {
  return (
    <>
      <Prompts
        label="还可以补充"
        items={suggestions.map((s) => ({ key: s.key, label: s.title, text: s.prompt }))}
        onPick={onPick}
      />
      <Prompts items={prompts.map((p) => ({ key: p, label: p, text: p }))} onPick={onPick} />
    </>
  );
}

function PanelStart({
  prompts,
  suggestions,
  pending,
  onSend,
  onAttach,
}: {
  prompts: readonly string[];
  suggestions: readonly ResumeSuggestion[];
  pending: boolean;
  onSend: (text: string) => void;
  onAttach: () => void;
}) {
  const [draft, setDraft] = useState("");
  return (
    <>
      <div className={styles.scroll}>
        <p className={styles.intro}>想怎么改简历？直接告诉我，改动会实时出现在左边。</p>
        <StarterPrompts prompts={prompts} suggestions={suggestions} onPick={onSend} />
      </div>
      <div className={styles.composer}>
        <Composer
          variant="chat"
          label="对助手说"
          placeholder="比如：把项目经历写得更突出结果"
          rows={2}
          value={draft}
          onChange={setDraft}
          pending={pending}
          onAttach={onAttach}
          onSubmit={() => {
            onSend(draft.trim());
            setDraft("");
          }}
        />
      </div>
    </>
  );
}

function PanelSession({
  detail,
  visible,
  prompts,
  suggestions,
  queued,
  onConsumed,
  onLive,
  onAttach,
  onOpenTailor,
}: {
  detail: ConversationDetail;
  visible: boolean;
  prompts: readonly string[];
  suggestions: readonly ResumeSuggestion[];
  queued: PanelRequest | null;
  onConsumed: () => void;
  onLive: (live: LiveResume | null) => void;
  onAttach: () => void;
  onOpenTailor: (card: TailorCard) => void;
}) {
  const session = useChatSession(detail);
  const resume = usePolishedResume(session.resume);
  const { messages, send } = session;
  const [draft, setDraft] = useState("");
  const imageDraft = useImageDraft();
  const scroller = useStickToBottom(messages, session.conflicts, visible);
  const consumed = useRef<number | null>(null);

  useEffect(() => {
    onLive({ resume, completeness: session.completeness, highlights: session.highlights });
  }, [onLive, resume, session.completeness, session.highlights]);
  useEffect(() => () => onLive(null), [onLive]);

  const client = useQueryClient();
  const live = messages.at(-1);
  const liveTailor = live?.state === "streaming" ? live.tailor : undefined;
  useEffect(() => {
    if (!liveTailor) return;
    void client.invalidateQueries({ queryKey: tailoringKey(liveTailor.jobId) });
    onOpenTailor(liveTailor);
  }, [liveTailor, client, onOpenTailor]);

  // StrictMode 会把 effect 跑两遍，ref 保证同一请求只发一次；助手还在回复时先放进输入框
  useEffect(() => {
    if (!queued || consumed.current === queued.id) return;
    consumed.current = queued.id;
    scroller.pin();
    if (!send(queued.text)) setDraft(queued.text);
    onConsumed();
  }, [queued, send, onConsumed, scroller]);

  const talk = (text: string) => {
    scroller.pin();
    return send(text);
  };
  const fresh = !messages.some((m) => m.role === "user");

  return (
    <>
      <div ref={scroller.ref} className={styles.scroll} onScroll={scroller.onScroll}>
        <MessageList
          messages={messages}
          conflicts={session.conflicts}
          streaming={session.streaming}
          resolving={session.resolving}
          onRetry={(key) => {
            scroller.pin();
            session.retry(key);
          }}
          onResolve={(c, choice) => void session.resolveConflict(c, choice)}
          onQuickReply={talk}
          onOpenTailor={onOpenTailor}
        />
        {fresh && !session.streaming && (
          <StarterPrompts prompts={prompts} suggestions={suggestions} onPick={talk} />
        )}
      </div>
      <div className={styles.composer}>
        <Composer
          variant="chat"
          label="对助手说"
          placeholder="让助手改简历……"
          rows={2}
          value={draft}
          onChange={setDraft}
          onSubmit={() => {
            const text = draft.trim() || (imageDraft.images.length > 0 ? REPLICA_DEFAULT_TEXT : "");
            scroller.pin();
            if (send(text, imageDraft.images)) {
              setDraft("");
              imageDraft.clear();
            }
          }}
          streaming={session.streaming}
          onStop={session.stop}
          onAttach={onAttach}
          images={imageDraft}
        />
      </div>
    </>
  );
}
