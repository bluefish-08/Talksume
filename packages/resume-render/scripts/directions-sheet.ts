import { writeFileSync } from "node:fs";
import { DESIGN_DIRECTIONS, styleFromDirection } from "@talksume/core";
import { getBrowser } from "../src/chromium.ts";
import { close, renderResumePng, sampleResume } from "../src/index.ts";

const [out = "directions.png", only = "", pal = "0"] = process.argv.slice(2);
const picks = DESIGN_DIRECTIONS.filter((d) => !only || only.split(",").includes(d.id));
const cells = await Promise.all(
  picks.map(async (d) => {
    const built = styleFromDirection(d, { palette: Number(pal) });
    if (!built.ok) return { d, error: built.errors.join("；") };
    const r = await renderResumePng(sampleResume, built.style, { scale: 0.6, format: "jpeg" });
    const c = r.check;
    return {
      d,
      img: Buffer.from(r.png).toString("base64"),
      note: `p${c.pages} ox${c.overflowX} h${c.hiddenText} ov${c.overlaps} lc${c.lowContrast} cv${c.covered}`,
    };
  }),
);
const html = `<body style="margin:0;background:#eef1f6;font:12px sans-serif"><div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;padding:16px;width:1760px">${cells
  .map(
    (c) =>
      `<div><div style="font-weight:600">${c.d.id} · ${c.d.skeleton}</div>${"error" in c ? `<div style="color:red">${c.error}</div>` : `<img src="data:image/jpeg;base64,${c.img}" style="width:100%;border:1px solid #ccc"><div style="color:#666">${c.note}</div>`}</div>`,
  )
  .join("")}</div></body>`;
const browser = await getBrowser();
const ctx = await browser.newContext({ viewport: { width: 1760, height: 900 } });
const page = await ctx.newPage();
await page.setContent(html);
await page.waitForTimeout(500);
writeFileSync(out, await page.screenshot({ fullPage: true }));
await ctx.close();
await close();
