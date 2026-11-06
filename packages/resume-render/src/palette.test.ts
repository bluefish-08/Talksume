import { afterAll, describe, expect, it } from "vitest";
import { close, htmlToPng } from "./index.ts";
import { analyzeImage } from "./palette.ts";

afterAll(close);

const page = (body: string, bg = "#fff") =>
  `<!doctype html><meta charset=utf-8><body style="margin:0;width:800px;height:1100px;background:${bg}">${body}</body>`;

describe("analyzeImage 平整度", () => {
  it("白底整页截图：给出版式事实", async () => {
    const png = await htmlToPng(page('<div style="height:160px;background:#1d1c1a"></div>'));
    const r = await analyzeImage(png, "image/png");
    expect(r.flat).toBe(true);
    expect(r.facts.join("")).toContain("通栏");
  });

  it("四周是深色边框的照片：不输出测量事实", async () => {
    const png = await htmlToPng(page('<div style="margin:60px;height:980px;background:#fff"></div>', "#222"));
    const r = await analyzeImage(png, "image/png");
    expect(r.flat).toBe(false);
    expect(r.colors).toEqual([]);
    expect(r.facts).toHaveLength(1);
    expect(r.facts[0]).toContain("不可靠");
  });

  it("底色不接近白色：不输出测量事实", async () => {
    const png = await htmlToPng(page("", "#678af8"));
    expect((await analyzeImage(png, "image/png")).flat).toBe(false);
  });
});
