import { ArrowLeft, ChevronDown, ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { Button, IconButton, Spinner } from "../../components/ui.tsx";
import {
  dimRows,
  EXCLUDED_NOTICE,
  evidenceLines,
  formatSalary,
  hasReport,
  jobMeta,
  sourceLabel,
} from "./format.ts";
import styles from "./JobDetail.module.css";
import type { ApplicationRef, JobSummary, MatchItem } from "./types.ts";

export interface DetailProps {
  job: JobSummary;
  match: MatchItem | undefined;
  excluded?: keyof typeof EXCLUDED_NOTICE | undefined;
  /** 有匹配时显示在维度上方，没有匹配时替换默认提示。 */
  matchNote?: ReactNode;
  dimsTitle?: string | undefined;
  jdText: string | undefined;
  jdLoading: boolean;
  application: ApplicationRef | undefined;
  retryingReport: boolean;
  busy: { apply: boolean; optimize: boolean; dislike: boolean };
  onBack: () => void;
  onApply: () => void;
  onOptimize: () => void;
  onDislike: () => void;
  onRetryReport: () => void;
}

function applyButton({ application, busy, onApply }: DetailProps) {
  if (!application) {
    return (
      <Button variant="primary" size="lg" className={styles.apply} disabled={busy.apply} onClick={onApply}>
        {busy.apply && <Spinner label="投递中" />}投递
      </Button>
    );
  }
  if (application.status === "pending" && application.channel === "assisted") {
    return (
      <Button variant="primary" size="lg" className={styles.apply} onClick={onApply}>
        继续投递
      </Button>
    );
  }
  return (
    <Button variant="secondary" size="lg" className={styles.apply} disabled>
      {application.status === "closed" ? "投递已结束" : "已投递"}
    </Button>
  );
}

export function JobDetail(props: DetailProps) {
  const { job, match, excluded, jdText, jdLoading, application, retryingReport, busy } = props;
  const report = match?.report;
  const strengths = report?.strengths?.length ? report.strengths : match ? evidenceLines(match) : [];
  const gaps = report?.gaps ?? [];
  const salary = formatSalary(job);
  const meta = [jobMeta(job, 3), salary, `来自${sourceLabel(job.source)}`].filter(Boolean).join(" · ");

  return (
    <article className={styles.pane} aria-label="岗位详情">
      <div className={styles.scroll}>
        <IconButton label="返回列表" className={styles.back} onClick={props.onBack}>
          <ArrowLeft size={18} strokeWidth={1.6} aria-hidden="true" />
        </IconButton>

        <header className={styles.head}>
          <div className={styles.headText}>
            <h2 className={styles.title}>{job.title}</h2>
            <p className={styles.meta}>{meta}</p>
          </div>
          {match && (
            <div className={styles.bigScore}>
              <span className="sr-only">匹配度 </span>
              {Math.round(match.score)}
            </div>
          )}
        </header>

        {match ? (
          <>
            {props.matchNote}
            {report?.summary ? (
              <p className={styles.summary}>{report.summary}</p>
            ) : (
              !hasReport(match.report) &&
              (match.reportStatus === "pending" ? (
                <p className={styles.pending} role="status">
                  <Spinner label="生成中" />
                  AI 解读生成中…
                </p>
              ) : match.reportStatus === "failed" ? (
                <p className={styles.pending} role="status">
                  AI 解读没有生成成功。
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={retryingReport}
                    onClick={props.onRetryReport}
                  >
                    {retryingReport && <Spinner label="重试中" />}重试
                  </Button>
                </p>
              ) : null)
            )}

            <section className={styles.section} aria-labelledby="dim-h">
              <h3 id="dim-h" className={styles.h3}>
                {props.dimsTitle ?? "为什么推荐"}
              </h3>
              <div className={styles.dims}>
                {dimRows(match).map((d) => (
                  <div key={d.key} className={styles.dimRow} data-na={d.applicable ? undefined : true}>
                    <span className={styles.dimLabel}>{d.label}</span>
                    <div
                      className={styles.track}
                      role="progressbar"
                      aria-label={d.label}
                      aria-valuemin={0}
                      aria-valuemax={1}
                      aria-valuenow={d.applicable ? d.score : undefined}
                      aria-valuetext={d.applicable ? d.score.toFixed(2) : "未填写"}
                    >
                      {d.applicable && (
                        <div className={styles.fill} style={{ width: `${Math.round(d.score * 100)}%` }} />
                      )}
                    </div>
                    <span className={styles.dimValue}>{d.applicable ? d.score.toFixed(2) : "未填写"}</span>
                  </div>
                ))}
              </div>
            </section>

            {(strengths.length > 0 || gaps.length > 0) && (
              <ul className={styles.points}>
                {strengths.map((s) => (
                  <li key={`s-${s}`}>
                    <span className={styles.ok} aria-hidden="true">
                      ✓
                    </span>
                    <span>
                      <span className="sr-only">优势：</span>
                      {s}
                    </span>
                  </li>
                ))}
                {gaps.map((g) => (
                  <li key={`g-${g}`}>
                    <span className={styles.warn} aria-hidden="true">
                      !
                    </span>
                    <span>
                      <span className="sr-only">待补充：</span>
                      {g}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {gaps[0] && (
              <div className={styles.tip}>
                <span className={styles.tipTitle}>投之前可以补一句</span>
                <span className={styles.tipBody}>
                  匹配报告提到：{gaps[0]}
                  。如果你有相关经历，点下面的「针对这个岗位优化简历」聊聊，补进简历再投。
                </span>
              </div>
            )}
          </>
        ) : (
          (props.matchNote ?? (
            <p className={styles.note}>
              {excluded
                ? `没有计算匹配度：${EXCLUDED_NOTICE[excluded]}。你仍然可以查看岗位并投递。`
                : "这个岗位不在你的推荐列表里，暂无匹配度。"}
            </p>
          ))
        )}

        <details className={styles.jd}>
          <summary>
            <ChevronDown size={16} strokeWidth={1.6} aria-hidden="true" />
            岗位描述原文
          </summary>
          {jdText ? (
            <p className={styles.jdText}>{jdText}</p>
          ) : (
            <p className={styles.jdText}>{jdLoading ? "加载中…" : job.snippet}</p>
          )}
        </details>
      </div>

      <div className={styles.foot}>
        <div className={styles.actions}>
          <Button size="lg" className={styles.optimize} disabled={busy.optimize} onClick={props.onOptimize}>
            {busy.optimize && <Spinner label="准备中" />}针对这个岗位优化简历
          </Button>
          {applyButton(props)}
        </div>
        <div className={styles.minor}>
          <button type="button" className={styles.link} disabled={busy.dislike} onClick={props.onDislike}>
            不感兴趣
          </button>
          {job.url && (
            <a className={styles.link} href={job.url} target="_blank" rel="noreferrer">
              查看原岗位
              <ExternalLink size={13} strokeWidth={1.6} aria-hidden="true" />
            </a>
          )}
          {application && (
            <Link className={styles.link} to="/applications">
              查看投递进度
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}

export function JobDetailSkeleton() {
  return (
    <div className={styles.pane} aria-hidden="true">
      <div className={styles.scroll}>
        <span className={styles.sk} style={{ width: "60%", height: 20 }} />
        <span className={styles.sk} style={{ width: "80%" }} />
        <span className={styles.sk} style={{ width: "100%", height: 120 }} />
        <span className={styles.sk} style={{ width: "100%", height: 44 }} />
      </div>
    </div>
  );
}
