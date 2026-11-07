import { useEffect, useState } from "react";
import { type Completeness, type ResumeContent, SECTION_LABELS } from "../../api/types.ts";
import { useToast } from "../../components/Toast.tsx";
import { Button, Spinner } from "../../components/ui.tsx";
import { ExportMenu } from "../resume/ExportMenu.tsx";
import { PolishButton } from "../resume/PolishButton.tsx";
import { type FactItem, useResumeStyle } from "../resume/queries.ts";
import { type FactQuote, ResumePreview } from "../resume/ResumePreview.tsx";
import { placeholderTitles } from "../resume/resumeUtils.ts";
import { TemplatePicker } from "../resume/TemplatePicker.tsx";
import { errorText } from "../tailor/changes.tsx";
import { useTailorActions, useTailoring } from "../tailor/queries.ts";
import { TailorDraft } from "../tailor/TailorDraft.tsx";
import { VersionMenu } from "../tailor/VersionMenu.tsx";
import styles from "./ResumePane.module.css";
import { cardStatus, type TailorStatus } from "./tailorCards.ts";

export interface TailorJob {
  jobId: string;
  company: string;
  title: string;
}

interface Props {
  resume: ResumeContent;
  completeness: Completeness;
  highlights: ReadonlySet<string>;
  facts: readonly FactItem[];
  quotes: Readonly<Record<string, FactQuote>>;
  roundOf: (messageId: string) => number | undefined;
  /** 这场对话里最近一次定制的岗位；没有定制版时为空。 */
  tailorJob: TailorJob | null;
  tailor: TailorTarget | null;
  onTailorShow: (showing: boolean) => void;
  onTailorDiscard: () => void;
}

/** 面板里打开的定制版；at 每次请求打开都会变，用来切回简历页签。 */
export interface TailorTarget {
  jobId: string;
  company: string;
  title: string;
  showing: boolean;
  at: number;
}

type Tab = "resume" | "facts";

