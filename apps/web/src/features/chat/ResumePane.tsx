import type { Completeness, ResumeContent } from "../../api/types.ts";
import { Button, Spinner } from "../../components/ui.tsx";
import { ExportMenu } from "../resume/ExportMenu.tsx";
import { PolishPreview } from "../resume/PolishPreview.tsx";
import { useResumeStyle } from "../resume/queries.ts";
import { ResumePreview } from "../resume/ResumePreview.tsx";
import { placeholderTitles } from "../resume/resumeUtils.ts";
import { TemplatePicker } from "../resume/TemplatePicker.tsx";
import { TailorDraft } from "../tailor/TailorDraft.tsx";
import { useTailorVersion } from "../tailor/useTailorVersion.ts";
import { VersionMenu } from "../tailor/VersionMenu.tsx";
import styles from "./ResumePane.module.css";
import type { TailorStatus } from "./tailorCards.ts";

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
  /** 打开润色预览（由「在右边看」触发）。 */
  polishOpen: boolean;
  onPolishClose: () => void;
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
  polishOpen,
  onPolishClose,
  onTailorShow,
  onTailorDiscard,
  onAskAi,
  streaming,
}: Props) {
  const { style } = useResumeStyle();
  const version = useTailorVersion(tailorJob?.jobId, () => onTailorShow(false));
  const showing = Boolean(tailor && tailor.jobId === tailorJob?.jobId && tailor.showing);
  const onTailored = showing && Boolean(tailorJob);
  const pct = Math.round(completeness.score * 100);

  return (
    <aside className={styles.pane} aria-label="简历">
      <ResumePaneHeader
        resume={resume}
        pct={pct}
        tailorJob={tailorJob}
        status={version.status}
        changes={version.changes}
        showing={showing}
        busy={version.busy}
        canAdopt={version.chosen.length > 0}
        adopting={version.adopting}
        onAskAi={onAskAi}
        askAiDisabled={streaming}
        onShow={onTailorShow}
        onDiscard={onTailorDiscard}
        onAdopt={version.onAdopt}
        onRevoke={version.onRevoke}
      />

      {polishOpen ? (
        <PolishPreview resume={resume} resumeStyle={style} onClose={onPolishClose} />
      ) : onTailored && tailorJob ? (
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
        <TailorVersionControls
          company={tailorJob.company}
          status={status}
          changes={changes}
          showing={showing}
          busy={busy}
          canAdopt={canAdopt}
          adopting={adopting}
          onShow={onShow}
          onDiscard={onDiscard}
          onAdopt={onAdopt}
          onRevoke={onRevoke}
        />
      )}
      <TemplatePicker resume={resume} icon onAskAi={onAskAi} askAiDisabled={askAiDisabled} />
      <ExportMenu icon />
    </header>
  );
}

/** 版本下拉加「用这版」；对话面板和简历页头部共用。 */
export function TailorVersionControls({
  company,
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
}: {
  company: string;
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
}) {
  return (
    <>
      <VersionMenu
        company={company}
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
  );
}
