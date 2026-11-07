import type { Completeness, ResumeContent } from "../../api/types.ts";
import { useToast } from "../../components/Toast.tsx";
import { Button, Spinner } from "../../components/ui.tsx";
import { ExportMenu } from "../resume/ExportMenu.tsx";
import { PolishButton } from "../resume/PolishButton.tsx";
import { useResumeStyle } from "../resume/queries.ts";
import { ResumePreview } from "../resume/ResumePreview.tsx";
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
  /** 这场对话里最近一次定制的岗位；没有定制版时为空。 */
  tailorJob: TailorJob | null;
  tailor: TailorTarget | null;
  onTailorShow: (showing: boolean) => void;
  onTailorDiscard: () => void;
  onAskAi: () => void;
  streaming: boolean;
}

/** 面板里打开的定制版；at 每次请求打开都会变，用来触发重新展开。 */
export interface TailorTarget {
  jobId: string;
  company: string;
  title: string;
  showing: boolean;
  at: number;
}

export function ResumePane({
  resume,
  completeness,
  highlights,
  tailorJob,
  tailor,
  onTailorShow,
  onTailorDiscard,
  onAskAi,
  streaming,
}: Props) {
  const toast = useToast();
  const { style } = useResumeStyle();
  const tailoring = useTailoring(tailorJob?.jobId);
  const { adopt, revoke } = useTailorActions(tailorJob?.jobId ?? "");
  const view = tailoring.data?.tailoring;
  const status = cardStatus(view);
  const showing = Boolean(tailor && tailor.jobId === tailorJob?.jobId && tailor.showing);
  const onTailored = showing && Boolean(tailorJob);
  const pct = Math.round(completeness.score * 100);
  const usable = view?.changes.filter((c) => c.violations.length === 0).map((c) => c.id) ?? [];
  const chosen =
    view && view.selected.length > 0 ? view.selected.filter((id) => usable.includes(id)) : usable;
  const busy = adopt.isPending || revoke.isPending;

  return (
    <aside className={styles.pane} aria-label="简历">
      <ResumePaneHeader
        resume={resume}
        pct={pct}
        tailorJob={tailorJob}
        status={status}
        changes={view?.changes.length ?? 0}
        showing={showing}
        busy={busy}
        canAdopt={chosen.length > 0}
        adopting={adopt.isPending}
        onAskAi={onAskAi}
        askAiDisabled={streaming}
        onShow={onTailorShow}
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
      ) : (
        <div className={styles.body}>
          <ResumePreview
            resume={resume}
            resumeStyle={style}
            highlightTexts={highlights}
            placeholders={placeholderTitles(resume, completeness)}
          />
        </div>
      )}
    </aside>
  );
}

interface HeaderProps {
  resume: ResumeContent;
  pct: number;
  tailorJob: TailorJob | null;
  status: TailorStatus;
  changes: number;
  showing: boolean;
  busy: boolean;
  canAdopt: boolean;
  adopting: boolean;
  onAskAi: () => void;
  askAiDisabled: boolean;
  onShow: (showing: boolean) => void;
  onDiscard: () => void;
  onAdopt: () => void;
  onRevoke: () => void;
}

export function ResumePaneHeader({
  resume,
  pct,
  tailorJob,
  status,
  changes,
  showing,
  busy,
  canAdopt,
  adopting,
  onAskAi,
  askAiDisabled,
  onShow,
  onDiscard,
  onAdopt,
  onRevoke,
}: HeaderProps) {
  return (
    <header className={styles.head}>
      <h2 className={styles.title}>
        简历 <span className={styles.count}>{pct}%</span>
      </h2>
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
      <TemplatePicker resume={resume} icon onAskAi={onAskAi} askAiDisabled={askAiDisabled} />
      {!showing && <PolishButton icon />}
      <ExportMenu icon />
    </header>
  );
}
