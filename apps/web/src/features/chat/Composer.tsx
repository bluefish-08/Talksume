import { ArrowUp, Paperclip, Square } from "lucide-react";
import { type KeyboardEvent, type ReactNode, type Ref, useEffect, useId, useRef } from "react";
import styles from "./Composer.module.css";
import { ModelPicker } from "./ModelPicker.tsx";

export const MAX_MESSAGE_LENGTH = 4000;

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  /** 流式回复中：发送键变成停止键。 */
  streaming?: boolean;
  onStop?: () => void;
  /** 提交中（非流式）时禁用发送。 */
  pending?: boolean;
  variant: "home" | "chat";
  label: string;
  placeholder: string;
  rows: number;
  /** 模型选择器后面的位置：意向胶囊或快捷键提示。 */
  tools?: ReactNode;
  inputRef?: Ref<HTMLTextAreaElement>;
  /** 附件按钮：导入已有简历。不传则按钮禁用。 */
  onAttach?: () => void;
}

const MAX_HEIGHT = 220;

export function Composer({
  value,
  onChange,
  onSubmit,
  streaming,
  onStop,
  pending,
  variant,
  label,
  placeholder,
  rows,
  tools,
  inputRef,
  onAttach,
}: Props) {
  const id = useId();
  const local = useRef<HTMLTextAreaElement | null>(null);
  const canSend = value.trim().length > 0 && !pending && !streaming;

  // biome-ignore lint/correctness/useExhaustiveDependencies: value 变化时重算高度
  useEffect(() => {
    const el = local.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [value]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // 输入法选词时的回车不能当作发送
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    if (canSend) onSubmit();
  };

  return (
    <form
      className={`${styles.box} ${styles[variant]}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend) onSubmit();
      }}
    >
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <textarea
        id={id}
        ref={(el) => {
          local.current = el;
          if (typeof inputRef === "function") inputRef(el);
          else if (inputRef) inputRef.current = el;
        }}
        className={styles.input}
        rows={rows}
        maxLength={MAX_MESSAGE_LENGTH}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className={styles.tools}>
        {onAttach ? (
          <button
            type="button"
            className={styles.attach}
            aria-label="导入已有简历"
            title="导入已有简历（PDF / Word / 粘贴文本）"
            onClick={onAttach}
          >
            <Paperclip size={16} strokeWidth={1.6} aria-hidden="true" />
          </button>
        ) : (
          <span title="即将支持">
            <button type="button" className={styles.attach} aria-label="添加附件（即将支持）" disabled>
              <Paperclip size={16} strokeWidth={1.6} aria-hidden="true" />
            </button>
          </span>
        )}
        <ModelPicker />
        {tools}
        <span className={styles.grow} />
        {streaming ? (
          <button
            type="button"
            className={styles.send}
            aria-label="停止回复"
            title="停止回复"
            onClick={onStop}
          >
            <Square size={13} fill="currentColor" strokeWidth={0} aria-hidden="true" />
          </button>
        ) : (
          <button type="submit" className={styles.send} aria-label="发送" title="发送" disabled={!canSend}>
            <ArrowUp size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        )}
      </div>
    </form>
  );
}
