import { useToast } from "../../components/Toast.tsx";
import { Button, Spinner } from "../../components/ui.tsx";
import { useResumeStyle } from "../resume/queries.ts";
import { ResumePreview } from "../resume/ResumePreview.tsx";
import { changeTitle, errorText, useTailorDraft } from "./changes.tsx";
import { type TailoringView, useTailorActions, useTailoring } from "./queries.ts";
import styles from "./TailorDraft.module.css";
import { VersionSwitch } from "./VersionSwitch.tsx";

interface Props {
  jobId: string;
  /** 独立简历页仍用旧状态条；对话面板不传，改用单行头部和版本菜单。 */
  onShowMain?: () => void;
  onDiscard?: () => void;
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
  return (
    <Draft
      key={view.tailoring.updatedAt}
      view={view}
      {...(onShowMain && { onShowMain })}
      {...(onDiscard && { onDiscard })}
    />
  );
}

function Draft({
  view,
  onShowMain,
  onDiscard,
}: {
  view: TailoringView;
  onShowMain?: () => void;
  onDiscard?: () => void;
}) {
  const draft = view.tailoring as NonNullable<TailoringView["tailoring"]>;
  const { style } = useResumeStyle();
  const { usable, chosen, numbers, preview, marks, toggle } = useTailorDraft(view.job.id, draft);
  const adopted = Boolean(draft.adopted && draft.selected.length > 0);

  return (
    <div className={styles.draft}>
      {onShowMain && onDiscard && <DraftBar view={view} onShowMain={onShowMain} onDiscard={onDiscard} />}
      {draft.stale && <p className={styles.warn}>主简历在生成这份定制后又更新过。</p>}
      {!adopted && usable.length > 1 && (
        <fieldset className={styles.picker} aria-label="选择要采用的改动">
          {usable.map((c) => {
            const on = chosen.some((x) => x.id === c.id);
            return (
              <label key={c.id} className={styles.pick} data-off={!on} title={changeTitle(c)}>
                <input
                  type="checkbox"
                  checked={on}
                  disabled={on && chosen.length === 1}
                  onChange={() => toggle(c.id)}
                />
                <span className={styles.pickNo}>{numbers.get(c.id)}</span>
                {changeTitle(c)}
              </label>
            );
          })}
        </fieldset>
      )}
      <div className={styles.scroll}>
        <ResumePreview
          resume={preview}
          resumeStyle={style}
          changeMarks={marks}
          label={adopted ? "定制版简历" : "定制版简历草稿"}
        />
      </div>
    </div>
  );
}

/** 独立简历页的状态条；对话里的面板改用单行头部，不再重复这一套按钮。 */
function DraftBar({
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
  const { adopt, revoke } = useTailorActions(view.job.id);
  const { chosen } = useTailorDraft(view.job.id, draft);
  const busy = adopt.isPending || revoke.isPending;
  const adopted = Boolean(draft.adopted && draft.selected.length > 0);

  return (
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
    </section>
  );
}
