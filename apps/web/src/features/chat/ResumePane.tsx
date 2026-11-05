import { useEffect, useState } from "react";
import { type Completeness, type ResumeContent, SECTION_LABELS } from "../../api/types.ts";
import { CompletenessBar } from "../resume/CompletenessBar.tsx";
import { ExportMenu } from "../resume/ExportMenu.tsx";
import { PolishButton } from "../resume/PolishButton.tsx";
import { type FactItem, useResumeStyle } from "../resume/queries.ts";
import { type FactQuote, ResumePreview } from "../resume/ResumePreview.tsx";
import { placeholderTitles } from "../resume/resumeUtils.ts";
import { TemplatePicker } from "../resume/TemplatePicker.tsx";
import { TailorDraft } from "../tailor/TailorDraft.tsx";
import { VersionSwitch } from "../tailor/VersionSwitch.tsx";
import styles from "./ResumePane.module.css";

interface Props {
  resume: ResumeContent;
  completeness: Completeness;
  highlights: ReadonlySet<string>;
  facts: readonly FactItem[];
  quotes: Readonly<Record<string, FactQuote>>;
  roundOf: (messageId: string) => number | undefined;
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
  tailor,
  onTailorShow,
  onTailorDiscard,
}: Props) {
  const [tab, setTab] = useState<Tab>("resume");
  const openedAt = tailor?.showing ? tailor.at : undefined;
  useEffect(() => {
    if (openedAt !== undefined) setTab("resume");
  }, [openedAt]);
  const tailoring = tab === "resume" && tailor?.showing;
  const { style } = useResumeStyle();
  const visible = facts.filter((f) => f.status !== "superseded" && f.quote);

  return (
    <aside className={styles.pane} aria-label="简历">
      <header className={styles.head}>
        <div className={styles.tabs} role="tablist">
          <button
            type="button"
            role="tab"
            id="tab-resume"
            aria-selected={tab === "resume"}
            aria-controls="panel-resume"
            className={styles.tab}
            onClick={() => setTab("resume")}
          >
            简历
          </button>
          <button
            type="button"
            role="tab"
            id="tab-facts"
            aria-selected={tab === "facts"}
            aria-controls="panel-facts"
            className={styles.tab}
            onClick={() => setTab("facts")}
          >
            原话记录
            {visible.length > 0 && <span className={styles.count}>{visible.length}</span>}
          </button>
        </div>
        <span className={styles.grow} />
        <TemplatePicker resume={resume} />
        <ExportMenu />
        {!tailoring && <PolishButton />}
      </header>

      <div className={styles.progress}>
        <CompletenessBar completeness={completeness} />
      </div>

      {tab === "resume" && tailor && (
        <VersionSwitch
          className={styles.versionSwitch}
          label={`${tailor.company} · ${tailor.title}`}
          showing={tailor.showing}
          onShow={onTailorShow}
        />
      )}

      {tailoring ? (
        <TailorDraft jobId={tailor.jobId} onDiscard={onTailorDiscard} />
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
