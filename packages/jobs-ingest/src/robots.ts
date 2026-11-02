export interface RobotsRules {
  disallow: string[];
  allow: string[];
}

export const NO_RULES: RobotsRules = { disallow: [], allow: [] };

/** 只解析适用于 `*` 与指定 UA 前缀的分组；最长匹配优先，Allow 在同长度时胜出。 */
export function parseRobots(text: string, userAgent: string): RobotsRules {
  const product = userAgent.split(/[\s/]/)[0]?.toLowerCase() ?? "";
  const groups: { agents: string[]; disallow: string[]; allow: string[] }[] = [];
  let current: (typeof groups)[number] | undefined;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], disallow: [], allow: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === "disallow" && value) current.disallow.push(value);
    if (key === "allow" && value) current.allow.push(value);
  }
  const specific = groups.filter((g) => g.agents.some((a) => a !== "*" && product.startsWith(a)));
  const chosen = specific.length > 0 ? specific : groups.filter((g) => g.agents.includes("*"));
  return {
    disallow: chosen.flatMap((g) => g.disallow),
    allow: chosen.flatMap((g) => g.allow),
  };
}

function matches(rule: string, path: string): boolean {
  const anchored = rule.endsWith("$");
  const pattern = (anchored ? rule.slice(0, -1) : rule)
    .split("*")
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${pattern}${anchored ? "$" : ""}`).test(path);
}

export function isAllowed(rules: RobotsRules, path: string): boolean {
  const longest = (list: string[]) =>
    list.filter((r) => matches(r, path)).reduce((n, r) => Math.max(n, r.length), -1);
  const d = longest(rules.disallow);
  if (d < 0) return true;
  return longest(rules.allow) >= d;
}
