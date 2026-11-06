export { type AtsReport, atsCheck } from "./ats.ts";
export { auditStyle, type StyleAudit } from "./audit.ts";
export { type DesignScore, designScore } from "./design-metrics.ts";
export { renderDocx } from "./docx.ts";
export { fontFaceCss, fontFile } from "./font-files.ts";
export { FONT_ORIGIN, withFonts } from "./font-route.ts";
export {
  escapeHtml,
  type ResumeFragment,
  renderFragment,
  renderHtml,
  renderScreenHtml,
  resolveRenderStyle,
} from "./html.ts";
export { maskContacts } from "./mask.ts";
export {
  analyzeImage,
  describePalette,
  type ImageAnalysis,
  imagePalette,
  type PaletteColor,
} from "./palette.ts";
export { close, htmlToPdf, renderPdf } from "./pdf.ts";
export { htmlToPng, type LayoutCheck, type PreviewImage, renderResumePng } from "./png.ts";
export { sampleProfile, sampleResume, sparseProfile, sparseResume } from "./sample-resume.ts";
export type { RenderOptions, TemplateName } from "./types.ts";
