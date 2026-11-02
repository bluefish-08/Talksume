import { basename } from "node:path";
import { readJobs } from "./io.ts";
import { computeStats } from "./stats.ts";

const pct = (n: number, d: number) => (d === 0 ? "-" : `${((n / d) * 100).toFixed(1)}%`);
for (const file of process.argv.slice(2)) {
  const s = computeStats(readJobs(file));
  console.log(`## ${basename(file)}: ${s.total} 条`);
  console.log(
    `JD 全文 ${pct(s.withJd, s.total)} | 城市 ${pct(s.withCity, s.total)} | 招聘类型 ${pct(s.withJobType, s.total)} | 原文链接 ${pct(s.withUrl, s.total)}`,
  );
  console.log(`类型 ${JSON.stringify(s.byType)}`);
  console.log(`岗位类别 ${JSON.stringify(s.byRole)}`);
  console.log(`城市 ${JSON.stringify(s.topCities)}`);
}
