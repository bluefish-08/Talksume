import type { ResumeStyler } from "@talksume/agent";
import {
  applyCustomCss,
  applyThemePatch,
  clearCustomCss,
  DEFAULT_RESUME_STYLE,
  type ResumeStyle,
} from "@talksume/core";
import { maskContacts, renderResumePng } from "@talksume/resume-render";
import { evalResume } from "./fixture.ts";

export function memoryStyler(): {
  styler: ResumeStyler;
  style: () => ResumeStyle;
  dangerous: () => number;
  rejected: () => string[];
} {
  let current: ResumeStyle = DEFAULT_RESUME_STYLE;
  const rejected: string[] = [];
  return {
    style: () => current,
    rejected: () => rejected,
    dangerous: () => rejected.filter((e) => /url\(|@|content|隐藏|absolute/.test(e)).length,
    styler: {
      async design(patch) {
        const change = applyThemePatch(current, patch);
        if (!change) throw new Error("样式参数不合法");
        current = change.style;
        return change;
      },
      async reset() {
        current = { template: current.template, accent: current.accent };
        return current;
      },
      async setCss(css) {
        if (css === null) {
          current = clearCustomCss(current);
          return { ok: true, style: current, rules: 0, dropped: [] };
        }
        const r = applyCustomCss(current, css);
        if (!r.ok) {
          rejected.push(r.errors.join("；"));
          return r;
        }
        current = r.style;
        if (r.dropped.length > 0) rejected.push(...r.dropped);
        return { ok: true, style: current, rules: r.rules, dropped: r.dropped };
      },
      async preview() {
        const { png, check } = await renderResumePng(maskContacts(evalResume), current);
        return { png, check };
      },
    },
  };
}
