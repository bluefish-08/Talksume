import { ArrowUp, ImagePlus, Paperclip, Square, X } from "lucide-react";
import {
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  useEffect,
  useId,
  useRef,
} from "react";
import { IMAGE_ACCEPT } from "../../api/images.ts";
import styles from "./Composer.module.css";
import { ModelPicker } from "./ModelPicker.tsx";
import type { ImageDraft } from "./useImageDraft.ts";
import { MAX_DRAFT_IMAGES } from "./useImageDraft.ts";

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
  /** 参考图（简历模板截图）：传了才显示图片按钮，和导入简历是两回事。 */
  images?: ImageDraft;
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
  images,
}: Props) {
  const id = useId();
  const local = useRef<HTMLTextAreaElement | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const hasImage = (images?.ids.length ?? 0) > 0;
  const canSend = (value.trim().length > 0 || hasImage) && !images?.uploading && !pending && !streaming;

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
      {images && images.items.length > 0 && (
        <ul className={styles.thumbs} aria-label="待发送的图片">
          {images.items.map((item) => (
            <li key={item.key} className={styles.thumb} data-status={item.status}>
              <img src={item.preview} alt={item.name} />
              {item.status === "uploading" && <span className={styles.uploading}>上传中</span>}
              <button
                type="button"
                className={styles.thumbRemove}
                aria-label={`移除图片 ${item.name}`}
                onClick={() => images.remove(item.key)}
              >
                <X size={12} strokeWidth={2.2} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
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
        {images && (
          <>
            <input
              ref={fileInput}
              type="file"
              accept={IMAGE_ACCEPT}
              hidden
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void images.add(file);
              }}
            />
            <button
              type="button"
              className={styles.attach}
              aria-label="添加参考图"
              title="发一张简历模板截图，让助手照着复刻样式"
              disabled={images.items.length >= MAX_DRAFT_IMAGES}
              onClick={() => fileInput.current?.click()}
            >
              <ImagePlus size={16} strokeWidth={1.6} aria-hidden="true" />
            </button>
          </>
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
