import { DESIGN_DIRECTIONS, styleFromDirection } from "@talksume/core";
import { afterAll, describe, expect, it } from "vitest";
import { close, renderResumePng, sampleResume, sparseResume } from "./index.ts";

afterAll(close);

const cases = DESIGN_DIRECTIONS.flatMap((d) => d.palettes.map((_, palette) => ({ d, palette })));

describe("设计方向渲染", () => {
  it.each(cases)(
    "$d.id 配色 $palette：一页、无盖住、无低对比",
    async ({ d, palette }) => {
      const built = styleFromDirection(d, { palette });
      if (!built.ok) throw new Error(built.errors.join());
      for (const content of [sampleResume, sparseResume]) {
        const { check } = await renderResumePng(content, built.style, { scale: 0.3, format: "jpeg" });
        expect(check, `${d.id}#${palette}`).toMatchObject({
          pages: 1,
          overflowX: 0,
          hiddenText: 0,
          covered: 0,
          lowContrast: 0,
        });
      }
    },
    30_000,
  );
});
