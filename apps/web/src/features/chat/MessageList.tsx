import { Check, ChevronDown } from "lucide-react";
import { Fragment, useState } from "react";
import { SECTION_LABELS } from "../../api/types.ts";
import { Button, Chip } from "../../components/ui.tsx";
import { describeChange } from "./describe.ts";
import styles from "./MessageList.module.css";
import { type ChatMessage, type Conflict, messageText, type ProfileChange } from "./types.ts";

interface Props {
  messages: ChatMessage[];
  conflicts: Conflict[];
  streaming: boolean;
  resolving: boolean;
  onRetry: (key: string) => void;
  onResolve: (conflict: Conflict, choice: "proposed" | "previous") => void;
  onQuickReply: (text: string) => void;
}

export function MessageList({
  messages,
  conflicts,
  streaming,
  resolving,
  onRetry,
  onResolve,
  onQuickReply,
}: Props) {
  const pending = !streaming ? conflicts[0] : undefined;
  const last = messages.at(-1);
  const quickReplies =
    !streaming && !pending && last?.role === "assistant" && last.state === "done" ? last.quickReplies : [];
  return (
    <div className={styles.thread} aria-busy={streaming}>
      {messages.map((m) =>
        m.role === "user" ? (
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
          <Assistant key={m.key} message={m} />
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

function Assistant({ message }: { message: ChatMessage }) {
  const text = messageText(message);
  const waiting = message.state === "streaming" && !text && message.changes.length === 0;
  return (
    <div className={styles.assistant}>
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

function Written({ changes }: { changes: ProfileChange[] }) {
  const [open, setOpen] = useState(true);
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
