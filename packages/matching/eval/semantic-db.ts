// 只读：在线上库的在招岗位上，比较加语义重排前后的推荐（前 10/20 的变化）与耗时，不写 match_results。
// 用法: DATABASE_URL=... EMBEDDING_*=... RERANK_*=... node eval/semantic-db.ts <用户邮箱> [0.2,0.3,0.4] [100,50]
// 用户邮箱用于取库里的画像（李明）和可见岗位范围；另附 3 个虚构画像。设 SEMANTIC_OUT=文件 时导出规则分与 rerank 概率，供离线标注后算指标。
import { writeFileSync } from "node:fs";
import { Profile } from "@talksume/core";
import { createDb, schema } from "@talksume/db";
import { eq } from "drizzle-orm";
import { createEmbedderFromEnv } from "../src/embedder.ts";
import { loadVisibleJobs } from "../src/jobs-db.ts";
import { DEFAULT_RECALL_LIMIT, MIN_RECOMMEND_SCORE, matchProfile } from "../src/pipeline.ts";
import { vectorScores } from "../src/recall-db.ts";
import {
  blendSemantic,
  calibrate,
  createRerankerFromEnv,
  rerankDocument,
  rerankQuery,
} from "../src/reranker.ts";
import type { ScoredJob } from "../src/types.ts";

const [email, weightsArg = "0.2,0.3,0.4", topKArg = "100,50"] = process.argv.slice(2);
const url = process.env.DATABASE_URL;
const reranker = createRerankerFromEnv();
if (!url || !email || !reranker) {
  console.error(
    "用法: DATABASE_URL=... RERANK_BASE_URL=... RERANK_MODEL=... node eval/semantic-db.ts <用户邮箱>",
  );
  process.exit(2);
}
const weights = weightsArg.split(",").map(Number);
const topKs = topKArg.split(",").map(Number);

const skills = (names: string[]) => names.map((name, i) => ({ id: `s${i}`, name }));
const SYNTHETIC: [string, Profile][] = [
  [
    "前端实习（虚构）",
    Profile.parse({
      education: [{ id: "e1", school: "某理工大学", degree: "bachelor", major: "软件工程" }],
      skills: skills(["JavaScript", "TypeScript", "React", "Vue", "CSS", "HTML", "Webpack", "Node.js"]),
      projects: [
        {
          id: "p1",
          name: "校园活动报名小程序",
          role: "前端开发",
          techStack: ["React", "TypeScript", "微信小程序"],
          action: "负责报名表单与活动列表页，封装通用组件，首屏加载时间降低 40%",
        },
        {
          id: "p2",
          name: "个人博客",
          techStack: ["Vue", "Vite"],
          action: "实现文章渲染、暗色主题与响应式布局",
        },
      ],
      intention: { roles: ["前端开发"], cities: ["北京", "上海", "深圳", "杭州"], jobType: "internship" },
    }),
  ],
  [
    "算法校招（虚构）",
    Profile.parse({
      education: [{ id: "e1", school: "某985高校", degree: "master", major: "人工智能" }],
      skills: skills(["Python", "PyTorch", "深度学习", "推荐系统", "CTR预估", "Spark", "C++", "机器学习"]),
      experiences: [
        {
          id: "x1",
          kind: "internship",
          company: "某电商公司",
          title: "推荐算法实习生",
          bullets: [
            "参与首页信息流精排模型迭代，引入多任务学习，线上 CTR 提升 2.1%",
            "搭建特征分析与离线评估脚本",
          ],
        },
      ],
      projects: [
        {
          id: "p1",
          name: "基于图神经网络的商品推荐",
          techStack: ["PyTorch", "GNN"],
          action: "实现 LightGCN 召回并与双塔模型对比",
        },
      ],
      intention: {
        roles: ["推荐算法工程师", "机器学习算法工程师"],
        cities: ["北京", "上海", "深圳", "杭州"],
        jobType: "campus",
      },
    }),
  ],
  [
    "产品实习（虚构）",
    Profile.parse({
      education: [{ id: "e1", school: "某财经大学", degree: "bachelor", major: "信息管理与信息系统" }],
      skills: skills(["Axure", "Figma", "SQL", "用户调研", "竞品分析", "PRD 撰写", "数据分析"]),
      experiences: [
        {
          id: "x1",
          kind: "internship",
          company: "某互联网教育公司",
          title: "产品运营实习生",
          bullets: ["负责课程详情页改版的需求调研与原型设计", "通过 SQL 分析转化漏斗，推动报名转化率提升 8%"],
        },
      ],
      intention: { roles: ["产品经理"], cities: ["上海", "北京", "杭州", "深圳"], jobType: "internship" },
    }),
  ],
];

const ms = (start: number) => Math.round(performance.now() - start);
const byScore = (a: ScoredJob, b: ScoredJob) => b.score - a.score || a.job.id.localeCompare(b.job.id);
const label = (m: ScoredJob) => `${m.job.company}｜${m.job.title}｜${m.job.cities.slice(0, 3).join("/")}`;

const dump: {
  name: string;
  query: string;
  jobs: {
    id: string;
    title: string;
    company: string;
    cities: string[];
    jd: string;
    rule: number;
    prob?: number | undefined;
  }[];
}[] = [];

