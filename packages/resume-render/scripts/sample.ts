import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RESUME_TEMPLATES, type ResumeAccent } from "@talksume/core";
import { close, renderDocx, renderHtml, renderPdf, sampleResume, sparseResume } from "../src/index.ts";

const outDir = resolve(process.argv[2] ?? fileURLToPath(new URL("../out/", import.meta.url)));
const accent = (process.argv[3] ?? "blue") as ResumeAccent;
await mkdir(outDir, { recursive: true });

try {
  for (const [key, content] of [
    ["sample", sampleResume],
    ["sparse", sparseResume],
  ] as const) {
    for (const template of RESUME_TEMPLATES) {
      const base = `${outDir}/${key}-${template}`;
      await writeFile(`${base}.html`, renderHtml(content, { template, accent }));
      await writeFile(`${base}.pdf`, await renderPdf(content, { template, accent }));
      await writeFile(`${base}.docx`, await renderDocx(content, { template, accent }));
    }
  }
  console.log(`已输出到 ${outDir}`);
} finally {
  await close();
}
