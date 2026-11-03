import { Link } from "react-router";
import { useToast } from "../../components/Toast.tsx";
import { Button, Spinner } from "../../components/ui.tsx";
import { useResumeStyle } from "../resume/queries.ts";
import { ResumePreview } from "../resume/ResumePreview.tsx";
import { Diff, errorText, titleOf, useTailorDraft } from "./changes.tsx";
import { type TailoringView, tailorPath, useTailorActions, useTailoring } from "./queries.ts";
import styles from "./TailorDraft.module.css";

interface Props {
  jobId: string;
  /** 放弃只是收起草稿，服务端的草稿和主简历都不动。 */
  onDiscard: () => void;
}

/** 简历面板里的定制版预览：改动高亮、逐条取消，采用前主简历不变。 */
export function TailorDraft({ jobId, onDiscard }: Props) {
  const query = useTailoring(jobId);
  const view = query.data;

  if (query.isPending) {
    return (
      <div className={styles.center}>
        <Spinner />
      </div>
    );
  }
  if (!view?.tailoring) {
    return (
      <div className={styles.center}>
        <p className={styles.empty}>
          {query.isError ? errorText(query.error) : "还没有针对这个岗位的定制版。"}
          <Link to={tailorPath(jobId)}>去完整页面看看</Link>
        </p>
      </div>
    );
  }
  return <Draft key={view.tailoring.updatedAt} view={view} onDiscard={onDiscard} />;
}

function Draft({ view, onDiscard }: { view: TailoringView; onDiscard: () => void }) {
  const draft = view.tailoring as NonNullable<TailoringView["tailoring"]>;
  const toast = useToast();
  const { style } = useResumeStyle();
  const { adopt, revoke } = useTailorActions(view.job.id);
  const { picked, toggle, chosen, preview, marks } = useTailorDraft(draft);
  const busy = adopt.isPending || revoke.isPending;
  const adopted = !!draft.adopted && draft.selected.length > 0;

  return (
    <div className={styles.draft}>
      <section className={styles.bar} data-tone={adopted ? "ok" : "draft"} aria-label="定制版状态">
        <div className={styles.status}>
          <strong className={styles.badge}>{adopted ? "定制版 · 已采用" : "定制版草稿 · 未采用"}</strong>
          <span className={styles.note}>
            {adopted
              ? "投递这个岗位时默认用这一版，主简历不变。"
              : "主简历没有改动；采用后只在投递这个岗位时使用。"}
          </span>
        </div>
        {draft.stale && (
          <p className={styles.warn}>主简历在生成这份定制后又更新过，建议在完整页面重新生成。</p>
        )}

        <details className={styles.changes}>
          <summary>
            {draft.changes.length} 处改动，已选 {chosen.length} 处 · 逐条查看原文、取消
          </summary>
          <ul className={styles.list}>
            {draft.changes.map((c) => {
              const blocked = c.violations.length > 0;
              return (
                <li key={c.id} className={styles.item} data-bad={blocked || undefined}>
                  <label className={styles.head}>
                    <input
                      type="checkbox"
                      checked={!blocked && picked.has(c.id)}
                      disabled={blocked || busy}
                      onChange={() => toggle(c.id)}
                    />
                    <span className={styles.title}>{titleOf(c)}</span>
                    {blocked && <span className={styles.blocked}>已拦下</span>}
                  </label>
                  <Diff change={c} />
                </li>
              );
            })}
          </ul>
        </details>

        <div className={styles.actions}>
          {draft.adopted ? (
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
          ) : (
            <Button size="sm" disabled={busy} onClick={onDiscard}>
              放弃
            </Button>
          )}
          <Link className={styles.full} to={tailorPath(view.job.id)}>
            在完整页面查看
          </Link>
          <span className={styles.grow} />
          <Button
            size="sm"
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
            {adopt.isPending && <Spinner label="采用中" />}
            {adopted ? "更新采用" : "采用"}（{chosen.length}）
          </Button>
        </div>
      </section>

      <div className={styles.scroll}>
        <ResumePreview resume={preview} resumeStyle={style} changeMarks={marks} label="定制版简历草稿" />
      </div>
    </div>
  );
}
