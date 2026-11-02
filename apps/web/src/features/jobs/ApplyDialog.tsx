import { ExternalLink } from "lucide-react";
import { ApiError } from "../../api/client.ts";
import { Button, Spinner } from "../../components/ui.tsx";
import styles from "./Dialogs.module.css";
import { useMarkApplied } from "./hooks.ts";
import { Modal } from "./Modal.tsx";

export interface ManualApply {
  applicationId: string;
  company: string;
  title: string;
  url?: string | null;
  submitError?: string;
}

export function ApplyDialog({
  apply,
  onClose,
  onApplied,
}: {
  apply: ManualApply;
  onClose: () => void;
  onApplied: () => void;
}) {
  const mark = useMarkApplied();

  return (
    <Modal title="还差一步：去官网投递" onClose={onClose}>
      <p className={styles.lead}>
        {apply.company}「{apply.title}」需要在公司官网提交。投完回来点「我已投递」，我们会把它记进投递进度。
      </p>
      {apply.submitError && (
        <p className={styles.notice}>自动投递没有成功（{apply.submitError}），已改为你手动投递。</p>
      )}
      {mark.error && (
        <p className={styles.error} role="alert">
          {mark.error instanceof ApiError ? mark.error.message : "记录失败，请稍后再试"}
        </p>
      )}
      <div className={styles.actions}>
        <Button variant="ghost" onClick={onClose}>
          稍后再说
        </Button>
        {apply.url ? (
          <a className={styles.linkBtn} href={apply.url} target="_blank" rel="noreferrer">
            去官网投递
            <ExternalLink size={14} strokeWidth={1.6} aria-hidden="true" />
          </a>
        ) : (
          <span className={styles.hint}>这个岗位没有官网链接</span>
        )}
        <Button
          variant="primary"
          disabled={mark.isPending}
          onClick={() => mark.mutate(apply.applicationId, { onSuccess: onApplied })}
        >
          {mark.isPending && <Spinner label="提交中" />}我已投递
        </Button>
      </div>
    </Modal>
  );
}
