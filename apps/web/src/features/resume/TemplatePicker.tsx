import {
  ACCENT_INFO,
  RESUME_ACCENTS,
  RESUME_TEMPLATES,
  type ResumeAccent,
  type ResumeTemplate,
  TEMPLATE_INFO,
  templateUsesAccent,
} from "@talksume/core";
import { sampleResume } from "@talksume/resume-render/browser";
import { Check, ChevronDown, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "../../api/client.ts";
import type { ResumeContent } from "../../api/types.ts";
import { Spinner } from "../../components/ui.tsx";
import {
  type StyleRecommendation,
  type TriggerSize,
  useRecommendStyle,
  useResumeStyle,
  useSaveResumeStyle,
} from "./queries.ts";
import { ResumePreview } from "./ResumePreview.tsx";
import styles from "./TemplatePicker.module.css";

export function TemplatePicker({
  resume,
  size = "sm",
}: {
  resume: ResumeContent | undefined;
  size?: TriggerSize;
}) {
  const [open, setOpen] = useState(false);
  const [advice, setAdvice] = useState<StyleRecommendation | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const { style } = useResumeStyle();
  const save = useSaveResumeStyle();
  const recommend = useRecommendStyle();
  const accentOn = templateUsesAccent(style.template);
  const thumbContent = resume && (resume.basics.name || resume.sections.length > 0) ? resume : sampleResume;

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const { theme, css, ...preset } = style;
  const custom = Boolean(theme || css);
  const pickTemplate = (template: ResumeTemplate) => save.mutate({ ...preset, template });
  const pickAccent = (accent: ResumeAccent) => save.mutate({ ...preset, accent });
  const runRecommend = () => {
    setAdvice(null);
    recommend.mutate(undefined, {
      onSuccess: (result) => {
        setAdvice(result);
        save.mutate({ template: result.template, accent: result.accent });
      },
    });
  };
  const failure =
    recommend.error instanceof ApiError ? recommend.error.message : "智能推荐暂时不可用，请稍后再试";

  return (
    <div className={styles.root} ref={root}>
      <button
        type="button"
        className={size === "md" ? `${styles.trigger} ${styles.md}` : styles.trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span
          className={styles.dot}
          style={{
            background: theme
              ? theme.accent
              : custom
                ? "#6b7280"
                : accentOn
                  ? ACCENT_INFO[style.accent].hex
                  : "#111",
          }}
          aria-hidden="true"
        />
        {custom ? `AI 定制 · ${theme?.name ?? "参考图复刻"}` : TEMPLATE_INFO[style.template].label}
        <ChevronDown size={14} strokeWidth={1.8} aria-hidden="true" />
      </button>

      {open && (
        <div className={styles.panel} role="dialog" aria-label="选择简历模板">
          <div className={styles.top}>
            <span className={styles.heading}>简历模板</span>
            <button
              type="button"
              className={styles.smart}
              disabled={recommend.isPending}
              onClick={runRecommend}
            >
              {recommend.isPending ? (
                <Spinner label="正在推荐" />
              ) : (
                <Sparkles size={14} strokeWidth={1.8} aria-hidden="true" />
              )}
              {recommend.isPending ? "正在推荐…" : "智能推荐"}
            </button>
          </div>

          {advice && (
            <p className={styles.advice} role="status">
              <strong>
                已为你换成「{TEMPLATE_INFO[advice.template].label} · {ACCENT_INFO[advice.accent].label}」
              </strong>
              {advice.reason}
            </p>
          )}
          <p className={styles.custom}>
            {custom
              ? `当前是对话里定制的样式「${theme?.name ?? "参考图复刻"}」。选任一预设模板即可换回。`
              : "也可以直接在对话里说想要的风格，比如「稳重一点，标题用深绿，做成两栏」。"}
          </p>
          {recommend.isError && (
            <p className={`${styles.advice} ${styles.adviceError}`} role="alert">
              {failure}
            </p>
          )}

          <fieldset className={styles.grid} aria-label="模板">
            {RESUME_TEMPLATES.map((template) => {
              const selected = !custom && template === style.template;
              return (
                <button
                  key={template}
                  type="button"
                  aria-pressed={selected}
                  className={styles.card}
                  onClick={() => pickTemplate(template)}
                >
                  <span className={styles.thumb} aria-hidden="true">
                    <ResumePreview
                      as="span"
                      resume={thumbContent}
                      resumeStyle={{ template, accent: style.accent }}
                      decorated={false}
                      label={`${TEMPLATE_INFO[template].label}缩略图`}
                      className={styles.mini}
                    />
                    {selected && (
                      <span className={styles.check}>
                        <Check size={12} strokeWidth={2.5} />
                      </span>
                    )}
                  </span>
                  <span className={styles.name}>{TEMPLATE_INFO[template].label}</span>
                  <span className={styles.hint}>{TEMPLATE_INFO[template].hint}</span>
                </button>
              );
            })}
          </fieldset>

          <div className={styles.accents}>
            <span className={styles.accentLabel}>强调色</span>
            <fieldset className={styles.swatches} aria-label="强调色" disabled={!accentOn}>
              {RESUME_ACCENTS.map((accent) => (
                <button
                  key={accent}
                  type="button"
                  aria-pressed={!custom && accent === style.accent}
                  aria-label={ACCENT_INFO[accent].label}
                  title={ACCENT_INFO[accent].label}
                  className={styles.swatch}
                  style={{ background: ACCENT_INFO[accent].hex }}
                  onClick={() => pickAccent(accent)}
                />
              ))}
            </fieldset>
            <span className={styles.accentName}>
              {accentOn ? ACCENT_INFO[style.accent].label : "极简黑白不使用强调色"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
