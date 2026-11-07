import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useConversations } from "../../api/queries.ts";
import { usePolishedResume } from "../resume/polishQueries.ts";
import { STYLE_ASK_MESSAGE } from "../resume/queries.ts";
import { ImportPrompt } from "../resume-import/ImportPrompt.tsx";
import { useResumeImport } from "../resume-import/useResumeImport.tsx";
import { tailoringKey } from "../tailor/queries.ts";
import { ChatHeader } from "./ChatHeader.tsx";
import styles from "./ChatView.module.css";
import { Composer } from "./Composer.tsx";
import { MessageList } from "./MessageList.tsx";
import { ResumePane, type TailorJob, type TailorTarget } from "./ResumePane.tsx";
import type { ConversationDetail, TailorCard } from "./types.ts";
import { useChatSession } from "./useChatSession.ts";
import { REPLICA_DEFAULT_TEXT, useImageDraft } from "./useImageDraft.ts";
import { useStickToBottom } from "./useStickToBottom.ts";

export function ChatView({ detail }: { detail: ConversationDetail }) {
  const navigate = useNavigate();
  const location = useLocation();
  const session = useChatSession(detail);
  const polishedResume = usePolishedResume(session.resume);
  const { messages, send } = session;
  const conversations = useConversations();
  const [draft, setDraft] = useState("");
  const imageDraft = useImageDraft();
  const [paneOpen, setPaneOpen] = useState(false);
  const [tailor, setTailor] = useState<TailorTarget | null>(null);
  const client = useQueryClient();
  const input = useRef<HTMLTextAreaElement>(null);
  const initialSent = useRef(false);
  const importer = useResumeImport(detail.id);

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
  const tailorJob = useMemo<TailorJob | null>(() => {
    const card = messages.findLast((m) => m.tailor && m.tailor.kind !== "update")?.tailor;
    return card ? { jobId: card.jobId, company: card.company, title: card.title } : null;
  }, [messages]);

  const title = conversations.data?.find((c) => c.id === detail.id)?.title ?? detail.title;

  const submit = () => {
    scroller.pin();
    const text = draft.trim() || (imageDraft.images.length > 0 ? REPLICA_DEFAULT_TEXT : "");
    if (send(text, imageDraft.images)) {
      setDraft("");
      imageDraft.clear();
    }
  };

  return (
    <div className={styles.layout} data-pane={paneOpen ? "open" : "closed"}>
      <section className={styles.chat} aria-label="对话">
        <ChatHeader
          title={title ?? "新对话"}
          pct={Math.round(session.completeness.score * 100)}
          onOpenPane={() => setPaneOpen(true)}
        />

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
          {!session.streaming && !messages.some((m) => m.role === "user") && (
            <ImportPrompt onImport={() => importer.open()} />
          )}
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
              onAttach={() => importer.open()}
              images={imageDraft}
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
          tailorJob={tailorJob}
          tailor={tailor}
          onTailorShow={(showing) =>
            setTailor((t) => {
              if (t) return { ...t, showing };
              return showing && tailorJob ? { ...tailorJob, showing, at: Date.now() } : t;
            })
          }
          onTailorDiscard={() => setTailor(null)}
          onAskAi={() => {
            scroller.pin();
            session.send(STYLE_ASK_MESSAGE);
          }}
          streaming={session.streaming}
        />
      </div>
      {importer.dialog}
    </div>
  );
}
