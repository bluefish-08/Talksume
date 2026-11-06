import { DEFAULT_RESUME_STYLE } from "@talksume/core";
import { afterAll, describe, expect, it } from "vitest";
import { close, sampleResume } from "./index.ts";
import { ATTACKS, runAttack } from "./security-corpus.ts";

afterAll(close);

describe("装饰层恶意 CSS 语料", () => {
  it.each(ATTACKS)("$id 被拦下或标记", async (attack) => {
    const r = await runAttack(attack, sampleResume, DEFAULT_RESUME_STYLE);
    expect(r.blocked, `${attack.id}: ${r.how}`).toBe(true);
  });
});
