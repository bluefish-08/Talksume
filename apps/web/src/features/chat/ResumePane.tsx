import { useState } from "react";
import { type Completeness, type ResumeContent, SECTION_LABELS } from "../../api/types.ts";
import { CompletenessBar } from "../resume/CompletenessBar.tsx";
import { ExportMenu } from "../resume/ExportMenu.tsx";
import { PolishButton } from "../resume/PolishButton.tsx";
import type { FactItem } from "../resume/queries.ts";
import { type FactQuote, ResumePreview } from "../resume/ResumePreview.tsx";
import { placeholderTitles } from "../resume/resumeUtils.ts";
import styles from "./ResumePane.module.css";

interface Props {
  resume: ResumeContent;
  completeness: Completeness;
  highlights: ReadonlySet<string>;
  facts: readonly FactItem[];
  quotes: Readonly<Record<string, FactQuote>>;
  roundOf: (messageId: string) => number | undefined;
}

type Tab = "resume" | "facts";

export function ResumePane({ resume, completeness, highlights, facts, quotes, roundOf }: Props) {
  const [tab, setTab] = useState<Tab>("resume");
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
        <span className={styles.template}>校园模板</span>
        <ExportMenu />
        <PolishButton />
      </header>

      <div className={styles.progress}>
        <CompletenessBar completeness={completeness} />
      </div>

      {tab === "resume" ? (
        <div className={styles.body} role="tabpanel" id="panel-resume" aria-labelledby="tab-resume">
          <ResumePreview
            resume={resume}
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
                const round = f.sourceMessageId ? roundOf(f.sourceMessageId) : undefined;
                return (
                  <li key={f.id} className={styles.fact}>
                    <span className={styles.meta}>
                      {SECTION_LABELS[f.section as keyof typeof SECTION_LABELS] ?? f.section}
                      {round ? ` · 第 ${round} 轮` : ""}
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
