import { ArrowLeft } from "lucide-react";
import { Link, useParams } from "react-router";
import { useToast } from "../components/Toast.tsx";
import { Button, EmptyState, Spinner } from "../components/ui.tsx";
import { useResumeStyle } from "../features/resume/queries.ts";
import { ResumePreview } from "../features/resume/ResumePreview.tsx";
import { Diff, errorText, titleOf, useTailorDraft } from "../features/tailor/changes.tsx";
import { type TailoringView, useTailorActions, useTailoring } from "../features/tailor/queries.ts";
import styles from "./Tailor.module.css";

type Draft = NonNullable<TailoringView["tailoring"]>;

function Review({ view, draft }: { view: TailoringView; draft: Draft }) {
  const toast = useToast();
  const { style } = useResumeStyle();
  const { generate, adopt, revoke } = useTailorActions(view.job.id);
  const { picked, toggle, chosen, preview, marks } = useTailorDraft(draft);
  const busy = generate.isPending || adopt.isPending || revoke.isPending;

  return (
    <div className={styles.body}>
      <section className={styles.changes} aria-label="调整清单">
        {draft.adopted ? (
          <div className={styles.status} data-tone="ok">
            <span>
              已采用，投递这个岗位时默认用定制版（{new Date(draft.adopted.adoptedAt).toLocaleString("zh-CN")}
              ）{draft.selected.length === 0 && "；下面是重新生成的新建议，还没采用"}
            </span>
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                revoke.mutate(undefined, {
                  onSuccess: () => toast("已改回通用简历，投递这个岗位时不再用定制版"),
                  onError: (e) => toast(errorText(e), { tone: "error" }),
                })
              }
            >
              改回通用版
            </Button>
          </div>
        ) : (
          <div className={styles.status}>
            还没采用：勾选想要的调整后点「采用」，投递这个岗位时才会用定制版。
          </div>
        )}
        {draft.stale && (
          <div className={styles.status} data-tone="warn">
            主简历在生成这份定制后又更新过，建议重新生成。
          </div>
        )}

        {draft.changes.length === 0 && (
          <p className={styles.empty}>这次没有得到调整建议，可以重新生成试试。</p>
        )}
        <ul className={styles.list}>
          {draft.changes.map((c) => {
            const blocked = c.violations.length > 0;
            return (
              <li key={c.id} className={styles.card} data-bad={blocked || undefined}>
                <label className={styles.head}>
                  <input
                    type="checkbox"
                    checked={!blocked && picked.has(c.id)}
                    disabled={blocked || busy}
                    onChange={() => toggle(c.id)}
                  />
                  <span className={styles.title}>{titleOf(c)}</span>
                  {blocked && <span className={styles.badge}>已拦下</span>}
                </label>
                <Diff change={c} />
                {blocked ? (
                  <p className={styles.warn}>
                    出现了简历和你原话里都没有的「{c.violations.join("、")}」，不能采用。
                  </p>
                ) : (
                  c.reason && <p className={styles.reason}>{c.reason}</p>
                )}
              </li>
            );
          })}
        </ul>

        <div className={styles.foot}>
          <Button
            disabled={busy || !view.available}
            onClick={() =>
              generate.mutate(undefined, { onError: (e) => toast(errorText(e), { tone: "error" }) })
            }
          >
            {generate.isPending && <Spinner label="生成中" />}重新生成
          </Button>
          <Button
            variant="primary"
            disabled={busy || chosen.length === 0}
            onClick={() =>
              adopt.mutate(
                chosen.map((c) => c.id),
                {
                  onSuccess: () => toast("已采用定制版，投递这个岗位时会默认使用", { tone: "success" }),
                  onError: (e) => toast(errorText(e), { tone: "error" }),
                },
              )
            }
          >
            {adopt.isPending && <Spinner label="采用中" />}采用所选（{chosen.length}）
          </Button>
        </div>
      </section>

      <section className={styles.preview} aria-label="定制版预览">
        <ResumePreview resume={preview} resumeStyle={style} changeMarks={marks} label="定制版简历" />
      </section>
    </div>
  );
}

export function TailorPage() {
  const { jobId = "" } = useParams();
  const toast = useToast();
  const query = useTailoring(jobId);
  const { generate } = useTailorActions(jobId);
  const view = query.data;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.back} to={`/jobs?job=${encodeURIComponent(jobId)}`}>
          <ArrowLeft size={16} strokeWidth={1.7} aria-hidden="true" />
          回到岗位
        </Link>
        <h1 className={styles.h1}>定制简历{view && `：${view.job.company} · ${view.job.title}`}</h1>
        <p className={styles.sub}>
          只调整要点顺序、措辞侧重、技能展示顺序和一句摘要，不新增任何事实；主简历不变，采用后只用于这个岗位。
        </p>
      </header>

      {query.isPending && (
        <div className={styles.center}>
          <Spinner />
        </div>
      )}
      {query.isError && <EmptyState title="没有找到这个岗位">{errorText(query.error)}</EmptyState>}
      {view && !view.tailoring && (
        <EmptyState title="还没有针对这个岗位的定制版">
          {view.available
            ? "生成后可以逐条查看和原版的差异，确认后再采用。"
            : "还没有配置模型，暂时不能定制。"}
          <div className={styles.emptyActions}>
            <Button
              variant="primary"
              disabled={!view.available || generate.isPending}
              onClick={() =>
                generate.mutate(undefined, { onError: (e) => toast(errorText(e), { tone: "error" }) })
              }
            >
              {generate.isPending && <Spinner label="生成中" />}生成定制版
            </Button>
          </div>
        </EmptyState>
      )}
      {view?.tailoring && <Review key={view.tailoring.updatedAt} view={view} draft={view.tailoring} />}
    </div>
  );
}
