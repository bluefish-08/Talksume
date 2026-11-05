import mammoth from "mammoth";
import { getDocumentProxy } from "unpdf";

export const IMPORT_LIMITS = {
  fileBytes: 5 * 1024 * 1024,
  pdfPages: 5,
  textChars: 12_000,
  minChars: 40,
} as const;

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export class ImportError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 422) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const PASTE_HINT = "可以打开简历全选复制，用「粘贴文本」导入。";

export type ResumeFileKind = "pdf" | "docx";

export function fileKindOf(contentType: string | undefined, fileName = ""): ResumeFileKind | "doc" | null {
  const type = (contentType ?? "").split(";")[0]?.trim().toLowerCase();
  const ext = fileName.toLowerCase().split(".").pop();
  if (type === "application/pdf" || ext === "pdf") return "pdf";
  if (type === DOCX_MIME || ext === "docx") return "docx";
  if (type === "application/msword" || ext === "doc") return "doc";
  return null;
}

const RADICALS =
  "⻄西⻅见⻆角⻉贝⻋车⻓长⻔门⻘青⻚页⻛风⻜飞⻝食⻠饣⻢马⻣骨⻤鬼⻥鱼⻦鸟⻧卤⻨麦⻩黄⻪黾⻫齐⻬齐⻭齿⻯龙⻰龙⻳龟⺟母⺠民⻐钅⻈讠⺮竹";
const RADICAL_MAP = new Map<string, string>();
for (let i = 0; i < RADICALS.length; i += 2)
  RADICAL_MAP.set(RADICALS[i] as string, RADICALS[i + 1] as string);

/** PDF 字体常把常用字映射成部首字符（如「⼯」「⻘」），逐字还原；全角标点保留，免得写进简历变成半角。 */
export function normalizeResumeText(raw: string): string {
  return raw
    .replace(/[\u2f00-\u2fdf\uf900-\ufaff\uff10-\uff19\uff21-\uff3a\uff41-\uff5a]/g, (c) =>
      c.normalize("NFKC"),
    )
    .replace(/[\u2e80-\u2eff]/g, (c) => RADICAL_MAP.get(c) ?? c)
    .replace(/\r\n?/g, "\n")
    .replace(/[​-‍﻿­]/g, "")
    .replace(/[\t 　]+/g, " ")
    .split("\n")
    .map((line) => line.replace(/ {2,}/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function visibleChars(text: string): number {
  return text.replace(/\s/g, "").length;
}

export function checkResumeText(raw: string, source: "paste" | ResumeFileKind): string {
  const text = normalizeResumeText(raw);
  if (visibleChars(text) < IMPORT_LIMITS.minChars) {
    if (source === "pdf")
      throw new ImportError("image_pdf", `这份 PDF 读不出文字，可能是扫描件或图片导出的。${PASTE_HINT}`);
    if (source === "paste") throw new ImportError("text_too_short", "内容太少了，请粘贴完整的简历文字");
    throw new ImportError("empty_document", `这份文档里没读到文字。${PASTE_HINT}`);
  }
  if (text.length > IMPORT_LIMITS.textChars) {
    throw new ImportError(
      "text_too_long",
      `内容超过 ${IMPORT_LIMITS.textChars} 字，不像是一份简历。请只保留简历正文后再导入`,
    );
  }
  return text;
}

async function pdfText(data: Uint8Array, maxPages: number): Promise<string> {
  let doc: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    doc = await getDocumentProxy(data);
  } catch (error) {
    const name = (error as { name?: string }).name;
    if (name === "PasswordException")
      throw new ImportError("pdf_encrypted", `这份 PDF 设置了密码。${PASTE_HINT}`);
    throw new ImportError("bad_file", `PDF 文件打不开，可能已损坏。${PASTE_HINT}`);
  }
  try {
    if (doc.numPages > maxPages) {
      throw new ImportError(
        "too_many_pages",
        `PDF 有 ${doc.numPages} 页，简历一般不超过 ${maxPages} 页。请导出简历本身再上传`,
      );
    }
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let line = "";
      const lines: string[] = [];
      for (const item of content.items) {
        if (!("str" in item)) continue;
        line += item.str;
        if (item.hasEOL) {
          lines.push(line);
          line = "";
        }
      }
      if (line) lines.push(line);
      pages.push(lines.join("\n"));
    }
    return pages.join("\n\n");
  } finally {
    await doc.loadingTask.destroy();
  }
}

async function docxText(data: Uint8Array): Promise<string> {
  try {
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(data) });
    return value;
  } catch {
    throw new ImportError("bad_file", `Word 文件打不开，可能已损坏。${PASTE_HINT}`);
  }
}

/** 只在内存里抽取文字，原文件不落盘也不入库。 */
export async function extractResumeText(
  data: Uint8Array,
  kind: ResumeFileKind,
  limits: { fileBytes: number; pdfPages: number } = IMPORT_LIMITS,
): Promise<string> {
  if (data.byteLength > limits.fileBytes) {
    throw new ImportError("file_too_large", "文件超过 5MB，请压缩后再上传，或直接粘贴文本", 413);
  }
  const raw = kind === "pdf" ? await pdfText(data, limits.pdfPages) : await docxText(data);
  return checkResumeText(raw, kind);
}
