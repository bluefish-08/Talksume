import { FileText } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useConversations } from "../../api/queries.ts";
import { SECTION_LABELS } from "../../api/types.ts";
import { useFacts } from "../resume/queries.ts";
import { factQuotes } from "../resume/resumeUtils.ts";
import styles from "./ChatView.module.css";
import { Composer } from "./Composer.tsx";
import { MessageList } from "./MessageList.tsx";
import { ResumePane } from "./ResumePane.tsx";
import type { ConversationDetail } from "./types.ts";
import { useChatSession } from "./useChatSession.ts";

const NEAR_BOTTOM_PX = 120;

export function ChatView({ detail }: { detail: ConversationDetail }) {
  const navigate = useNavigate();
  const location = useLocation();
  const session = useChatSession(detail);
  const { messages, send } = session;
  const facts = useFacts();
  const conversations = useConversations();
  const [draft, setDraft] = useState("");
  const [paneOpen, setPaneOpen] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const input = useRef<HTMLTextAreaElement>(null);
  const initialSent = useRef(false);

  useEffect(() => {
    const initial = (location.state as { initialMessage?: string } | null)?.initialMessage;
    // StrictMode 会把 effect 跑两遍，ref 保证首条消息只发一次
    if (!initial || initialSent.current) return;
    initialSent.current = true;
    navigate(location.pathname, { replace: true, state: null });
    send(initial);
  }, [location.state, location.pathname, navigate, send]);

  useEffect(() => input.current?.focus(), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 消息或待确认项变化时才需要判断是否贴底
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages, session.conflicts]);

  const userIds = useMemo(() => messages.filter((m) => m.role === "user").map((m) => m.serverId), [messages]);
  const roundOf = (messageId: string) => {
    const i = userIds.indexOf(messageId);
    return i >= 0 ? i + 1 : undefined;
  };
  const quotes = factQuotes(facts.data, roundOf);

  const title = conversations.data?.find((c) => c.id === detail.id)?.title ?? detail.title;
  const asked = messages.filter((m) => m.role === "assistant").length;
  const progress = session.focus ? `${SECTION_LABELS[session.focus]} · 第 ${asked} 问` : "信息已基本完整";

  const submit = () => {
    stick.current = true;
    if (send(draft)) setDraft("");
  };

  return (
    <div className={styles.layout} data-pane={paneOpen ? "open" : "closed"}>
      <section className={styles.chat} aria-label="对话">
        <header className={styles.head}>
          <h1 className={styles.title}>{title ?? "新对话"}</h1>
          <span className={styles.progress}>{progress}</span>
          <span className={styles.grow} />
          <button type="button" className={styles.paneToggle} onClick={() => setPaneOpen(true)}>
            <FileText size={16} strokeWidth={1.6} aria-hidden="true" />
            简历 {Math.round(session.completeness.score * 100)}%
          </button>
        </header>

        <div
          ref={scroller}
          className={styles.scroll}
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
          }}
        >
          <MessageList
            messages={messages}
            conflicts={session.conflicts}
            streaming={session.streaming}
            resolving={session.resolving}
            onRetry={(key) => {
              stick.current = true;
              session.retry(key);
            }}
            onResolve={(c, choice) => void session.resolveConflict(c, choice)}
          />
        </div>

        <div className={styles.composer}>
          <Composer
            variant="chat"
            label="你的回答"
            placeholder="接着说……"
            rows={2}
            value={draft}
            onChange={setDraft}
            onSubmit={submit}
            streaming={session.streaming}
            onStop={session.stop}
            inputRef={input}
            tools={<span className={styles.hint}>Enter 发送 · Shift + Enter 换行</span>}
          />
        </div>
      </section>

      <div className={styles.paneWrap}>
        <button type="button" className={styles.paneBack} onClick={() => setPaneOpen(false)}>
          返回对话
        </button>
        <ResumePane
          resume={session.resume}
          completeness={session.completeness}
          highlights={session.highlights}
          facts={facts.data ?? []}
          quotes={quotes}
          roundOf={roundOf}
        />
      </div>
    </div>
  );
}
