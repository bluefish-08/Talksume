// 只读：对线上库里某个用户的画像，比较纯 BM25 与 BM25+向量、不同召回上限下的匹配结果与耗时。
// 用法: DATABASE_URL=... [EMBEDDING_*=...] node eval/recall-limit.ts <用户邮箱> [100,200,300,500]
import { Profile } from "@talksume/core";
import { createDb, schema } from "@talksume/db";
import { eq } from "drizzle-orm";
import { createEmbedderFromEnv } from "../src/embedder.ts";
import { loadVisibleJobs } from "../src/jobs-db.ts";
import { MIN_RECOMMEND_SCORE, matchProfile } from "../src/pipeline.ts";
import { vectorScores } from "../src/recall-db.ts";

const [email, limitsArg = "100,200,300,500"] = process.argv.slice(2);
const url = process.env.DATABASE_URL;
if (!url || !email) {
  console.error("用法: DATABASE_URL=... node eval/recall-limit.ts <用户邮箱> [100,200,300,500]");
  process.exit(2);
}
const ms = (start: number) => `${(performance.now() - start).toFixed(0)} ms`;

const handle = await createDb({ url });
try {
  const [row] = await handle.db
    .select({ userId: schema.users.id, data: schema.profiles.data, weights: schema.profiles.weights })
    .from(schema.users)
    .innerJoin(schema.profiles, eq(schema.profiles.userId, schema.users.id))
    .where(eq(schema.users.email, email));
  if (!row) throw new Error(`找不到用户 ${email} 的画像`);
  const profile = Profile.parse(row.data);

  let t = performance.now();
  const jobs = await loadVisibleJobs(handle.db, row.userId);
  console.log(`加载岗位 ${jobs.length} 条，${ms(t)}`);

  const modes: [string, Map<string, number> | undefined][] = [["BM25", undefined]];
  const embedder = createEmbedderFromEnv();
  if (embedder) {
    for (const k of [500, 100_000]) {
      const label = k === 500 ? "近邻500" : "近邻全部";
      t = performance.now();
      const v = await vectorScores(handle.db, row.userId, embedder, profile, k);
      console.log(`向量${label}：${v.size} 条，${ms(t)}（含画像向量化）`);
      modes.push([`BM25+向量(${label})`, v]);
    }
  }

  const run = (recallLimit: number, vectors?: Map<string, number>) => {
    const start = performance.now();
    const outcome = matchProfile(profile, jobs, {
      weights: (row.weights ?? {}) as never,
      recallLimit,
      minScore: MIN_RECOMMEND_SCORE,
      ...(vectors && { vectorScores: vectors }),
    });
    return { outcome, ms: performance.now() - start };
  };

  // 召回只决定哪些岗位进入打分，打分与召回方式无关，所以全量打分是各种召回的共同上限
  const full = run(Number.POSITIVE_INFINITY);
  const ideal = full.outcome.matches.map((m) => m.job.id);
  const { excluded, candidates } = full.outcome;
  console.log(
    `在招 ${candidates + excluded.jobType + excluded.city + excluded.degree}，通过硬筛选 ${candidates}，排除 ${JSON.stringify(excluded)}；全量打分达标 ${ideal.length}，${full.ms.toFixed(0)} ms`,
  );
  const top = (matches: typeof full.outcome.matches) => {
    for (const m of matches.slice(0, 10)) {
      console.log(`    ${m.score.toFixed(1)}\t${m.job.company}\t${m.job.title}\t${m.job.cities.join("/")}`);
    }
  };
  console.log("召回方式\t召回上限\t召回\t达标\t耗时ms\t前10命中\t前20命中\t前100命中\t第100名分数");
  for (const [name, vectors] of modes) {
    for (const limit of limitsArg.split(",").map(Number)) {
      const r = run(limit, vectors);
      const got = new Set(r.outcome.matches.slice(0, 100).map((m) => m.job.id));
      const hit = (k: number) => ideal.slice(0, k).filter((id) => got.has(id)).length;
      console.log(
        [
          name,
          limit,
          r.outcome.recalled,
          r.outcome.matches.length,
          r.ms.toFixed(0),
          ...[10, 20, 100].map((k) => `${hit(k)}/${Math.min(k, ideal.length)}`),
          r.outcome.matches[99]?.score.toFixed(1) ?? "-",
        ].join("\t"),
      );
      if (limit === Number(process.env.SHOW_TOP ?? 100)) top(r.outcome.matches);
    }
  }
  console.log("全量打分前 10：");
  top(full.outcome.matches);
} finally {
  await handle.close();
}
