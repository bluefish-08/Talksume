import { useQueryClient } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useConversations } from "../../api/queries.ts";
import { SECTION_LABELS } from "../../api/types.ts";
import { usePolishedResume } from "../resume/polishQueries.ts";
import { useFacts } from "../resume/queries.ts";
import { factQuotes } from "../resume/resumeUtils.ts";
import { tailoringKey } from "../tailor/queries.ts";
import styles from "./ChatView.module.css";
import { Composer } from "./Composer.tsx";
import { MessageList } from "./MessageList.tsx";
import { ResumePane, type TailorTarget } from "./ResumePane.tsx";
import type { ConversationDetail, TailorCard } from "./types.ts";
import { useChatSession } from "./useChatSession.ts";
import { useStickToBottom } from "./useStickToBottom.ts";

export function ChatView({ detail }: { detail: ConversationDetail }) {
  const navigate = useNavigate();
  const location = useLocation();
  const session = useChatSession(detail);
  const polishedResume = usePolishedResume(session.resume);
  const { messages, send } = session;
  const facts = useFacts();
  const conversations = useConversations();
  const [draft, setDraft] = useState("");
  const [paneOpen, setPaneOpen] = useState(false);
  const [tailor, setTailor] = useState<TailorTarget | null>(null);
  const client = useQueryClient();
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

  const showTailor = useCallback(
    (card: TailorCard) =>
      setTailor({
        jobId: card.jobId,
        company: card.company,
        title: card.title,
        showing: true,
        at: Date.now(),
      }),
    [],
  );

  // 本轮刚生成的定制版直接在面板里打开；窄屏不自动弹抽屉，免得盖住正在输出的回复
  const live = messages.at(-1);
  const liveTailor = live?.state === "streaming" ? live.tailor : undefined;
  useEffect(() => {
    if (!liveTailor) return;
    void client.invalidateQueries({ queryKey: tailoringKey(liveTailor.jobId) });
    showTailor(liveTailor);
  }, [liveTailor, client, showTailor]);

  const scroller = useStickToBottom(messages, session.conflicts);

  const userIds = useMemo(() => messages.filter((m) => m.role === "user").map((m) => m.serverId), [messages]);
  const roundOf = (messageId: string) => {
    const i = userIds.indexOf(messageId);
    return i >= 0 ? i + 1 : undefined;
  };
  const quotes = factQuotes(facts.data, roundOf);

  const title = conversations.data?.find((c) => c.id === detail.id)?.title ?? detail.title;
  const progress = session.focus ? SECTION_LABELS[session.focus] : "信息已基本完整";

  const submit = () => {
    scroller.pin();
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
            onQuickReply={(text) => {
              scroller.pin();
              session.send(text);
            }}
            onOpenTailor={(card) => {
              showTailor(card);
              setPaneOpen(true);
            }}
          />
        </div>

        <div className={styles.composer}>
          <div className={styles.composerInner}>
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
        </div>
      </section>

      <div className={styles.paneWrap}>
        <button type="button" className={styles.paneBack} onClick={() => setPaneOpen(false)}>
          返回对话
        </button>
        <ResumePane
          resume={polishedResume}
          completeness={session.completeness}
          highlights={session.highlights}
          facts={facts.data ?? []}
          quotes={quotes}
          roundOf={roundOf}
          tailor={tailor}
          onTailorShow={(showing) => setTailor((t) => t && { ...t, showing })}
          onTailorDiscard={() => setTailor(null)}
        />
      </div>
    </div>
  );
}
