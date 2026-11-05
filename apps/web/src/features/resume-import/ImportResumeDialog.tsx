import { useMutation } from "@tanstack/react-query";
import { FileUp } from "lucide-react";
import { type DragEvent, useId, useMemo, useRef, useState } from "react";
import { ApiError } from "../../api/client.ts";
import { Button, Spinner } from "../../components/ui.tsx";
import { Modal } from "../applications/Modal.tsx";
import {
  ACCEPT,
  checkFile,
  confirmImport,
  type ImportFact,
  type ImportItemStatus,
  type ImportPreview,
  type ImportResult,
  MAX_TEXT_CHARS,
  parseFile,
  parseText,
} from "./api.ts";
import styles from "./ImportResumeDialog.module.css";

export type ImportMode = "file" | "paste";

interface Props {
  /** 导入到这个会话；不传则新建一个会话。 */
  conversationId?: string;
  initialMode?: ImportMode;
  onClose: () => void;
  onImported: (result: ImportResult) => void;
}

const STATUS: Record<ImportItemStatus, { label: string; tone: string }> = {
  new: { label: "新增", tone: "new" },
  update: { label: "补充", tone: "update" },
  exists: { label: "已有", tone: "exists" },
  conflict: { label: "和已有不同，导入后确认", tone: "conflict" },
};

const PASTE_FALLBACK = new Set(["image_pdf", "pdf_encrypted", "empty_document", "bad_file"]);

const DEGREE: Record<string, string> = { associate: "专科", bachelor: "本科", master: "硕士", phd: "博士" };
const LEVEL: Record<string, string> = {
  beginner: "了解",
  familiar: "熟悉",
  proficient: "熟练",
  expert: "精通",
};
const BASICS: Record<string, string> = {
  name: "姓名",
  phone: "电话",
  email: "邮箱",
  city: "城市",
  summary: "自我评价",
  links: "链接",
  languages: "语言",
};

const period = (p: Record<string, unknown>) =>
  p.start || p.end
    ? `${String(p.start ?? "").replace("-", ".")}–${p.end === "present" ? "至今" : String(p.end ?? "").replace("-", ".")}`
    : "";

export function describeFact(fact: ImportFact): string {
  const p = fact.payload;
  const list = (v: unknown) => (Array.isArray(v) ? v.join("、") : "");
  const points =
    Array.isArray(p.highlights) && p.highlights.length > 0 ? `${p.highlights.length} 条要点` : "";
  const parts: unknown[] = (() => {
    switch (fact.section) {
      case "basics":
        return [
          Object.keys(p)
            .map((k) => BASICS[k] ?? k)
            .join("、"),
        ];
      case "education":
        return [DEGREE[String(p.degree)], p.major, p.gpa && `GPA ${p.gpa}`, p.rank, period(p)];
      case "experiences":
        return [p.department, p.title, period(p), points];
      case "projects":
        return [p.role, list(p.techStack), period(p), points];
      case "skills":
        return [LEVEL[String(p.level)], p.category];
      case "awards":
        return [String(p.date ?? "").replace("-", ".")];
      case "intention":
        return [list(p.roles), list(p.cities)];
      default:
        return [];
    }
  })();
  return parts.filter((x) => typeof x === "string" && x).join(" · ");
}

