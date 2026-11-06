import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

// 开源侧必过；cloud/ 存在时再检查云端（剔除 cloud/ 后只剩开源侧）
const projects = ["tsconfig.json", ...(existsSync("tsconfig.cloud.json") ? ["tsconfig.cloud.json"] : [])];
for (const project of projects) {
  const result = spawnSync("pnpm", ["exec", "tsc", "-b", project], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
