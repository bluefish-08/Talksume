import { useProfile, useStartConversation } from "../api/queries.ts";
import { Button, EmptyState, Spinner } from "../components/ui.tsx";
import { CompletenessBar } from "../features/resume/CompletenessBar.tsx";
import { ExportMenu } from "../features/resume/ExportMenu.tsx";
import { PolishButton } from "../features/resume/PolishButton.tsx";
import { useFacts, useResume, useResumeStyle } from "../features/resume/queries.ts";
import { ResumePreview } from "../features/resume/ResumePreview.tsx";
import { factQuotes, placeholderTitles } from "../features/resume/resumeUtils.ts";
import { TemplatePicker } from "../features/resume/TemplatePicker.tsx";
import styles from "./Resume.module.css";

export function ResumePage() {
  const resume = useResume();
  const profile = useProfile();
  const facts = useFacts();
  const start = useStartConversation();
  const { style } = useResumeStyle();

  const content = resume.data?.resume;
  const completeness = profile.data?.completeness;
  const isEmpty = !!content && !content.basics.name && content.sections.length === 0;

  return (
    <div className={styles.page}>
      <header className={styles.bar}>
        <h1 className={styles.title}>我的简历</h1>
        <div className={styles.progress}>
          <CompletenessBar completeness={completeness} />
        </div>
        <TemplatePicker resume={content} />
        <ExportMenu />
        <PolishButton />
      </header>

      <div className={styles.canvas}>
        {resume.isPending && (
          <div className={styles.center}>
            <Spinner />
          </div>
        )}
        {resume.isError && (
          <EmptyState title="简历加载失败">
            <Button variant="primary" onClick={() => void resume.refetch()}>
              重试
            </Button>
          </EmptyState>
        )}
        {content && isEmpty && (
          <EmptyState title="还没有简历内容">
            <p className={styles.hint}>和助手聊几句，简历就会自动生成。</p>
            <Button variant="primary" size="lg" disabled={start.isPending} onClick={() => start.mutate()}>
              开始聊聊
            </Button>
          </EmptyState>
        )}
        {content && !isEmpty && (
          <div className={styles.sheet}>
            <ResumePreview
              resume={content}
              resumeStyle={style}
              facts={factQuotes(facts.data)}
              placeholders={placeholderTitles(content, completeness)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
