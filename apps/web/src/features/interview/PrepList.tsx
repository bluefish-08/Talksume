import {
  INTERVIEW_KIND_LABEL,
  INTERVIEW_KINDS,
  type InterviewKind,
  type InterviewQuestion,
  interviewPrepMarkdown,
  RESUME_SOURCE_LABEL,
} from "@talksume/core";
import { AlertTriangle, Download, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useToast } from "../../components/Toast.tsx";
import { Button, Chip, Spinner } from "../../components/ui.tsx";
import { errorText } from "../tailor/changes.tsx";
import styles from "./PrepList.module.css";
import { type PrepView, useGeneratePrep } from "./queries.ts";

type Prep = NonNullable<PrepView["prep"]>;

function download(view: PrepView, prep: Prep) {
  const md = interviewPrepMarkdown({
    company: view.job.company,
    title: view.job.title,
    resumeSource: prep.resumeSource,
    updatedAt: new Date(prep.updatedAt).toLocaleString("zh-CN"),
    questions: prep.questions,
  });
  const url = URL.createObjectURL(new Blob([md], { type: "text/markdown;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `面试题单-${view.job.company}-${view.job.title}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

export function Question({ q, index }: { q: InterviewQuestion; index: number }) {
  const approach = q.approach ?? [];
  return (
    <li
      className={styles.card}
      data-risky={q.risks.some((r) => r.kind === "stronger_than_quote") || undefined}
    >
      <div className={styles.head}>
        <span className={styles.kind}>{INTERVIEW_KIND_LABEL[q.kind]}</span>
        <span className={styles.no}>#{index + 1}</span>
      </div>
      <h3 className={styles.q}>{q.question}</h3>
      <p className={styles.meta}>
        <b>考察点</b>
        {q.focus}
      </p>
      {q.source.bullet && (
        <p className={styles.meta}>
          <b>简历出处</b>
          {q.source.bullet.heading} · {q.source.bullet.text}
        </p>
      )}
      {q.source.jd && (
        <p className={styles.meta}>
          <b>JD 出处</b>
          {q.source.jd}
        </p>
      )}
      {q.risks.map((r) => (
        <p key={r.note} className={styles.risk} role="note">
          <AlertTriangle size={14} strokeWidth={1.8} aria-hidden="true" />
          <span>{r.note}</span>
        </p>
      ))}
      {approach.length > 0 && (
        <div className={styles.block}>
          <h4 className={styles.h}>怎么答</h4>
          <ol className={styles.steps}>
            {approach.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
      )}
      {q.answerPoints.length > 0 && (
        <div className={styles.block}>
          <h4 className={styles.h}>你能用的</h4>
          <ul className={styles.points}>
            {q.answerPoints.map((p) => (
              <li key={p.text}>
                {p.text}
                <details className={styles.source}>
                  <summary>出处</summary>
                  <span className={styles.quote}>{p.quote}</span>
                </details>
              </li>
            ))}
          </ul>
        </div>
      )}
      {q.missing && (
        <div className={styles.think}>
          <h4 className={styles.h}>面试前要想好</h4>
          <p>{q.missing}</p>
        </div>
      )}
    </li>
  );
}

export function PrepList({
  view,
  prep,
  onMock,
  starting,
}: {
  view: PrepView;
  prep: Prep;
  onMock: () => void;
  starting: boolean;
}) {
  const toast = useToast();
  const generate = useGeneratePrep(view.job.id);
  const [kind, setKind] = useState<InterviewKind | "all">("all");
  const shown = prep.questions.filter((q) => kind === "all" || q.kind === kind);
  const risky = prep.questions.filter((q) => q.risks.some((r) => r.kind === "stronger_than_quote")).length;

  return (
    <section className={styles.wrap} aria-label="面试题单">
      <div className={styles.status}>
        <span>
          出题依据：{RESUME_SOURCE_LABEL[prep.resumeSource]} · 生成于{" "}
          {new Date(prep.updatedAt).toLocaleString("zh-CN")}
        </span>
        <div className={styles.actions}>
          <Button size="sm" onClick={() => download(view, prep)}>
            <Download size={14} strokeWidth={1.7} aria-hidden="true" />
            导出 Markdown
          </Button>
          <Button
            size="sm"
            disabled={generate.isPending || !view.available}
            onClick={() =>
              generate.mutate(undefined, { onError: (e) => toast(errorText(e), { tone: "error" }) })
            }
          >
            {generate.isPending ? (
              <Spinner label="生成中" />
            ) : (
              <RefreshCw size={14} strokeWidth={1.7} aria-hidden="true" />
            )}
            重新生成
          </Button>
          <Button size="sm" variant="primary" disabled={starting} onClick={onMock}>
            {starting && <Spinner label="准备中" />}开始模拟面试
          </Button>
        </div>
      </div>
      {prep.stale && (
        <p className={styles.stale}>
          你的简历依据已经变了（现在会用「{RESUME_SOURCE_LABEL[view.nextSource]}」），建议重新生成题单。
        </p>
      )}
      {risky > 0 && (
        <p className={styles.alert}>
          <AlertTriangle size={15} strokeWidth={1.8} aria-hidden="true" />有 {risky}{" "}
          条简历要点的措辞比你的原话更重，面试官最可能从这里追问。
        </p>
      )}
      <div className={styles.chips}>
        <Chip active={kind === "all"} onClick={() => setKind("all")}>
          全部 {prep.questions.length}
        </Chip>
        {INTERVIEW_KINDS.map((k) => {
          const n = prep.questions.filter((q) => q.kind === k).length;
          return n > 0 ? (
            <Chip key={k} active={kind === k} onClick={() => setKind(k)}>
              {INTERVIEW_KIND_LABEL[k]} {n}
            </Chip>
          ) : null;
        })}
      </div>
      <ol className={styles.list}>
        {shown.map((q) => (
          <Question key={q.id} q={q} index={prep.questions.indexOf(q)} />
        ))}
      </ol>
    </section>
  );
}
