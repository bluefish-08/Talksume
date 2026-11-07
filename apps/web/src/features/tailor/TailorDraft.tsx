import { useToast } from "../../components/Toast.tsx";
import { Button, Spinner } from "../../components/ui.tsx";
import { useResumeStyle } from "../resume/queries.ts";
import { ResumePreview } from "../resume/ResumePreview.tsx";
import { errorText, useTailorDraft } from "./changes.tsx";
import { type TailoringView, useTailorActions, useTailoring } from "./queries.ts";
import styles from "./TailorDraft.module.css";
import { VersionSwitch } from "./VersionSwitch.tsx";

interface Props {
  jobId: string;
  /** 切回主简历预览，草稿还在。 */
  onShowMain: () => void;
  /** 放弃只是收起草稿，服务端的草稿和主简历都不动。 */
  onDiscard: () => void;
}

/** 简历面板里的定制版预览：改动高亮、编号与卡片一致，采用前主简历不变。 */
export function TailorDraft({ jobId, onShowMain, onDiscard }: Props) {
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
          {query.isError ? errorText(query.error) : "还没有针对这个岗位的定制版，在对话里让 AI 改一版。"}
        </p>
      </div>
    );
  }
  return <Draft key={view.tailoring.updatedAt} view={view} onShowMain={onShowMain} onDiscard={onDiscard} />;
}

function Draft({
  view,
  onShowMain,
  onDiscard,
}: {
  view: TailoringView;
  onShowMain: () => void;
  onDiscard: () => void;
}) {
  const draft = view.tailoring as NonNullable<TailoringView["tailoring"]>;
  const toast = useToast();
  const { style } = useResumeStyle();
  const { adopt, revoke } = useTailorActions(view.job.id);
  const { chosen, preview, marks } = useTailorDraft(draft);
  const busy = adopt.isPending || revoke.isPending;
  const adopted = Boolean(draft.adopted && draft.selected.length > 0);

  return (
    <div className={styles.draft}>
      <section className={styles.bar} data-tone={adopted ? "ok" : "draft"} aria-label="定制版状态">
        <div className={styles.row}>
          <VersionSwitch
            className={styles.switch}
            label={`${view.job.company}定制版`}
            showing
            onShow={(showing) => {
              if (!showing) onShowMain();
            }}
          />
          {adopted ? (
            <span className={styles.ok}>
              <i aria-hidden="true" />
              已采用 · 投这个岗位时使用
            </span>
          ) : (
            <span className={styles.state}>{draft.changes.length} 处改动 · 草稿</span>
          )}
          <span className={styles.grow} />
          {adopted ? (
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                revoke.mutate(undefined, {
                  onSuccess: () => toast("已改回主简历，投递这个岗位时不再用定制版"),
                  onError: (e) => toast(errorText(e), { tone: "error" }),
                })
              }
            >
              改回主简历
            </Button>
          ) : (
            <>
              <Button size="sm" disabled={busy} onClick={onDiscard}>
                放弃
              </Button>
              <Button
                variant="dark"
                size="sm"
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
                用这版
              </Button>
            </>
          )}
        </div>
        {draft.stale && <p className={styles.warn}>主简历在生成这份定制后又更新过。</p>}
      </section>

      <div className={styles.scroll}>
        <ResumePreview resume={preview} resumeStyle={style} changeMarks={marks} label="定制版简历草稿" />
      </div>
    </div>
  );
}