export function ResumePane({
  resume,
  completeness,
  highlights,
  facts,
  quotes,
  roundOf,
  tailorJob,
  tailor,
  onTailorShow,
  onTailorDiscard,
}: Props) {
  const [tab, setTab] = useState<Tab>("resume");
  const toast = useToast();
  const { style } = useResumeStyle();
  const tailoring = useTailoring(tailorJob?.jobId);
  const { adopt, revoke } = useTailorActions(tailorJob?.jobId ?? "");
  const openedAt = tailor?.showing ? tailor.at : undefined;
  useEffect(() => {
    if (openedAt !== undefined) setTab("resume");
  }, [openedAt]);
  const view = tailoring.data?.tailoring;
  const status = cardStatus(view);
  const showing = Boolean(tailor && tailor.jobId === tailorJob?.jobId && tailor.showing);
  const onTailored = tab === "resume" && showing && Boolean(tailorJob);
  const visible = facts.filter((f) => f.status !== "superseded" && f.quote);
  const pct = Math.round(completeness.score * 100);
  const usable = view?.changes.filter((c) => c.violations.length === 0).map((c) => c.id) ?? [];
  const chosen =
    view && view.selected.length > 0 ? view.selected.filter((id) => usable.includes(id)) : usable;
  const busy = adopt.isPending || revoke.isPending;

  return (
    <aside className={styles.pane} aria-label="简历">
      <ResumePaneHeader
        resume={resume}
        tab={tab}
        onTab={setTab}
        pct={pct}
        factCount={visible.length}
        tailorJob={tailorJob}
        status={status}
        changes={view?.changes.length ?? 0}
        showing={showing}
        busy={busy}
        canAdopt={chosen.length > 0}
        adopting={adopt.isPending}
        onShow={(next) => {
          setTab("resume");
          onTailorShow(next);
        }}
        onDiscard={onTailorDiscard}
        onAdopt={() =>
          adopt.mutate(chosen, {
            onSuccess: () => toast("已采用定制版，投递这个岗位时会默认使用", { tone: "success" }),
            onError: (e) => toast(errorText(e), { tone: "error" }),
          })
        }
        onRevoke={() =>
          revoke.mutate(undefined, {
            onSuccess: () => {
              onTailorShow(false);
              toast("已改回主简历，投递这个岗位时不再用定制版");
            },
            onError: (e) => toast(errorText(e), { tone: "error" }),
          })
        }
      />

      {onTailored && tailorJob ? (
        <TailorDraft jobId={tailorJob.jobId} />
      ) : tab === "resume" ? (
        <div className={styles.body} role="tabpanel" id="panel-resume" aria-labelledby="tab-resume">
          <ResumePreview
            resume={resume}
            resumeStyle={style}
            highlightTexts={highlights}
            facts={quotes}
            placeholders={placeholderTitles(resume, completeness)}
          />
        </div>
      ) : (
        <div className={styles.facts} role="tabpanel" id="panel-facts" aria-labelledby="tab-facts">
          {visible.length === 0 ? (
            <p className={styles.empty}>
              聊过之后，你说的每一句关键原话都会记在这里，简历里的内容都能找到出处。
            </p>
          ) : (
            <ul className={styles.list}>
              {visible.map((f) => {
                const round =
                  f.source !== "resume" && f.sourceMessageId ? roundOf(f.sourceMessageId) : undefined;
                return (
                  <li key={f.id} className={styles.fact}>
                    <span className={styles.meta}>
                      {SECTION_LABELS[f.section as keyof typeof SECTION_LABELS] ?? f.section}
                      {f.source === "resume" ? " · 来自简历原文" : round ? ` · 第 ${round} 轮` : ""}
                      {f.status === "pending" ? " · 待确认" : ""}
                    </span>
                    <span>「{f.quote}」</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </aside>
  );
}

interface HeaderProps {
  resume: ResumeContent;
  tab: Tab;
  onTab: (tab: Tab) => void;
  pct: number;
  factCount: number;
  tailorJob: TailorJob | null;
  status: TailorStatus;
  changes: number;
  showing: boolean;
  busy: boolean;
  canAdopt: boolean;
  adopting: boolean;
  onShow: (showing: boolean) => void;
  onDiscard: () => void;
  onAdopt: () => void;
  onRevoke: () => void;
}

export function ResumePaneHeader({
  resume,
  tab,
  onTab,
  pct,
  factCount,
  tailorJob,
  status,
  changes,
  showing,
  busy,
  canAdopt,
  adopting,
  onShow,
  onDiscard,
  onAdopt,
  onRevoke,
}: HeaderProps) {
  return (
    <header className={styles.head}>
      <div className={styles.tabs} role="tablist">
        <button
          type="button"
          role="tab"
          id="tab-resume"
          aria-selected={tab === "resume"}
          aria-controls="panel-resume"
          className={styles.tab}
          onClick={() => onTab("resume")}
        >
          简历 <span className={styles.count}>{pct}%</span>
        </button>
        <button
          type="button"
          role="tab"
          id="tab-facts"
          aria-selected={tab === "facts"}
          aria-controls="panel-facts"
          className={styles.tab}
          onClick={() => onTab("facts")}
        >
          原话记录 <span className={styles.count}>{factCount}</span>
        </button>
      </div>
      <span className={styles.grow} />
      {tailorJob && (
        <>
          <VersionMenu
            company={tailorJob.company}
            changes={changes}
            status={status}
            showing={showing}
            onShow={onShow}
            onRevoke={onRevoke}
            onDiscard={onDiscard}
          />
          {status === "draft" && (
            <Button variant="dark" size="sm" disabled={busy || !canAdopt} onClick={onAdopt}>
              {adopting && <Spinner label="采用中" />}用这版
            </Button>
          )}
        </>
      )}
      <TemplatePicker resume={resume} icon />
      {!(tab === "resume" && showing) && <PolishButton icon />}
      <ExportMenu icon />
    </header>
  );
}
