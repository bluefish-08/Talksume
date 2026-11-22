import {
  ACCENT_INFO,
  RESUME_ACCENTS,
  RESUME_TEMPLATES,
  type ResumeAccent,
  type ResumeStyle,
  type ResumeTemplate,
  TEMPLATE_INFO,
  templateUsesAccent,
} from "@talksume/core";
import { sampleResume } from "@talksume/resume-render/browser";
import { Check, ChevronDown, Palette, Sparkles, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ResumeContent } from "../../api/types.ts";
import {
  type ResumeStyleDesign,
  type TriggerSize,
  useApplyResumeStyleDesign,
  useDeleteResumeStyleDesign,
  useResumeStyle,
  useResumeStyleDesigns,
  useSaveResumeStyle,
} from "./queries.ts";
import { ResumePreview } from "./ResumePreview.tsx";
import styles from "./TemplatePicker.module.css";

/** 非图标触发器显示：定制样式用主题名，否则用模板名。 */
export function styleLabel(style: ResumeStyle): string {
  const custom = Boolean(style.theme || style.css);
  return custom && style.theme ? style.theme.name : TEMPLATE_INFO[style.template].label;
}

export interface StylePanelProps {
  resume: ResumeContent | undefined;
  style: ResumeStyle;
  designs: readonly ResumeStyleDesign[];
  currentId: string | null;
  onPickTemplate: (template: ResumeTemplate) => void;
  onPickAccent: (accent: ResumeAccent) => void;
  onApplyDesign: (id: string) => void;
  onDeleteDesign: (id: string) => void;
  onAskAi: () => void;
  askAiDisabled?: boolean;
}

export function StylePanel({
  resume,
  style,
  designs,
  currentId,
  onPickTemplate,
  onPickAccent,
  onApplyDesign,
  onDeleteDesign,
  onAskAi,
  askAiDisabled = false,
}: StylePanelProps) {
  const accentOn = templateUsesAccent(style.template);
  const custom = Boolean(style.theme || style.css);
  const thumbContent = resume && (resume.basics.name || resume.sections.length > 0) ? resume : sampleResume;

  return (
    <>
      <div className={styles.scroll}>
        <div className={styles.top}>
          <span className={styles.heading}>简历样式</span>
        </div>

        {designs.length > 0 && (
          <section className={styles.section} aria-label="我的设计">
            <h3 className={styles.sectionTitle}>我的设计</h3>
            <div className={styles.designGrid}>
              {designs.map((design) => {
                const current = design.id === currentId;
                return (
                  <div key={design.id} className={styles.designCard}>
                    <button
                      type="button"
                      className={styles.designApply}
                      aria-pressed={current}
                      aria-label={`应用设计「${design.name}」`}
                      data-current={current ? "true" : undefined}
                      onClick={() => onApplyDesign(design.id)}
                    >
                      <span className={styles.designThumb}>
                        <ResumePreview
                          as="span"
                          resume={thumbContent}
                          resumeStyle={design.style}
                          decorated={false}
                          label={`${design.name}缩略图`}
                          className={styles.mini}
                        />
                        {current && (
                          <span className={styles.check}>
                            <Check size={12} strokeWidth={2.5} />
                          </span>
                        )}
                      </span>
                      <span className={styles.designName}>{design.name}</span>
                    </button>
                    {!current && (
                      <button
                        type="button"
                        className={styles.designDelete}
                        aria-label={`删除设计「${design.name}」`}
                        onClick={() => onDeleteDesign(design.id)}
                      >
                        <X size={12} strokeWidth={2.2} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <section className={styles.section} aria-label="预设模板">
          <h3 className={styles.sectionTitle}>预设模板</h3>
          <fieldset className={`${styles.designGrid} ${styles.presetGrid}`} aria-label="模板">
            {RESUME_TEMPLATES.map((template) => {
              const selected = !custom && template === style.template;
              const hint = TEMPLATE_INFO[template].hint;
              return (
                <div key={template} className={styles.designCard}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    aria-label={`使用模板「${TEMPLATE_INFO[template].label}」`}
                    aria-description={hint}
                    title={hint}
                    className={styles.designApply}
                    onClick={() => onPickTemplate(template)}
                  >
                    <span className={styles.designThumb} aria-hidden="true">
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
                    <span className={styles.designName}>{TEMPLATE_INFO[template].label}</span>
                  </button>
                </div>
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
                  onClick={() => onPickAccent(accent)}
                />
              ))}
            </fieldset>
            <span className={styles.accentName}>
              {accentOn ? ACCENT_INFO[style.accent].label : "极简黑白不使用强调色"}
            </span>
          </div>
        </section>
      </div>

      <div className={styles.footer}>
        <button
          type="button"
          className={styles.askAi}
          disabled={askAiDisabled}
          title={askAiDisabled ? "等这条回复完再试" : undefined}
          aria-description={askAiDisabled ? "等这条回复完再试" : undefined}
          onClick={askAiDisabled ? undefined : onAskAi}
        >
          <Sparkles size={15} strokeWidth={1.8} aria-hidden="true" />让 AI 再设计几版
        </button>
      </div>
    </>
  );
}

export function TemplatePicker({
  resume,
  size = "sm",
  icon = false,
  onAskAi,
  askAiDisabled = false,
}: {
  resume: ResumeContent | undefined;
  size?: TriggerSize;
  icon?: boolean;
  onAskAi: () => void;
  askAiDisabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>();
  const { style } = useResumeStyle();
  const save = useSaveResumeStyle();
  const designList = useResumeStyleDesigns();
  const applyDesign = useApplyResumeStyleDesign();
  const deleteDesign = useDeleteResumeStyleDesign();
  const accentOn = templateUsesAccent(style.template);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!root.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false);
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

  // 面板挂到 body 并按触发按钮定位，侧栏的裁切和层级都挡不住
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = root.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(440, window.innerWidth - 24);
      setPos({
        top: rect.bottom + 6,
        left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)),
      });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

  const { theme, css, ...preset } = style;
  const custom = Boolean(theme || css);
  const pickTemplate = (next: ResumeTemplate) => save.mutate({ ...preset, template: next });
  const pickAccent = (next: ResumeAccent) => save.mutate({ ...preset, accent: next });
  const askAi = () => {
    if (askAiDisabled) return;
    setOpen(false);
    onAskAi();
  };
  const label = styleLabel(style);

  return (
    <div className={styles.root} ref={root}>
      <button
        type="button"
        className={[styles.trigger, size === "md" && styles.md, icon && styles.icon]
          .filter(Boolean)
          .join(" ")}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={icon ? `简历样式：${label}` : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        {icon ? (
          <Palette size={16} strokeWidth={1.8} aria-hidden="true" />
        ) : (
          <>
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
            {label}
            <ChevronDown size={14} strokeWidth={1.8} aria-hidden="true" />
          </>
        )}
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            className={styles.panel}
            ref={panelRef}
            style={{ top: pos.top, left: pos.left }}
            role="dialog"
            aria-label="简历样式"
          >
            <StylePanel
              resume={resume}
              style={style}
              designs={designList.data?.designs ?? []}
              currentId={designList.data?.currentId ?? null}
              onPickTemplate={pickTemplate}
              onPickAccent={pickAccent}
              onApplyDesign={(id) => applyDesign.mutate(id)}
              onDeleteDesign={(id) => deleteDesign.mutate(id)}
              onAskAi={askAi}
              askAiDisabled={askAiDisabled}
            />
          </div>,
          document.body,
        )}
    </div>
  );
}
