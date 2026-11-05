import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export type AgentModule = typeof import("../../src/index.ts");
export type GatewayModule = typeof import("@talksume/llm-gateway");
export type CoreModule = typeof import("@talksume/core");

/** 被评测的一份代码：agent、网关、core 都从同一个 checkout 加载。 */
export interface Target {
  label: string;
  root: string;
  commit: string;
  agent: AgentModule;
  gateway: GatewayModule;
  core: CoreModule;
}

/** 被测代码；评测脚本自己的改动不算版本变化。 */
const SRC = ["packages/agent/src", "packages/core/src", "packages/llm-gateway/src"];

const HERE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

/** 目录直接用；否则当 git ref，检出到临时 worktree 并离线安装依赖（同一 commit 复用）。 */
export function resolveRoot(spec: string | undefined): string {
  if (!spec || spec === ".") return HERE_ROOT;
  const asDir = resolve(spec);
  if (existsSync(join(asDir, "packages/agent/src/index.ts"))) return asDir;
  const sha = git(HERE_ROOT, ["rev-parse", "--verify", `${spec}^{commit}`]);
  const dir = join(tmpdir(), "talksume-eval-refs", sha.slice(0, 12));
  if (!existsSync(join(dir, "packages/agent/src/index.ts"))) {
    git(HERE_ROOT, ["worktree", "add", "--detach", dir, sha]);
    execFileSync("pnpm", ["install", "--frozen-lockfile", "--offline"], { cwd: dir, stdio: "ignore" });
  }
  return dir;
}

export async function loadTarget(spec?: string, label?: string): Promise<Target> {
  const root = resolveRoot(spec);
  const load = (p: string) => import(pathToFileURL(join(root, p)).href);
  const [agent, gateway, core] = await Promise.all([
    load("packages/agent/src/index.ts") as Promise<AgentModule>,
    load("packages/llm-gateway/src/index.ts") as Promise<GatewayModule>,
    load("packages/core/src/index.ts") as Promise<CoreModule>,
  ]);
  let commit = "unknown";
  try {
    commit = git(root, ["rev-parse", "--short", "HEAD"]);
    if (git(root, ["status", "--porcelain", "--", ...SRC])) commit += "+dirty";
  } catch {}
  return { label: label ?? spec ?? "cur", root, commit, agent, gateway, core };
}

/** key 只从主仓库的 .env 读进进程环境，不打印。 */
export function loadEnv(): void {
  if (process.env.LLM_API_KEY) return;
  const common = resolve(HERE_ROOT, git(HERE_ROOT, ["rev-parse", "--git-common-dir"]));
  for (const file of [join(HERE_ROOT, ".env"), join(dirname(common), ".env")]) {
    if (existsSync(file)) {
      process.loadEnvFile(file);
      return;
    }
  }
  throw new Error("找不到 .env（需要 LLM_BASE_URL / LLM_API_KEY）");
}
