import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const OPEN_ROOTS = ["packages", "apps"];
const SOURCE = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)["']([^"']+)["']/g;

export interface Violation {
  file: string;
  reason: string;
}

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".tsbuild"]);

function walk(root: string, dir = ""): string[] {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    if (SKIP_DIRS.has(entry.name)) return [];
    const path = dir ? `${dir}/${entry.name}` : entry.name;
    return entry.isDirectory() ? walk(root, path) : [path];
  });
}

/** 优先用 git 列文件（不含被忽略的）；不在 git 仓库里（比如剔除 cloud/ 后的拷贝）就直接遍历目录。 */
function trackedFiles(root: string): string[] {
  try {
    const out = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.split("\0").filter(Boolean);
  } catch {
    return walk(root);
  }
}

const isCloudName = (name: string) => /^@talksume\/cloud-/.test(name);

/** packages/* 和 apps/* 是开源侧：不能引用 cloud/ 下的任何东西，也不能依赖 @talksume/cloud-*。 */
export function findViolations(root: string): Violation[] {
  const violations: Violation[] = [];
  const add = (file: string, reason: string) => violations.push({ file, reason });
  for (const file of trackedFiles(root)) {
    if (!OPEN_ROOTS.some((r) => file.startsWith(`${r}/`)) || !existsSync(join(root, file))) continue;
    const abs = join(root, file);
    if (SOURCE.test(file)) {
      for (const match of readFileSync(abs, "utf8").matchAll(SPECIFIER)) {
        const spec = match[1] ?? "";
        if (isCloudName(spec)) add(file, `import 了闭源包 ${spec}`);
        else if (spec.startsWith(".")) {
          const target = relative(root, resolve(dirname(abs), spec));
          if (target === "cloud" || target.startsWith("cloud/"))
            add(file, `import 了 cloud 目录下的文件 ${spec}`);
        }
      }
    } else if (file.endsWith("/package.json")) {
      const pkg = JSON.parse(readFileSync(abs, "utf8")) as Record<string, Record<string, string> | undefined>;
      for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
        for (const name of Object.keys(pkg[field] ?? {}))
          if (isCloudName(name)) add(file, `${field} 依赖了 ${name}`);
      }
    } else if (/\/tsconfig[^/]*\.json$/.test(file)) {
      for (const [, path] of readFileSync(abs, "utf8").matchAll(/"path"\s*:\s*"([^"]+)"/g)) {
        const target = relative(root, resolve(dirname(abs), path ?? ""));
        if (target === "cloud" || target.startsWith("cloud/")) add(file, `tsconfig 引用了 ${path}`);
      }
    }
  }
  const rootTsconfig = join(root, "tsconfig.json");
  if (existsSync(rootTsconfig) && /"path"\s*:\s*"cloud\//.test(readFileSync(rootTsconfig, "utf8"))) {
    add("tsconfig.json", "根 tsconfig.json 引用了 cloud/，开源构建会找不到；云端项目放 tsconfig.cloud.json");
  }
  return violations;
}

if (import.meta.main) {
  const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
  const found = findViolations(root);
  for (const v of found) console.error(`${v.file}: ${v.reason}`);
  if (found.length > 0) process.exit(1);
  console.log("开源侧没有引用 cloud/");
}
