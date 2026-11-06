import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { findViolations } from "./open-boundary.ts";

const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");

describe("开源边界", () => {
  it("packages 和 apps 不引用 cloud/ 也不依赖 @talksume/cloud-*", () => {
    expect(findViolations(repoRoot)).toEqual([]);
  });

  it("能识别各种违规写法", () => {
    const root = mkdtempSync(join(tmpdir(), "boundary-"));
    const write = (path: string, content: string) => {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    };
    write(
      "packages/a/src/x.ts",
      'import { a } from "@talksume/cloud-auth";\nconst b = await import("../../../cloud/y.ts");\n',
    );
    write("packages/a/package.json", '{"dependencies":{"@talksume/cloud-web":"workspace:*"}}');
    write("apps/w/tsconfig.json", '{"references":[{"path":"../../cloud/auth"}]}');
    write("tsconfig.json", '{"references":[{"path":"cloud/server"}]}');
    write("packages/a/src/ok.ts", 'import { z } from "zod";\nimport "./x.ts";\n');
    execFileSync("git", ["init", "-q"], { cwd: root });
    const reasons = findViolations(root).map((v) => `${v.file} ${v.reason}`);
    expect(reasons).toHaveLength(5);
    expect(reasons.some((r) => r.includes("@talksume/cloud-auth"))).toBe(true);
    expect(reasons.some((r) => r.startsWith("tsconfig.json"))).toBe(true);
  });
});
