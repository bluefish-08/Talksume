import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

// 模拟开源发布：剔除 cloud/ 后，开源部分必须能装依赖、过类型检查和测试
const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
const out = mkdtempSync(join(tmpdir(), "talksume-open-"));
const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], {
  cwd: root,
  encoding: "utf8",
})
  .split("\0")
  .filter((f) => f && !f.startsWith("cloud/") && f !== "tsconfig.cloud.json" && !f.startsWith("deploy/"));
for (const file of files) {
  mkdirSync(dirname(join(out, file)), { recursive: true });
  cpSync(join(root, file), join(out, file));
}
console.log(`已复制 ${files.length} 个文件到 ${out}`);

const run = (cmd: string, args: string[]) => {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  const result = spawnSync(cmd, args, { cwd: out, stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`失败：${cmd} ${args.join(" ")}（目录保留在 ${out}）`);
    process.exit(result.status ?? 1);
  }
};
run("pnpm", ["install", "--no-frozen-lockfile", "--prefer-offline"]);
run("node", ["scripts/typecheck.mjs"]);
run("pnpm", ["exec", "vitest", "run", "packages", "apps", "scripts"]);
rmSync(out, { recursive: true, force: true });
console.log("剔除 cloud/ 后开源部分 typecheck 与测试通过");
