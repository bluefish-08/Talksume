import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { close, renderDocx, renderHtml, renderPdf, sampleResume } from "../src/index.ts";

const outDir = fileURLToPath(new URL("../out/", import.meta.url));
await mkdir(outDir, { recursive: true });

try {
  await writeFile(`${outDir}sample.html`, renderHtml(sampleResume, { template: "campus" }));
  await writeFile(`${outDir}sample.pdf`, await renderPdf(sampleResume, { template: "campus" }));
  await writeFile(`${outDir}sample.docx`, await renderDocx(sampleResume, { template: "campus" }));
  console.log(`已输出到 ${outDir}`);
} finally {
  await close();
}
