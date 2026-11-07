import { FileUp, MessageSquare, PanelRightOpen } from "lucide-react";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useProfile } from "../api/queries.ts";
import { Button, EmptyState, Spinner } from "../components/ui.tsx";
import { ChatPanel, type LiveResume, type PanelRequest } from "../features/chat/ChatPanel.tsx";
import type { TailorCard } from "../features/chat/types.ts";
import { ExportMenu } from "../features/resume/ExportMenu.tsx";
import { PolishButton } from "../features/resume/PolishButton.tsx";
import { useFacts, useResume, useResumeStyle } from "../features/resume/queries.ts";
import { ResumePreview } from "../features/resume/ResumePreview.tsx";
import { factQuotes, placeholderTitles } from "../features/resume/resumeUtils.ts";
import { SuggestionsMenu } from "../features/resume/SuggestionsMenu.tsx";
import { TemplatePicker } from "../features/resume/TemplatePicker.tsx";
import {
  missingPrompt,
  paperScale,
  quickPrompts,
  readFlag,
  readZoom,
  resumeSubtitle,
  resumeSuggestions,
  writeFlag,
  writeZoom,
  type ZoomMode,
} from "../features/resume/workbench.ts";
import { ZoomControl } from "../features/resume/ZoomControl.tsx";
import { useResumeImport } from "../features/resume-import/useResumeImport.tsx";
import { TailorDraft } from "../features/tailor/TailorDraft.tsx";
import { VersionSwitch } from "../features/tailor/VersionSwitch.tsx";
import styles from "./Resume.module.css";

const CHAT_OPEN_KEY = "talksume.resume.chatOpen";
const ZOOM_KEY = "talksume.resume.zoom";
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

/** 量出容器去掉内边距后的可用尺寸；容器还没挂载时为 0。 */
function useViewport(node: HTMLElement | null) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!node) return;
    const measure = () => {
      const css = getComputedStyle(node);
      const x = Number.parseFloat(css.paddingLeft) + Number.parseFloat(css.paddingRight);
      const y = Number.parseFloat(css.paddingTop) + Number.parseFloat(css.paddingBottom);
      const width = Math.max(0, node.clientWidth - x);
      const height = Math.max(0, node.clientHeight - y);
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return size;
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
  const [tailor, setTailor] = useState<{
    jobId: string;
    company: string;
    title: string;
    showing: boolean;
  } | null>(null);
  const showTailor = useCallback(
    (card: TailorCard) =>
      setTailor({ jobId: card.jobId, company: card.company, title: card.title, showing: true }),
    [],
  );
  const [zoom, setZoom] = useState<ZoomMode>(() => readZoom(ZOOM_KEY));
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const importer = useResumeImport();
  const viewport = useViewport(stage);
  const scale = paperScale(zoom, viewport);
  const chooseZoom = (mode: ZoomMode) => {
    setZoom(mode);
    writeZoom(ZOOM_KEY, mode);
  };

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
              <div className={styles.subRow}>
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
                <SuggestionsMenu suggestions={suggestions} tips={completeness.tips} onPick={ask} />
              </div>
            )}
          </div>
          <div className={styles.tools}>
            <Button onClick={() => importer.open()} title="上传旧简历，只补缺的内容">
              <FileUp size={16} strokeWidth={1.7} aria-hidden="true" />
              导入简历
            </Button>
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
        {content && tailor && !tailor.showing && (
          <VersionSwitch
            label={`${tailor.company}定制版`}
            showing={false}
            onShow={(showing) => setTailor((t) => t && { ...t, showing })}
          />
        )}
        {content && tailor?.showing && (
          <div className={styles.tailorView}>
            <TailorDraft
              jobId={tailor.jobId}
              onShowMain={() => setTailor((t) => t && { ...t, showing: false })}
              onDiscard={() => setTailor(null)}
            />
          </div>
        )}
        {content && !tailor?.showing && (
          <>
            <div className={styles.zoombar}>
              <ZoomControl mode={zoom} scale={scale} onChange={chooseZoom} />
            </div>
            <div className={styles.stage} ref={setStage}>
              <div className={styles.paper}>
                <ResumePreview
                  resume={content}
                  resumeStyle={style}
                  highlightTexts={live?.highlights}
                  revealHighlight
                  facts={factQuotes(facts.data)}
                  placeholders={placeholderTitles(content, completeness)}
                  scale={scale}
                />
              </div>
            </div>
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
          suggestions={suggestions}
          request={request}
          onLive={setLive}
          onOpenTailor={showTailor}
          onClose={() => setOpen(false)}
        />
      </div>
      {narrow && !open && (
        <button type="button" className={styles.fab} onClick={() => setOpen(true)}>
          <MessageSquare size={18} strokeWidth={1.8} aria-hidden="true" />
          AI 助手
        </button>
      )}
      {importer.dialog}
    </div>
  );
}
