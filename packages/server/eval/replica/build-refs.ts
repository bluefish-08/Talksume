import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { close, htmlToPng } from "@talksume/resume-render";
import { REFS } from "./refs.ts";

const out = join(dirname(fileURLToPath(import.meta.url)), "refs");
mkdirSync(out, { recursive: true });
for (const ref of REFS) {
  writeFileSync(join(out, `${ref.id}.png`), await htmlToPng(ref.html));
  writeFileSync(join(out, `${ref.id}.html`), ref.html);
}
await close();
console.log(`built ${REFS.length} refs into ${out}`);
