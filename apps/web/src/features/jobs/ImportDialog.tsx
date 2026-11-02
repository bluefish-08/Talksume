import { type FormEvent, useId, useState } from "react";
import { ApiError } from "../../api/client.ts";
import { Button, Spinner } from "../../components/ui.tsx";
import styles from "./Dialogs.module.css";
import { useImportJob } from "./hooks.ts";
import { Modal } from "./Modal.tsx";
import type { ImportResult } from "./types.ts";

const MIN = 20;
const MAX = 20000;

function validate(text: string, url: string): { text?: string; url?: string } {
  const errors: { text?: string; url?: string } = {};
  const len = text.trim().length;
  if (len < MIN) errors.text = `岗位描述至少 ${MIN} 个字，现在 ${len} 个`;
  else if (len > MAX) errors.text = `岗位描述最多 ${MAX} 个字`;
  if (url.trim()) {
    try {
      const u = new URL(url.trim());
      if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("protocol");
    } catch {
      errors.url = "请填写以 http:// 或 https:// 开头的链接";
    }
  }
  return errors;
}

export function ImportDialog({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (r: ImportResult) => void;
}) {
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [touched, setTouched] = useState(false);
  const importJob = useImportJob();
  const textId = useId();
  const urlId = useId();
  const errors = validate(text, url);
  const showErrors = touched;

  function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (errors.text || errors.url) return;
    importJob.mutate({ text: text.trim(), ...(url.trim() && { url: url.trim() }) }, { onSuccess: onDone });
  }

  return (
    <Modal title="粘贴 JD 测匹配" onClose={onClose}>
      <form className={styles.form} onSubmit={submit} noValidate>
        <div className={styles.field}>
          <label htmlFor={textId}>岗位描述（JD）</label>
          <textarea
            id={textId}
            className={styles.textarea}
            rows={9}
            value={text}
            placeholder="把招聘页面上的岗位职责、任职要求整段粘贴到这里"
            aria-invalid={showErrors && Boolean(errors.text)}
            aria-describedby={`${textId}-hint`}
            onChange={(e) => setText(e.target.value)}
          />
          <span id={`${textId}-hint`} className={showErrors && errors.text ? styles.error : styles.hint}>
            {showErrors && errors.text ? errors.text : `至少 ${MIN} 个字`}
          </span>
        </div>
        <div className={styles.field}>
          <label htmlFor={urlId}>原岗位链接（选填）</label>
          <input
            id={urlId}
            className={styles.input}
            type="url"
            inputMode="url"
            value={url}
            placeholder="https://"
            aria-invalid={showErrors && Boolean(errors.url)}
            onChange={(e) => setUrl(e.target.value)}
          />
          {showErrors && errors.url && <span className={styles.error}>{errors.url}</span>}
        </div>
        {importJob.error && (
          <p className={styles.error} role="alert">
            {importJob.error instanceof ApiError ? importJob.error.message : "导入失败，请稍后再试"}
          </p>
        )}
        <div className={styles.actions}>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" variant="primary" disabled={importJob.isPending}>
            {importJob.isPending ? (
              <>
                <Spinner label="分析中" />
                分析中…
              </>
            ) : (
              "测匹配"
            )}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
