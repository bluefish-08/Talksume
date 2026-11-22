import { fileURLToPath } from "node:url";
import type { Job } from "@talksume/core";
import { describe, expect, it } from "vitest";
import { CASES } from "../eval/dataset.ts";
import { makeJob, makeProfile } from "./fixtures.ts";
import { MIN_RECOMMEND_SCORE, matchProfile } from "./pipeline.ts";
import { classifyRole } from "./role.ts";
import { readSeedJobs } from "./seed.ts";

const seed = readSeedJobs(fileURLToPath(new URL("./test-fixtures/jobs.jsonl", import.meta.url)));

function seedJob(company: string, title: string, jobType?: Job["jobType"]): Job {
  const hit = seed.find(
    (j) => j.company === company && j.title === title && (!jobType || j.jobType === jobType),
  );
  if (!hit) throw new Error(`seed job not found: ${company} ${title}`);
  return hit;
}

const goBackend = makeJob({
  id: "syn:go-hz",
  title: "Go 后端开发实习生",
  cities: ["杭州"],
  jobType: "internship",
  jdText:
    "【岗位职责】\n负责后端服务开发与维护\n【任职要求】\n1、熟悉 Go 语言\n2、熟悉 MySQL、Redis、Kafka\n3、计算机相关专业本科及以上",
});
const genericBackend = makeJob({
  id: "syn:backend-sh",
  title: "后端开发实习生",
  cities: ["上海"],
  jobType: "internship",
  jdText:
    "【岗位职责】\n参与后端业务开发\n【任职要求】\n1、在校学生，每周出勤 4 天以上\n2、有责任心，学习能力强",
});

/** 计算机本科，云帆数据后端实习（Go/Kafka/Redis），意向后端开发，上海/杭州。 */
const backendIntern = makeProfile({
  education: [
    { id: "e1", school: "同济大学", degree: "bachelor", major: "软件工程", start: "2021-09", end: "2025-06" },
  ],
  experiences: [
    {
      id: "x1",
      kind: "internship",
      company: "云帆数据",
      title: "后端开发实习生",
      start: "2024-07",
      end: "2024-12",
      bullets: [
        "使用 Go 开发订单服务，接入 Kafka 消费订单消息",
        "使用 Redis 缓存热点数据，降低 MySQL 压力 40%",
      ],
    },
  ],
  skills: ["Go", "Kafka", "Redis", "MySQL"].map((name, i) => ({ id: `s${i}`, name })),
  intention: { roles: ["后端开发"], cities: ["上海", "杭州"] },
});

function scoreAll(profile = backendIntern, extra: Job[] = []) {
  const jobs = [...seed, ...extra];
  const out = matchProfile(profile, jobs, { recallLimit: jobs.length });
  const byId = new Map(out.matches.map((m) => [m.job.id, m]));
  return { out, score: (job: Job) => byId.get(job.id)?.score ?? Number.NEGATIVE_INFINITY, byId };
}

