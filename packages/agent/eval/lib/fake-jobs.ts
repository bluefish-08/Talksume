import type { JobCard, JobInsight, JobTools, ResumeTailor } from "../../src/index.ts";

/** 虚构岗位库：让提示词和工具集与线上一致（线上总带岗位工具），结果固定。 */
const CATALOG: (JobCard & { keywords: string[] })[] = [
  {
    id: "job_demo_01",
    title: "Java 开发工程师（校招）",
    company: "江城云帆科技",
    cities: ["江城"],
    jobType: "campus",
    keywords: ["java", "后端", "开发"],
  },
  {
    id: "job_demo_02",
    title: "后端开发实习生",
    company: "江城数联信息",
    cities: ["江城"],
    jobType: "internship",
    keywords: ["后端", "go", "java"],
  },
  {
    id: "job_demo_03",
    title: "数据分析助理",
    company: "江城小橙零售",
    cities: ["江城", "上海"],
    jobType: "campus",
    keywords: ["数据", "python", "sql", "分析"],
  },
  {
    id: "job_demo_04",
    title: "新媒体运营专员",
    company: "江城晨光传媒",
    cities: ["江城"],
    jobType: "campus",
    keywords: ["运营", "新媒体", "内容"],
  },
  {
    id: "job_demo_05",
    title: "电商运营助理",
    company: "江城好物电商",
    cities: ["江城"],
    jobType: "campus",
    keywords: ["电商", "运营", "客服"],
  },
];

function pick(text: string, city?: string): JobCard[] {
  const q = text.toLowerCase();
  return CATALOG.filter(
    (j) => (!city || j.cities.includes(city)) && (!q || j.keywords.some((k) => q.includes(k))),
  )
    .slice(0, 3)
    .map(({ keywords: _k, ...card }, i) => ({
      ...card,
      score: 80 - i * 6,
      reason: "技能与岗位要求部分匹配",
    }));
}

export const fakeJobs: JobTools = {
  async recommend(profile, query) {
    const text = [query.keyword ?? "", ...profile.intention.roles].join(" ");
    const jobs = pick(text, query.city).slice(0, query.limit);
    return { jobs: jobs.length > 0 ? jobs : pick("", query.city).slice(0, query.limit), total: jobs.length };
  },
  async search(_profile, query) {
    const jobs = pick(`${query.query} ${query.company ?? ""}`, query.city).slice(0, query.limit);
    return { jobs, total: jobs.length };
  },
  async explain(_profile, jobId): Promise<JobInsight | null> {
    const job = CATALOG.find((j) => j.id === jobId);
    if (!job) return null;
    const { keywords: _k, ...card } = job;
    return {
      job: { ...card, score: 72 },
      summary: "基础要求能对上，项目经历偏少。",
      strengths: ["专业对口"],
      gaps: ["缺少实习经历"],
      dims: [{ label: "技能", score: 70, evidence: ["学过相关课程"] }],
    };
  },
};

export const fakeTailor: ResumeTailor = { tailor: async () => null };
