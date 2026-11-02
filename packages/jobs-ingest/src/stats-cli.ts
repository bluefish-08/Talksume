import { basename } from "node:path";
import { readJobs } from "./io.ts";
import { mergeJobs } from "./merge.ts";
import { computeStats } from "./stats.ts";

const pct = (n: number, d: number) => (d === 0 ? "-" : `${((n / d) * 100).toFixed(1)}%`);
const FIELDS = {
  jd: "JD 全文",
  cities: "城市",
  jobType: "招聘类型",
  degree: "学历",
  postedAt: "发布时间",
  url: "原文链接",
  tags: "标签",
};

function report(name: string, jobs: ReturnType<typeof readJobs>) {
  const s = computeStats(jobs);
  console.log(`## ${name}: ${s.total} 条`);
  console.log(
    `缺失率 ${Object.entries(FIELDS)
      .map(([k, label]) => `${label} ${pct(s.missing[k as keyof typeof s.missing], s.total)}`)
      .join(" | ")}`,
  );
  console.log(`类型 ${JSON.stringify(s.byType)}`);
  console.log(`岗位类别 ${JSON.stringify(s.byRole)}`);
  console.log(`城市 ${JSON.stringify(s.topCities)}`);
}

const files = process.argv.slice(2);
const all = files.map((f) => {
  const jobs = mergeJobs(readJobs(f));
  report(basename(f), jobs);
  return jobs;
});
if (files.length > 1) report("合计", mergeJobs(all.flat()));