const handle = await createDb({ url });
const embedder = createEmbedderFromEnv();
try {
  const [row] = await handle.db
    .select({ userId: schema.users.id, data: schema.profiles.data, weights: schema.profiles.weights })
    .from(schema.users)
    .innerJoin(schema.profiles, eq(schema.profiles.userId, schema.users.id))
    .where(eq(schema.users.email, email));
  if (!row) throw new Error(`找不到用户 ${email} 的画像`);
  let t = performance.now();
  const jobs = await loadVisibleJobs(handle.db, row.userId);
  console.log(`加载岗位 ${jobs.length} 条，${ms(t)}ms`);

  const profiles: [string, Profile, Partial<Record<string, number>>][] = [
    [`库里画像 ${email}`, Profile.parse(row.data), (row.weights ?? {}) as Record<string, number>],
    ...SYNTHETIC.map(([name, p]) => [name, p, {}] as [string, Profile, Partial<Record<string, number>>]),
  ];

  for (const [name, profile, userWeights] of profiles) {
    console.log(`\n==================== ${name}`);
    console.log(`query: ${rerankQuery(profile)}`);
    t = performance.now();
    const vectors = embedder ? await vectorScores(handle.db, row.userId, embedder, profile) : undefined;
    const vectorMs = ms(t);
    t = performance.now();
    const outcome = matchProfile(profile, jobs, {
      weights: userWeights,
      recallLimit: DEFAULT_RECALL_LIMIT,
      minScore: MIN_RECOMMEND_SCORE,
      ...(vectors && { vectorScores: vectors }),
    });
    const matchMs = ms(t);
    const base = outcome.matches;
    const maxK = Math.max(...topKs);
    const head = base.slice(0, maxK);
    t = performance.now();
    const probs = await reranker.rerank(
      rerankQuery(profile),
      head.map((m) => rerankDocument(m.job)),
    );
    const rerankMs = ms(t);
    console.log(
      `通过硬筛选 ${outcome.candidates}，达标 ${base.length}；向量 ${vectorMs}ms，规则打分 ${matchMs}ms，rerank ${head.length} 条 ${rerankMs}ms`,
    );
    const prob = new Map(head.map((m, i) => [m.job.id, probs[i] ?? 0]));
    dump.push({
      name,
      query: rerankQuery(profile),
      jobs: base.slice(0, 200).map((m) => ({
        id: m.job.id,
        title: m.job.title,
        company: m.job.company,
        cities: m.job.cities,
        jd: m.job.jdText.slice(0, 1500),
        rule: m.score,
        ...(prob.has(m.job.id) && { prob: prob.get(m.job.id) }),
      })),
    });

    const blend = (w: number, k: number) =>
      [
        ...base.slice(0, k).map((m) => blendSemantic(m, calibrate(prob.get(m.job.id) ?? 0), w)),
        ...base.slice(k),
      ].sort(byScore);
    const rank = (list: ScoredJob[]) => new Map(list.map((m, i) => [m.job.id, i + 1]));
    const baseRank = rank(base);
    const ruleScore = new Map(base.map((m) => [m.job.id, m.score]));

    const cal = head.map((m) => calibrate(prob.get(m.job.id) ?? 0));
    const bucket = (lo: number, hi: number) => cal.filter((c) => c >= lo && c < hi).length;
    console.log(
      `校准分分布（前 ${head.length}）：<0.2 ${bucket(0, 0.2)}，0.2–0.5 ${bucket(0.2, 0.5)}，0.5–0.8 ${bucket(0.5, 0.8)}，≥0.8 ${bucket(0.8, 1.01)}`,
    );
    console.log("\n规则排序前 20（规则分 / 概率 / 校准）：");
    for (const [i, m] of base.slice(0, 20).entries()) {
      const p = prob.get(m.job.id) ?? 0;
      console.log(
        `  ${i + 1}\t${m.score.toFixed(1)}\t${p.toFixed(3)}\t${calibrate(p).toFixed(2)}\t${label(m)}`,
      );
    }

    for (const k of topKs) {
      for (const w of weights) {
        const after = blend(w, k);
        const top = (list: ScoredJob[], n: number) => new Set(list.slice(0, n).map((m) => m.job.id));
        const kept = (n: number) => [...top(after, n)].filter((id) => top(base, n).has(id)).length;
        console.log(`\n--- K=${k} w=${w}：前 10 保留 ${kept(10)}/10，前 20 保留 ${kept(20)}/20`);
        if (k !== topKs[0]) continue;
        const afterRank = rank(after);
        for (const [i, m] of after.slice(0, 20).entries()) {
          const was = baseRank.get(m.job.id) ?? 0;
          const move = was === i + 1 ? "" : was > 20 ? `新进(原${was})` : `原${was}`;
          console.log(
            `  ${i + 1}\t${m.score.toFixed(1)}\t规则${ruleScore.get(m.job.id)?.toFixed(1)}\t语义${m.semantic?.score.toFixed(2) ?? "-"}\t${move}\t${label(m)}`,
          );
        }
        const dropped = base.slice(0, 20).filter((m) => (afterRank.get(m.job.id) ?? 999) > 20);
        for (const m of dropped) {
          const p = prob.get(m.job.id) ?? 0;
          console.log(
            `  掉出前20：原${baseRank.get(m.job.id)}→${afterRank.get(m.job.id)}\t规则${m.score.toFixed(1)}\t语义${calibrate(p).toFixed(2)}\t${label(m)}`,
          );
        }
      }
    }
  }
  if (process.env.SEMANTIC_OUT) writeFileSync(process.env.SEMANTIC_OUT, JSON.stringify(dump));
} finally {
  await handle.close();
}