export function ImportResumeDialog({ conversationId, initialMode = "file", onClose, onImported }: Props) {
  const [mode, setMode] = useState<ImportMode>(initialMode);
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [excluded, setExcluded] = useState<ReadonlySet<number>>(new Set());
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const textId = useId();

  const parse = useMutation({
    mutationFn: () => (mode === "file" && file ? parseFile(file) : parseText(text)),
    onSuccess: (data) => {
      setPreview(data);
      setExcluded(new Set());
    },
  });

  const confirm = useMutation({
    mutationFn: () => {
      if (!preview) throw new Error("没有可导入的内容");
      return confirmImport({
        text: preview.text,
        ...(preview.source.fileName && { fileName: preview.source.fileName }),
        facts: preview.items.filter((_, i) => !excluded.has(i)).map((item) => item.fact),
        ...(conversationId && { conversationId }),
      });
    },
    onSuccess: onImported,
  });

  const pick = (next: File | undefined) => {
    if (!next) return;
    const problem = checkFile(next);
    setLocalError(problem);
    setFile(problem ? null : next);
    parse.reset();
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    pick(e.dataTransfer.files[0]);
  };

  const selected = preview ? preview.items.length - excluded.size : 0;
  const conflicts =
    preview?.items.filter((item, i) => item.status === "conflict" && !excluded.has(i)).length ?? 0;
  const ready = mode === "file" ? !!file : text.trim().length > 0;
  const error = localError ?? (parse.error as Error | null)?.message ?? null;
  const suggestPaste =
    mode === "file" && parse.error instanceof ApiError && PASTE_FALLBACK.has(parse.error.code);

  const grouped = useMemo(() => {
    if (!preview) return [];
    return preview.groups.map((g) => ({
      ...g,
      rows: preview.items
        .map((item, index) => ({ item, index }))
        .filter((r) => r.item.fact.section === g.section),
    }));
  }, [preview]);

  if (parse.isPending) {
    return (
      <Modal title="导入已有简历" onClose={onClose}>
        <div className={styles.waiting} role="status">
          <Spinner label="正在读取简历" />
          <p>正在读取简历，逐条核对原文，大约需要 20 秒…</p>
        </div>
      </Modal>
    );
  }

  if (preview) {
    const summary = preview.groups
      .map((g) =>
        g.section === "basics" || g.section === "intention"
          ? g.label
          : g.section === "skills"
            ? `技能 ${g.items.length} 项`
            : `${g.label} ${g.items.length} 条`,
      )
      .join("、");
    return (
      <Modal
        title="确认导入内容"
        onClose={onClose}
        footer={
          <>
            <Button
              disabled={confirm.isPending}
              onClick={() => {
                setPreview(null);
                parse.reset();
                confirm.reset();
              }}
            >
              重新选择
            </Button>
            <Button
              variant="primary"
              disabled={selected === 0 || confirm.isPending}
              onClick={() => confirm.mutate()}
            >
              {confirm.isPending ? "正在导入…" : `导入 ${selected} 条`}
            </Button>
          </>
        }
      >
        {preview.items.length === 0 ? (
          <p className={styles.lead}>没有读到能在原文里找到出处的内容。可以换一份文件，或改用粘贴文本。</p>
        ) : (
          <p className={styles.lead}>
            从你的简历里读到了 <strong>{preview.items.length}</strong> 条：{summary}。
            每条都能在原文里找到出处，取消勾选的不会导入。
            {conflicts > 0 && ` 其中 ${conflicts} 条和已有内容不同，导入后会逐条请你确认，不会直接覆盖。`}
          </p>
        )}
        {grouped.map((g) => (
          <section key={g.section} className={styles.group}>
            <h3 className={styles.groupTitle}>{g.label}</h3>
            <ul className={styles.items}>
              {g.rows.map(({ item, index }) => {
                const detail = describeFact(item.fact);
                const status = STATUS[item.status];
                return (
                  <li key={index} className={styles.item}>
                    <label className={styles.itemHead}>
                      <input
                        type="checkbox"
                        checked={!excluded.has(index)}
                        onChange={(e) =>
                          setExcluded((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.delete(index);
                            else next.add(index);
                            return next;
                          })
                        }
                      />
                      <span className={styles.itemLabel}>{item.label}</span>
                      <span className={`${styles.badge} ${styles[status.tone]}`}>{status.label}</span>
                    </label>
                    {detail && <p className={styles.itemDetail}>{detail}</p>}
                    <p className={styles.quote}>原文：「{item.fact.quote}」</p>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
        {preview.dropped.length > 0 && (
          <details className={styles.dropped}>
            <summary>{preview.dropped.length} 处在原文里找不到依据，已略过</summary>
            <ul>
              {preview.dropped.map((d, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: 只读列表
                <li key={i}>
                  {d.label}
                  {d.field ? `（${d.field}）` : ""}：{d.reason}
                </li>
              ))}
            </ul>
          </details>
        )}
        {confirm.error && (
          <p className={styles.error} role="alert">
            {(confirm.error as Error).message}
          </p>
        )}
      </Modal>
    );
  }

  return (
    <Modal
      title="导入已有简历"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" disabled={!ready} onClick={() => parse.mutate()}>
            开始读取
          </Button>
        </>
      }
    >
      <p className={styles.lead}>导入后我只追问简历里没写的部分，不用从头讲一遍。</p>
      <div className={styles.tabs} role="tablist">
        {(["file", "paste"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            className={styles.tab}
            onClick={() => {
              setMode(m);
              setLocalError(null);
              parse.reset();
            }}
          >
            {m === "file" ? "上传文件" : "粘贴文本"}
          </button>
        ))}
      </div>
      {mode === "file" ? (
        <button
          type="button"
          className={styles.drop}
          data-dragging={dragging || undefined}
          onClick={() => fileInput.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <FileUp size={22} strokeWidth={1.6} aria-hidden="true" />
          <span className={styles.dropMain}>{file ? file.name : "点击选择或拖入简历文件"}</span>
          <span className={styles.dropNote}>支持 PDF、Word（.docx），不超过 5MB；扫描件请改用粘贴文本</span>
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPT}
            hidden
            onChange={(e) => {
              pick(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </button>
      ) : (
        <>
          <label htmlFor={textId} className="sr-only">
            简历文字
          </label>
          <textarea
            id={textId}
            className={styles.paste}
            rows={10}
            maxLength={MAX_TEXT_CHARS}
            placeholder="打开简历，全选复制后粘贴到这里"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </>
      )}
      <p className={styles.privacy}>
        原文件只用来读取文字，不会保存；读到的文字会作为这次导入的出处保留在对话里。
      </p>
      {error && (
        <p className={styles.error} role="alert">
          {error}
          {suggestPaste && (
            <button
              type="button"
              className={styles.link}
              onClick={() => {
                setMode("paste");
                parse.reset();
              }}
            >
              改用粘贴文本
            </button>
          )}
        </p>
      )}
    </Modal>
  );
}
