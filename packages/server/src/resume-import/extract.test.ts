import { close, renderDocx, renderPdf } from "@talksume/resume-render";
import { afterAll, describe, expect, it } from "vitest";
import {
  checkResumeText,
  extractResumeText,
  fileKindOf,
  IMPORT_LIMITS,
  ImportError,
  normalizeResumeText,
} from "./extract.ts";
import { imageOnlyPdf, LI_MING_TEXT, liMingResume } from "./fixtures.ts";

afterAll(() => close());

const plain = (s: string) => s.replace(/\s/g, "");

async function importError(run: Promise<unknown>): Promise<ImportError> {
  const error = await run.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ImportError);
  return error as ImportError;
}

describe("extractResumeText", { timeout: 60_000 }, () => {
  it("从 PDF 抽出中文正文", async () => {
    const pdf = await renderPdf(liMingResume);
    const text = await extractResumeText(new Uint8Array(pdf), "pdf");
    for (const s of ["李明", "江城大学", "软件工程", "校园食堂点餐小程序", "600ms", "liming@example.com"]) {
      expect(plain(text)).toContain(plain(s));
    }
    expect(text).not.toMatch(/[⺀-⿟]/);
  });

  it("从 docx 抽出正文", async () => {
    const docx = await renderDocx(liMingResume);
    const text = await extractResumeText(new Uint8Array(docx), "docx");
    expect(text).toContain("江城大学");
    expect(text).toContain("使用 Redis 缓存菜单数据，高峰期接口响应从 600ms 降到 150ms");
  });

  it("没有文字层的 PDF 提示改用粘贴", async () => {
    const error = await importError(extractResumeText(imageOnlyPdf(), "pdf"));
    expect(error.code).toBe("image_pdf");
    expect(error.message).toContain("粘贴文本");
  });

  it("文件超过大小上限", async () => {
    const error = await importError(extractResumeText(new Uint8Array(IMPORT_LIMITS.fileBytes + 1), "pdf"));
    expect(error.code).toBe("file_too_large");
    expect(error.status).toBe(413);
  });

  it("页数超过上限", async () => {
    const error = await importError(
      extractResumeText(imageOnlyPdf(3), "pdf", { fileBytes: IMPORT_LIMITS.fileBytes, pdfPages: 2 }),
    );
    expect(error.code).toBe("too_many_pages");
    expect(error.message).toContain("3 页");
  });

  it("损坏的文件给出友好提示", async () => {
    const bytes = new TextEncoder().encode("not a real document");
    expect((await importError(extractResumeText(bytes, "pdf"))).code).toBe("bad_file");
    expect((await importError(extractResumeText(bytes, "docx"))).code).toBe("bad_file");
  });
});

describe("粘贴文本", () => {
  it("归一化空白和部首字符", () => {
    expect(normalizeResumeText("后端开发⼯程师\r\n\r\n\r\n⻘禾数据\t 实习")).toBe(
      "后端开发工程师\n\n青禾数据 实习",
    );
  });

  it("太短或太长都拒绝", () => {
    expect(() => checkResumeText("李明 江城大学", "paste")).toThrow(/内容太少/);
    expect(() => checkResumeText("字".repeat(IMPORT_LIMITS.textChars + 1), "paste")).toThrow(/超过/);
    expect(checkResumeText(LI_MING_TEXT, "paste")).toContain("江城大学");
  });

  it("按类型或扩展名识别文件", () => {
    expect(fileKindOf("application/pdf")).toBe("pdf");
    expect(fileKindOf("application/octet-stream", "李明简历.DOCX")).toBe("docx");
    expect(fileKindOf("application/msword", "a.doc")).toBe("doc");
    expect(fileKindOf("image/png", "a.png")).toBeNull();
  });
});
