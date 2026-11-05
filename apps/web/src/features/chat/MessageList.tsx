import { Check, ChevronDown, FileText } from "lucide-react";
import { Fragment, useState } from "react";
import { SECTION_LABELS } from "../../api/types.ts";
import { Button, Chip } from "../../components/ui.tsx";
import { describeChange } from "./describe.ts";
import { JobAbout, JobCards } from "./JobCards.tsx";
import styles from "./MessageList.module.css";
import { TailorCardView } from "./TailorCard.tsx";
import {
  type ChatMessage,
  type Conflict,
  messageText,
  type ProfileChange,
  type TailorCard,
} from "./types.ts";

interface Props {
  messages: ChatMessage[];
  conflicts: Conflict[];
  streaming: boolean;
  resolving: boolean;
  onRetry: (key: string) => void;
  onResolve: (conflict: Conflict, choice: "proposed" | "previous") => void;
  onQuickReply: (text: string) => void;
  onOpenTailor: (card: TailorCard) => void;
}

export function MessageList({
  messages,
  conflicts,
  streaming,
  resolving,
  onRetry,
  onResolve,
  onQuickReply,
  onOpenTailor,
}: Props) {
  const pending = !streaming ? conflicts[0] : undefined;
  const last = messages.at(-1);
  const quickReplies =
    !streaming && !pending && last?.role === "assistant" && last.state === "done" ? last.quickReplies : [];
  return (
    <div className={styles.thread} aria-busy={streaming}>
      {messages.map((m) =>
        m.role === "user" && m.resumeImport ? (
          <ImportedResume key={m.key} message={m} />
        ) : m.role === "user" ? (
          <div key={m.key} className={styles.userWrap}>
            <div className={styles.user}>{m.text}</div>
            {m.state === "failed" && (
              <div className={styles.failed} role="alert">
                <span>{m.error}</span>
                <button type="button" className={styles.retry} onClick={() => onRetry(m.key)}>
                  重试
                </button>
              </div>
            )}
          </div>
        ) : (
          <Assistant key={m.key} message={m} onOpenTailor={onOpenTailor} />
        ),
      )}
      {pending && (
        <div className={styles.confirm}>
          <span className={styles.confirmLabel}>关于「{pending.label}」，以哪个为准？</span>
          <div className={styles.confirmBtns}>
            <Button
              variant="primary"
              size="sm"
              disabled={resolving}
              onClick={() => onResolve(pending, "proposed")}
            >
              采用新的
            </Button>
            <Button size="sm" disabled={resolving} onClick={() => onResolve(pending, "previous")}>
              保留原来的
            </Button>
          </div>
        </div>
      )}
      {quickReplies.length > 0 && (
        <div className={styles.quickReplies}>
          {quickReplies.map((text) => (
            <Chip key={text} onClick={() => onQuickReply(text)}>
              {text}
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
}

function Assistant({
  message,
  onOpenTailor,
}: {
  message: ChatMessage;
  onOpenTailor: (card: TailorCard) => void;
}) {
  const text = messageText(message);
  const waiting =
    message.state === "streaming" &&
    !text &&
    message.changes.length === 0 &&
    message.jobs.length === 0 &&
    !message.about &&
    !message.tailor;
  return (
    <div className={styles.assistant}>
      {message.about && <JobAbout job={message.about} />}
      {message.changes.length > 0 && <Written changes={message.changes} />}
      {waiting && (
        <span className={styles.typing} role="status" aria-label="正在回复">
          <i />
          <i />
          <i />
        </span>
      )}
      {text && (
        <div className={styles.text}>
          {text.split("\n").map((line, i) => (
            // 段落只增不改，下标即稳定标识
            // biome-ignore lint/suspicious/noArrayIndexKey: 同上
            <p key={i}>{inline(line)}</p>
          ))}
        </div>
      )}
      {message.jobs.length > 0 && <JobCards jobs={message.jobs} />}
      {message.tailor && <TailorCardView card={message.tailor} onOpen={onOpenTailor} />}
    </div>
  );
}

/** 只认 **加粗**，其余按纯文本，避免把模型输出当 HTML。 */
function inline(line: string) {
  return line.split(/\*\*(.+?)\*\*/g).map((part, i) =>
    // biome-ignore lint/suspicious/noArrayIndexKey: 切分结果顺序固定
    i % 2 === 1 ? <strong key={i}>{part}</strong> : <Fragment key={i}>{part}</Fragment>,
  );
}

function ImportedResume({ message }: { message: ChatMessage }) {
  const note = message.resumeImport;
  return (
    <div className={styles.userWrap}>
      <details className={styles.imported}>
        <summary className={styles.importedHead}>
          <FileText size={16} strokeWidth={1.6} aria-hidden="true" />
          <span>
            已导入简历{note?.fileName ? `「${note.fileName}」` : ""} · {note?.facts ?? 0} 条
          </span>
          <ChevronDown size={14} strokeWidth={1.8} aria-hidden="true" className={styles.importedChev} />
        </summary>
        <pre className={styles.importedText}>
          {message.text.replace(/^\[[^\]\n]*简历原文[^\]\n]*\]\n/, "")}
        </pre>
      </details>
    </div>
  );
}

const WRITTEN_OPEN_LIMIT = 6;

function Written({ changes }: { changes: ProfileChange[] }) {
  const [open, setOpen] = useState(changes.length <= WRITTEN_OPEN_LIMIT);
  return (
    <div className={styles.written}>
      <button
        type="button"
        className={styles.writtenBtn}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.tick} aria-hidden="true">
          <Check size={12} strokeWidth={2.4} />
        </span>
        已写入简历 {changes.length} 条
        <ChevronDown
          size={14}
          strokeWidth={1.8}
          aria-hidden="true"
          className={open ? styles.up : undefined}
        />
      </button>
      {open && (
        <ul className={styles.changes}>
          {changes.map((c, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 变更列表只读
            <li key={i}>
              <span className={styles.changeSection}>{SECTION_LABELS[c.section]}</span>
              {describeChange(c)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
