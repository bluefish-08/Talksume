import { ArrowRight, MessageSquare, PanelRightOpen } from "lucide-react";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useProfile } from "../api/queries.ts";
import { Button, EmptyState, Spinner } from "../components/ui.tsx";
import { ChatPanel, type LiveResume, type PanelRequest } from "../features/chat/ChatPanel.tsx";
import { ExportMenu } from "../features/resume/ExportMenu.tsx";
import { PolishButton } from "../features/resume/PolishButton.tsx";
import { useFacts, useResume, useResumeStyle } from "../features/resume/queries.ts";
import { ResumePreview } from "../features/resume/ResumePreview.tsx";
import { factQuotes, placeholderTitles } from "../features/resume/resumeUtils.ts";
import { TemplatePicker } from "../features/resume/TemplatePicker.tsx";
import {
  missingPrompt,
  quickPrompts,
  readFlag,
  resumeSubtitle,
  resumeSuggestions,
  writeFlag,
} from "../features/resume/workbench.ts";
import styles from "./Resume.module.css";

const CHAT_OPEN_KEY = "talksume.resume.chatOpen";
// 与 Resume.module.css 的抽屉断点一致；减去侧栏后低于约 950px 时两栏会把纸张压到看不清
const NARROW = "(max-width: 1199px)";

function useNarrow() {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(NARROW);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(NARROW).matches,
    () => false,
  );
}

export function ResumePage() {
  const resume = useResume();
  const profile = useProfile();
  const facts = useFacts();
  const { style } = useResumeStyle();
  const narrow = useNarrow();
  const [docked, setDocked] = useState(() => readFlag(CHAT_OPEN_KEY, true));
  const [drawer, setDrawer] = useState(false);
  const [live, setLive] = useState<LiveResume | null>(null);
  const [request, setRequest] = useState<PanelRequest | null>(null);

  const open = narrow ? drawer : docked;
  const setOpen = useCallback(
    (value: boolean) => {
      if (narrow) {
        setDrawer(value);
      } else {
        setDocked(value);
        writeFlag(CHAT_OPEN_KEY, value);
      }
    },
    [narrow],
  );
  const ask = (text: string) => {
    setRequest({ id: Date.now(), text });
    setOpen(true);
  };

  useEffect(() => {
    if (!narrow || !drawer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawer(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [narrow, drawer]);

  const content = live?.resume ?? resume.data?.resume;
  const completeness = live?.completeness ?? profile.data?.completeness;
  const missing = missingPrompt(completeness);
  const suggestions = content ? resumeSuggestions(content, completeness) : [];
  const prompts = quickPrompts(content, profile.data?.profile.intention.roles[0]);

  return (
    <div className={styles.page} data-chat={open ? "open" : "closed"}>
      <div className={styles.main}>
        <header className={styles.header}>
          <div className={styles.heading}>
            <h1 className={styles.title}>我的简历</h1>
            {completeness && (
              <p className={styles.sub}>
                {resumeSubtitle(completeness.score, resume.data?.updatedAt)}
                {missing && (
                  <>
                    <span aria-hidden="true"> · </span>
                    <button type="button" className={styles.missing} onClick={() => ask(missing.prompt)}>
                      {missing.text}，让助手来补
                    </button>
                  </>
                )}
              </p>
            )}
          </div>
          <div className={styles.tools}>
            <TemplatePicker resume={content} size="md" />
            <PolishButton size="md" />
            <ExportMenu size="md" />
            {!narrow && !open && (
              <Button onClick={() => setOpen(true)}>
                <PanelRightOpen size={16} strokeWidth={1.7} aria-hidden="true" />
                AI 助手
              </Button>
            )}
          </div>
        </header>

        {resume.isPending && (
          <div className={styles.center}>
            <Spinner />
          </div>
        )}
        {resume.isError && !content && (
          <EmptyState title="简历加载失败">
            <Button variant="primary" onClick={() => void resume.refetch()}>
              重试
            </Button>
          </EmptyState>
        )}
        {content && (
          <>
            <div className={styles.paper}>
              <ResumePreview
                resume={content}
                resumeStyle={style}
                highlightTexts={live?.highlights}
                revealHighlight
                facts={factQuotes(facts.data)}
                placeholders={placeholderTitles(content, completeness)}
              />
            </div>
            {suggestions.length > 0 && (
              <section className={styles.more} aria-labelledby="resume-more">
                <h2 id="resume-more" className={styles.moreTitle}>
                  还可以补充
                </h2>
                <ul className={styles.cards}>
                  {suggestions.map((s) => (
                    <li key={s.key}>
                      <button type="button" className={styles.card} onClick={() => ask(s.prompt)}>
                        <span className={styles.cardTitle}>{s.title}</span>
                        <span className={styles.cardAction}>
                          让助手追问
                          <ArrowRight size={13} strokeWidth={1.8} aria-hidden="true" />
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>

      {narrow && open && (
        <button
          type="button"
          className={styles.backdrop}
          aria-label="关闭对话"
          tabIndex={-1}
          onClick={() => setOpen(false)}
        />
      )}
      <div className={styles.side}>
        <ChatPanel
          visible={open}
          prompts={prompts}
          request={request}
          onLive={setLive}
          onClose={() => setOpen(false)}
        />
      </div>
      {narrow && !open && (
        <button type="button" className={styles.fab} onClick={() => setOpen(true)}>
          <MessageSquare size={18} strokeWidth={1.8} aria-hidden="true" />
          AI 助手
        </button>
      )}
    </div>
  );
}