describe("后端实习生画像的分数区间", () => {
  const { score, out } = scoreAll(backendIntern, [goBackend, genericBackend]);

  it("标题与技能都吻合的岗位在 85–97，标题吻合但 JD 没写技能的也在强匹配档", () => {
    expect(score(goBackend)).toBeGreaterThanOrEqual(85);
    expect(score(goBackend)).toBeLessThanOrEqual(97);
    expect(score(genericBackend)).toBeGreaterThanOrEqual(80);
    expect(score(genericBackend)).toBeLessThanOrEqual(95);
  });

  it("方向对口、技能部分覆盖的后端岗位在 70–90", () => {
    for (const [company, title] of [
      ["星河科技", "后台开发"],
      ["青禾互娱", "平台研发-后端开发工程师（AI 应用方向）"],
      ["云帆数据", "AI后端开发工程师"],
    ] as const) {
      const s = score(seedJob(company, title));
      expect(s, `${company} ${title}`).toBeGreaterThanOrEqual(70);
      expect(s, `${company} ${title}`).toBeLessThanOrEqual(90);
    }
  });

  it("相邻方向（Agent、基础架构）在 50–80，不超过对口后端岗位", () => {
    const backend = score(seedJob("星河科技", "后台开发", "internship"));
    for (const [company, title] of [
      ["青禾互娱", "平台研发-Agent开发工程师"],
      ["北辰网络", "技术研究-基础架构方向"],
    ] as const) {
      const s = score(seedJob(company, title));
      expect(s, `${company} ${title}`).toBeGreaterThanOrEqual(50);
      expect(s, `${company} ${title}`).toBeLessThanOrEqual(80);
      expect(s).toBeLessThan(backend);
    }
  });

  it("只因专业沾边的游戏策划、算法、测试、运营岗位远低于相关岗位", () => {
    const related = score(seedJob("星河科技", "后台开发", "internship"));
    const weak: [string, string][] = [
      ["青禾互娱", "任务策划实习生"],
      ["青禾互娱", "技术策划实习生"],
      ["星河科技", "算法-推荐算法方向"],
      ["星河科技", "算法-自然语言处理方向"],
      ["星河科技", "测试开发"],
      ["北辰网络", "游戏测试实习生"],
      ["云帆数据", "产品运营实习生（用户增长）"],
    ];
    for (const [company, title] of weak) {
      const s = score(seedJob(company, title));
      expect(s, `${company} ${title}`).toBeLessThan(MIN_RECOMMEND_SCORE);
      expect(s).toBeLessThan(related - 40);
    }
  });

  it("需要多年经验的资深岗位被降分，排在对口的初级岗位之后", () => {
    const senior = seedJob("北辰网络", "高级/资深服务端开发工程师");
    const entry = seedJob("星河科技", "后台开发", "internship");
    expect(score(senior)).toBeLessThan(60);
    expect(score(senior)).toBeLessThan(score(entry));
    const m = out.matches.find((x) => x.job.id === senior.id);
    expect(m?.levelMultiplier).toBeLessThan(1);
    expect(m?.dims.experience.evidence[0]).toContain("资深");
  });

  it("相关度阈值以上的前 5 名全是后端方向，且分数单调", () => {
    const outcome = matchProfile(backendIntern, [...seed, goBackend, genericBackend], {
      recallLimit: 300,
      minScore: MIN_RECOMMEND_SCORE,
    });
    const top = outcome.matches.slice(0, 5);
    expect(top.every((m) => classifyRole(m.job.title) === "backend")).toBe(true);
    expect(outcome.belowThreshold).toBeGreaterThan(0);
    expect(outcome.matches.every((m) => m.baseScore >= MIN_RECOMMEND_SCORE)).toBe(true);
  });

  it("技能和经历的证据指向画像里的具体技能和实习", () => {
    const m = scoreAll(backendIntern, [goBackend]).byId.get(goBackend.id);
    expect(m?.dims.skills.evidence[0]).toContain("命中");
    expect(m?.dims.experience.evidence[0]).toContain("云帆数据");
  });
});

describe("其他方向画像不被后端偏置", () => {
  const find = (id: string) => {
    const c = CASES.find((x) => x.id === id);
    if (!c) throw new Error(id);
    return c.profile;
  };

  it("算法硕士：算法岗 ≥ 70，后端岗明显更低", () => {
    const { score } = scoreAll(find("algo-master"));
    expect(score(seedJob("星河科技", "AI算法工程", "campus"))).toBeGreaterThanOrEqual(70);
    expect(score(seedJob("星河科技", "算法-推荐算法方向"))).toBeGreaterThanOrEqual(70);
    expect(score(seedJob("星河科技", "后台开发", "campus"))).toBeLessThan(55);
  });

  it("产品运营本科：运营岗 ≥ 70，算法与客户端岗低于推荐线", () => {
    const { score } = scoreAll(find("product-ops-undergrad"));
    expect(score(seedJob("星河科技", "产品运营", "internship"))).toBeGreaterThanOrEqual(70);
    expect(score(seedJob("星河科技", "算法-推荐算法方向"))).toBeLessThan(MIN_RECOMMEND_SCORE);
    expect(score(seedJob("星河科技", "游戏客户端开发", "internship"))).toBeLessThan(MIN_RECOMMEND_SCORE);
  });
});
