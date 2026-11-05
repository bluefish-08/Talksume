import { Profile } from "@talksume/core";
import { describe, expect, it } from "vitest";
import { applyFacts, resolveConflict } from "./facts.ts";
import type { FactInput } from "./schemas.ts";

let counter = 0;
const genId = (prefix: string) => `${prefix}_${++counter}`;
const ctx = { messageId: "m1", genId };

// 默认 quote 取 payload 里的文字，让测合并的用例不被要点写法校验退回
const wordsOf = (value: unknown): string[] =>
  typeof value === "string"
    ? [value]
    : Array.isArray(value)
      ? value.flatMap(wordsOf)
      : value && typeof value === "object"
        ? Object.values(value).flatMap(wordsOf)
        : [];
const fact = (section: FactInput["section"], payload: Record<string, unknown>, quote?: string) =>
  ({ section, payload, quote: quote ?? (wordsOf(payload).join("，") || "原话") }) as FactInput;

describe("applyFacts", () => {
  it("writes basics and creates confirmed fact records with the quote and message id", () => {
    const base = Profile.parse({});
    const result = applyFacts(
      base,
      [fact("basics", { name: "李明", city: "上海" }, "我叫李明，在上海")],
      ctx,
    );
    expect(result.profile.basics).toMatchObject({ name: "李明", city: "上海" });
    expect(base.basics.name).toBeUndefined();
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]).toMatchObject({
      section: "basics",
      quote: "我叫李明，在上海",
      sourceMessageId: "m1",
      status: "confirmed",
    });
    expect(result.changes.map((c) => c.field).sort()).toEqual(["city", "name"]);
  });

  it("creates list items whose sourceFactIds point at the fact", () => {
    const result = applyFacts(
      Profile.parse({}),
      [fact("education", { school: "上海交通大学", degree: "bachelor", major: "计算机" })],
      ctx,
    );
    const item = result.profile.education[0];
    expect(item?.school).toBe("上海交通大学");
    expect(item?.sourceFactIds).toEqual([result.facts[0]?.id]);
    expect(item?.id).toMatch(/^edu_/);
  });

  it("merges later facts into the same item and appends the source fact", () => {
    const first = applyFacts(
      Profile.parse({}),
      [fact("projects", { name: "短链服务", techStack: ["Go"] })],
      ctx,
    );
    const second = applyFacts(
      first.profile,
      [fact("projects", { name: " 短链服务 ", techStack: ["Redis", "Go"], result: "QPS 提升到 3000" })],
      ctx,
    );
    expect(second.profile.projects).toHaveLength(1);
    const project = second.profile.projects[0];
    expect(project?.techStack).toEqual(["Go", "Redis"]);
    expect(project?.result).toBe("QPS 提升到 3000");
    expect(project?.sourceFactIds).toHaveLength(2);
    expect(project?.sourceFactIds).toContain(second.facts[0]?.id);
  });

  it("keeps a new item missing required fields as a draft and commits it once complete", () => {
    const first = applyFacts(Profile.parse({}), [fact("education", { school: "清华大学" })], ctx);
    expect(first.profile.education).toHaveLength(0);
    expect(first.rejected).toEqual([]);
    expect(first.drafted).toEqual([{ section: "education", label: "清华大学", missing: ["degree"] }]);
    expect(first.drafts).toHaveLength(1);

    const second = applyFacts(
      first.profile,
      [fact("education", { school: "清华大学", major: "计算机" }, "计算机专业")],
      {
        ...ctx,
        drafts: first.drafts,
      },
    );
    expect(second.drafts[0]?.item).toMatchObject({ school: "清华大学", major: "计算机" });

    const done = applyFacts(
      second.profile,
      [fact("education", { school: "清华大学", degree: "bachelor" }, "本科")],
      {
        ...ctx,
        drafts: second.drafts,
      },
    );
    expect(done.drafts).toEqual([]);
    expect(done.profile.education).toEqual([
      expect.objectContaining({ school: "清华大学", major: "计算机", degree: "bachelor" }),
    ]);
    expect(done.changes).toEqual([expect.objectContaining({ section: "education", field: "_item" })]);
  });

  it("rejects invalid payloads", () => {
    const result = applyFacts(
      Profile.parse({}),
      [fact("education", { school: "清华大学", degree: "本科" })],
      ctx,
    );
    expect(result.rejected).toHaveLength(1);
    expect(result.profile.education).toHaveLength(0);
  });

  it("batches several facts and keeps going after a rejected one", () => {
    const result = applyFacts(
      Profile.parse({}),
      [
        fact("education", { school: "清华大学", degree: "本科" }),
        fact("skills", { name: "Go" }),
        fact("skills", { name: "Python", level: "proficient" }),
      ],
      ctx,
    );
    expect(result.rejected.map((r) => r.index)).toEqual([0]);
    expect(result.profile.skills.map((s) => s.name)).toEqual(["Go", "Python"]);
  });

  it("turns a contradicting scalar into a pending fact instead of overwriting", () => {
    const base = applyFacts(Profile.parse({}), [fact("basics", { name: "李明", city: "上海" })], ctx).profile;
    const result = applyFacts(
      base,
      [fact("basics", { city: "杭州", email: "a@b.com" }, "其实我在杭州")],
      ctx,
    );
    expect(result.profile.basics.city).toBe("上海");
    expect(result.profile.basics.email).toBe("a@b.com");
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({ field: "city", previous: "上海", proposed: "杭州" });
    const pending = result.facts.find((f) => f.status === "pending");
    expect(pending?.payload).toEqual({ city: "杭州" });
    expect(result.facts.find((f) => f.status === "confirmed")?.payload).toEqual({ email: "a@b.com" });
  });

  it("does not flag a conflict for equal values or unioned arrays", () => {
    const base = applyFacts(
      Profile.parse({}),
      [fact("intention", { roles: ["后端"], cities: ["杭州"] })],
      ctx,
    ).profile;
    const result = applyFacts(base, [fact("intention", { roles: ["后端", "数据"], cities: ["杭州"] })], ctx);
    expect(result.conflicts).toHaveLength(0);
    expect(result.profile.intention.roles).toEqual(["后端", "数据"]);
  });

  describe("text that adds to what was said", () => {
    const project = () =>
      applyFacts(
        Profile.parse({}),
        [fact("projects", { name: "江城闲置", situation: "校园二手交易平台" })],
        ctx,
      ).profile;

    it("treats a longer value containing the old one as a refinement and overwrites it", () => {
      const base = project();
      const result = applyFacts(
        base,
        [fact("projects", { name: "江城闲置", situation: "校园二手交易平台，与几个同学组队做的" })],
        ctx,
      );
      expect(result.conflicts).toHaveLength(0);
      expect(result.profile.projects[0]?.situation).toBe("校园二手交易平台，与几个同学组队做的");
      expect(result.changes).toMatchObject([
        { section: "projects", field: "situation", previous: "校园二手交易平台" },
      ]);
      expect(result.facts.map((f) => f.status)).toEqual(["confirmed"]);
    });

    it("ignores a shorter value the old one already contains", () => {
      const base = applyFacts(project(), [fact("basics", { city: "武汉市洪山区" })], ctx).profile;
      const result = applyFacts(
        base,
        [fact("projects", { name: "江城闲置", situation: "二手交易平台" }), fact("basics", { city: "武汉" })],
        ctx,
      );
      expect(result.conflicts).toHaveLength(0);
      expect(result.changes).toHaveLength(0);
      expect(result.profile.projects[0]?.situation).toBe("校园二手交易平台");
      expect(result.profile.basics.city).toBe("武汉市洪山区");
    });

    it("still flags values that really differ", () => {
      const base = applyFacts(
        project(),
        [fact("education", { school: "江城大学", degree: "bachelor", major: "软件工程", start: "2022-09" })],
        ctx,
      ).profile;
      const result = applyFacts(
        base,
        [fact("education", { school: "江城大学", major: "计算机科学", start: "2021-09" })],
        ctx,
      );
      expect(result.conflicts.map((c) => [c.field, c.previous, c.proposed])).toEqual([
        ["major", "软件工程", "计算机科学"],
        ["start", "2022-09", "2021-09"],
      ]);
    });
  });

  describe("narrative fields", () => {
    const ACTION = "负责后端，做了商品发布、搜索和订单模块，用 Redis 缓存热门商品";
    const withProject = (fields: Record<string, string>) =>
      applyFacts(Profile.parse({}), [fact("projects", { name: "江城闲置", ...fields })], ctx).profile;
    const update = (fields: Record<string, string>, base = withProject({ action: ACTION })) =>
      applyFacts(base, [fact("projects", { name: "江城闲置", ...fields })], ctx);

    it("appends a parallel addition instead of raising a conflict", () => {
      const result = update({ action: "通过加索引、SQL 优化和 Redis 缓存优化接口性能" });
      expect(result.conflicts).toHaveLength(0);
      expect(result.profile.projects[0]?.action).toBe(
        `${ACTION}；通过加索引、SQL 优化和 Redis 缓存优化接口性能`,
      );
      expect(result.changes).toMatchObject([{ field: "action", previous: ACTION }]);
    });

    it("does not raise a conflict again when the model restates the merged text differently", () => {
      const merged = update({ action: "通过加索引、SQL 优化和 Redis 缓存优化接口性能" }).profile;
      const before = merged.projects[0]?.action;
      const again = update(
        { action: "负责后端商品发布、搜索和订单模块，加索引、SQL 优化，Redis 缓存" },
        merged,
      );
      expect(again.conflicts).toHaveLength(0);
      expect(again.profile.projects[0]?.action).toBe(before);
    });

    it("takes a full rewrite that keeps every number and name of the old text", () => {
      const rewrite = "负责后端，做了商品发布、搜索和订单模块，用 Redis 缓存热门商品，并加索引做 SQL 优化";
      const result = update({ action: `${rewrite.slice(0, 6)}。${rewrite.slice(6)}` });
      expect(result.conflicts).toHaveLength(0);
      expect(result.profile.projects[0]?.action).toBe(`${rewrite.slice(0, 6)}。${rewrite.slice(6)}`);
    });

    it("still asks when a number or a named tool was replaced", () => {
      const base = withProject({
        result: "接口响应从 800ms 降到 120ms，大概 3000 个同学在用",
        action: "用 MySQL 存订单数据",
      });
      const result = update(
        { result: "接口响应从 800ms 降到 100ms，大概 3000 个同学在用", action: "用 PostgreSQL 存订单数据" },
        base,
      );
      expect(result.conflicts.map((c) => c.field).sort()).toEqual(["action", "result"]);
      expect(result.profile.projects[0]?.result).toBe("接口响应从 800ms 降到 120ms，大概 3000 个同学在用");
    });

    it("leaves non-narrative text fields to the usual conflict check", () => {
      const base = withProject({ role: "后端负责人" });
      expect(update({ role: "前端开发" }, base).conflicts.map((c) => c.field)).toEqual(["role"]);
    });
  });

  it("flags a conflict inside a list item", () => {
    const base = applyFacts(
      Profile.parse({}),
      [fact("experiences", { company: "字节跳动", title: "后端实习生", kind: "internship" })],
      ctx,
    ).profile;
    const result = applyFacts(base, [fact("experiences", { company: "字节跳动", title: "前端实习生" })], ctx);
    expect(result.conflicts[0]).toMatchObject({
      section: "experiences",
      field: "title",
      previous: "后端实习生",
    });
    expect(result.conflicts[0]?.itemId).toBe(base.experiences[0]?.id);
  });
});

describe("resolveConflict", () => {
  function setup() {
    const first = applyFacts(Profile.parse({}), [fact("basics", { city: "上海" })], ctx);
    const second = applyFacts(first.profile, [fact("basics", { city: "杭州" })], ctx);
    const facts = [...first.facts, ...second.facts];
    const conflict = second.conflicts[0];
    if (!conflict) throw new Error("expected conflict");
    return { profile: second.profile, facts, conflict };
  }

  it("accepting overwrites the value and supersedes the old fact", () => {
    const { profile, facts, conflict } = setup();
    const out = resolveConflict(profile, facts, conflict, true);
    expect(out.profile.basics.city).toBe("杭州");
    expect(out.facts.map((f) => f.status)).toEqual(["superseded", "confirmed"]);
    expect(out.changes[0]).toMatchObject({ field: "city", value: "杭州", previous: "上海" });
  });

  it("rejecting keeps the old value and drops the new fact", () => {
    const { profile, facts, conflict } = setup();
    const out = resolveConflict(profile, facts, conflict, false);
    expect(out.profile.basics.city).toBe("上海");
    expect(out.facts.map((f) => f.status)).toEqual(["confirmed", "superseded"]);
  });
});

describe("applyFacts: ungrounded guesses", () => {
  it("keeps a skill level only when the quote says the matching degree", () => {
    const result = applyFacts(
      Profile.parse({}),
      [
        fact("skills", { name: "Go", level: "expert" }, "Go 我是精通的"),
        fact("skills", { name: "Rust", level: "familiar" }, "Rust 写过几个小工具"),
        fact("skills", { name: "Java", level: "expert" }, "Java 比较熟悉"),
      ],
      ctx,
    );
    expect(result.profile.skills.map((s) => [s.name, s.level])).toEqual([
      ["Go", "expert"],
      ["Rust", undefined],
      ["Java", undefined],
    ]);
    expect(result.dropped).toEqual([
      expect.objectContaining({ index: 1, field: "level" }),
      expect.objectContaining({ index: 2, field: "level" }),
    ]);
    expect(result.facts[1]?.payload).toEqual({ name: "Rust" });
  });

  it("keeps an award date only when the quote spells out the year and month", () => {
    const result = applyFacts(
      Profile.parse({}),
      [
        fact("awards", { name: "数学建模省一等奖", date: "2023-11" }, "2023年11月拿了数学建模省一等奖"),
        fact("awards", { name: "校二等奖学金", date: "2024-12" }, "拿过2024年的校二等奖学金"),
        fact("awards", { name: "优秀学生干部", date: "2024-06" }, "去年评上了优秀学生干部"),
        fact("awards", { name: "国家奖学金", date: "2022-10" }, "大二拿过国家奖学金"),
      ],
      ctx,
    );
    expect(result.profile.awards.map((a) => a.date)).toEqual(["2023-11", undefined, undefined, undefined]);
    expect(result.dropped.map((d) => [d.index, d.field])).toEqual([
      [1, "date"],
      [2, "date"],
      [3, "date"],
    ]);
    expect(result.profile.awards[3]?.name).toBe("国家奖学金");
  });
});

describe("applyFacts: new resume fields", () => {
  const withProject = (extra: Record<string, unknown> = {}) =>
    Profile.parse({ projects: [{ id: "prj_1", name: "二手平台", role: "后端", ...extra }] });
  const project = (r: { profile: Profile }) => r.profile.projects[0];

  it("unions tech stacks case- and space-insensitively", () => {
    const r = applyFacts(
      withProject({ techStack: ["Java", "Spring Boot"] }),
      [fact("projects", { name: "二手平台", techStack: ["springboot", "MySQL", "java"] }, "Java、MySQL")],
      ctx,
    );
    expect(project(r)?.techStack).toEqual(["Java", "Spring Boot", "MySQL"]);
  });

  it("dedupes highlights by title and merges a supplement into the same detail", () => {
    const first = applyFacts(
      withProject(),
      [
        fact(
          "projects",
          {
            name: "二手平台",
            highlights: [
              { title: "订单模块设计", detail: "设计了订单模块" },
              { title: "搜索优化", detail: "给商品搜索加了 Redis 缓存" },
            ],
          },
          "设计了订单模块…给商品搜索加了 Redis 缓存",
        ),
      ],
      ctx,
    );
    const second = applyFacts(
      first.profile,
      [
        fact(
          "projects",
          {
            name: "二手平台",
            highlights: [{ title: "搜索优化", detail: "给商品搜索加了 Redis 缓存，响应从 800ms 降到 120ms" }],
          },
          "响应从 800ms 降到 120ms",
        ),
      ],
      { ...ctx, userText: "设计了订单模块，给商品搜索加了 Redis 缓存。响应从 800ms 降到 120ms" },
    );
    expect(project(second)?.highlights).toEqual([
      { title: "订单模块设计", detail: "设计了订单模块" },
      { title: "搜索优化", detail: "给商品搜索加了 Redis 缓存，响应从 800ms 降到 120ms" },
    ]);
    expect(second.conflicts).toEqual([]);
    expect(second.changes).toEqual([
      expect.objectContaining({ field: "highlights", itemId: "prj_1", previous: project(first)?.highlights }),
    ]);
  });

  it("appends a non-overlapping supplement to the same title instead of replacing it", () => {
    const base = withProject({ highlights: [{ title: "搜索优化", detail: "加了缓存" }] });
    const r = applyFacts(
      base,
      [fact("projects", { name: "二手平台", highlights: [{ title: "搜索优化", detail: "还做了分词" }] })],
      ctx,
    );
    expect(project(r)?.highlights).toEqual([{ title: "搜索优化", detail: "加了缓存；还做了分词" }]);
  });

  it("raises a confirmation when the number in a highlight changes, and resolves it in place", () => {
    const base = withProject({
      highlights: [
        { title: "接口提速", detail: "响应从 800ms 降到 120ms" },
        { title: "订单模块", detail: "设计了订单模块" },
      ],
    });
    const r = applyFacts(
      base,
      [
        fact(
          "projects",
          { name: "二手平台", highlights: [{ title: "接口提速", detail: "响应从 800ms 降到 200ms" }] },
          "响应从 800ms 降到 200ms",
        ),
      ],
      ctx,
    );
    expect(project(r)?.highlights?.[0]?.detail).toBe("响应从 800ms 降到 120ms");
    expect(r.conflicts).toEqual([
      expect.objectContaining({
        field: "highlights",
        entry: "接口提速",
        label: "要点「接口提速」",
        previous: "响应从 800ms 降到 120ms",
        proposed: "响应从 800ms 降到 200ms",
      }),
    ]);
    const conflict = r.conflicts[0];
    if (!conflict) throw new Error("no conflict");
    const resolved = resolveConflict(r.profile, r.facts, conflict, true);
    expect(resolved.profile.projects[0]?.highlights).toEqual([
      { title: "接口提速", detail: "响应从 800ms 降到 200ms" },
      { title: "订单模块", detail: "设计了订单模块" },
    ]);
    expect(resolved.facts.find((f) => f.id === conflict.factId)?.status).toBe("confirmed");
  });

  it("drops a highlight whose numbers are not in the quote and keeps the rest", () => {
    const r = applyFacts(
      withProject(),
      [
        fact(
          "projects",
          {
            name: "二手平台",
            highlights: [
              { title: "订单模块", detail: "设计了订单模块" },
              { title: "用户增长", detail: "注册用户超过 5000 人" },
              { title: "三人协作", detail: "3 人小组分工开发" },
            ],
          },
          "我们三个人，我设计了订单模块，用户挺多的",
        ),
      ],
      ctx,
    );
    expect(project(r)?.highlights?.map((h) => h.title)).toEqual(["订单模块", "三人协作"]);
    expect(r.dropped).toEqual([expect.objectContaining({ field: "highlights" })]);
    expect(r.dropped[0]?.reason).toContain("5000");
  });

  it("accepts a number the user said elsewhere even if the quote cut it off", () => {
    const r = applyFacts(
      withProject(),
      [
        fact(
          "projects",
          { name: "二手平台", highlights: [{ title: "用户增长", detail: "上线后有 2000 多个注册用户" }] },
          "上线后有",
        ),
      ],
      { ...ctx, userText: "上线后有2000多个注册用户" },
    );
    expect(project(r)?.highlights).toHaveLength(1);
    expect(r.dropped).toEqual([]);
  });

  it("keeps legacy bullets visible by folding them into untitled highlights", () => {
    const base = Profile.parse({
      experiences: [
        {
          id: "exp_1",
          kind: "internship",
          company: "示例科技",
          title: "后端实习",
          bullets: ["负责订单模块", "修复缺陷"],
        },
      ],
    });
    const r = applyFacts(
      base,
      [
        fact("experiences", {
          company: "示例科技",
          highlights: [{ title: "订单模块重构", detail: "负责订单模块，把多表联查拆成了分片查询" }],
        }),
      ],
      ctx,
    );
    expect(r.profile.experiences[0]?.highlights).toEqual([
      { title: "订单模块重构", detail: "负责订单模块，把多表联查拆成了分片查询" },
      { detail: "修复缺陷" },
    ]);
    const later = applyFacts(
      r.profile,
      [fact("experiences", { company: "示例科技", bullets: ["写了单测"] })],
      ctx,
    );
    expect(later.profile.experiences[0]?.highlights?.at(-1)).toEqual({ detail: "写了单测" });
    expect(later.profile.experiences[0]?.bullets).toEqual(["负责订单模块", "修复缺陷"]);
  });

  it("folds a project's old action and result but leaves the background alone", () => {
    const base = withProject({ situation: "校园二手平台", action: "设计了订单模块" });
    const r = applyFacts(
      base,
      [
        fact("projects", {
          name: "二手平台",
          highlights: [{ title: "超卖问题", detail: "用分布式锁解决了超卖" }],
        }),
      ],
      ctx,
    );
    expect(project(r)?.highlights).toEqual([
      { detail: "设计了订单模块" },
      { title: "超卖问题", detail: "用分布式锁解决了超卖" },
    ]);
    expect(project(r)?.situation).toBe("校园二手平台");
  });

  it("merges a retold old point into the folded one instead of adding duplicates", () => {
    const base = withProject({
      action: "负责后端，做了商品发布、搜索和订单模块，用 Redis 缓存热门商品",
      result: "接口响应从 800ms 降到 120ms",
    });
    const r = applyFacts(
      base,
      [
        fact("projects", {
          name: "二手平台",
          highlights: [
            { title: "商品发布与搜索", detail: "负责商品发布、搜索模块" },
            { title: "订单模块", detail: "负责订单模块" },
          ],
        }),
      ],
      ctx,
    );
    expect(project(r)?.highlights).toEqual([
      { title: "商品发布与搜索", detail: "负责后端，做了商品发布、搜索和订单模块，用 Redis 缓存热门商品" },
      { detail: "接口响应从 800ms 降到 120ms" },
    ]);
  });

  it("titles an untitled point with the fuller retelling, but keeps a genuinely new point", () => {
    const base = withProject({ highlights: [{ detail: "做了订单模块" }] });
    const r = applyFacts(
      base,
      [
        fact("projects", {
          name: "二手平台",
          highlights: [
            { title: "订单模块", detail: "做了订单模块，还接了支付回调" },
            { title: "超卖问题", detail: "用分布式锁解决了超卖" },
          ],
        }),
      ],
      ctx,
    );
    expect(project(r)?.highlights).toEqual([
      { title: "订单模块", detail: "做了订单模块，还接了支付回调" },
      { title: "超卖问题", detail: "用分布式锁解决了超卖" },
    ]);
  });

  it("replaces an untitled point when the retelling adds numbers, and keeps unrelated ones apart", () => {
    const base = withProject({ highlights: [{ detail: "负责订单模块的接口" }] });
    const quote = "负责订单模块接口，QPS 到了 3000…搜索接口 P99 是 80ms";
    const r = applyFacts(
      base,
      [
        fact(
          "projects",
          {
            name: "二手平台",
            highlights: [
              { title: "订单接口", detail: "负责订单模块接口，QPS 到了 3000" },
              { title: "搜索提速", detail: "搜索接口 P99 是 80ms" },
            ],
          },
          quote,
        ),
      ],
      ctx,
    );
    expect(project(r)?.highlights).toEqual([
      { title: "订单接口", detail: "负责订单模块接口，QPS 到了 3000" },
      { title: "搜索提速", detail: "搜索接口 P99 是 80ms" },
    ]);
  });

  it("merges links by url and fills a missing label", () => {
    const base = Profile.parse({ basics: { links: [{ url: "https://github.com/demo/" }] } });
    const r = applyFacts(
      base,
      [
        fact("basics", {
          links: [
            { label: "GitHub", url: "github.com/demo" },
            { label: "博客", url: "demo.example.com" },
          ],
        }),
      ],
      ctx,
    );
    expect(r.profile.basics.links).toEqual([
      { label: "GitHub", url: "https://github.com/demo/" },
      { label: "博客", url: "demo.example.com" },
    ]);
  });

  it("stores GPA, rank, courses and honors, and never re-asks about a skill category", () => {
    const r = applyFacts(
      Profile.parse({ skills: [{ id: "skl_1", name: "Java", category: "编程语言" }] }),
      [
        fact("education", {
          school: "示例大学",
          degree: "bachelor",
          gpa: "3.7/4.0",
          rank: "专业前 10%",
          courses: ["数据结构", "操作系统"],
          honors: ["三好学生"],
        }),
        fact("skills", { name: "java", category: "后端" }),
      ],
      ctx,
    );
    expect(r.profile.education[0]).toMatchObject({
      gpa: "3.7/4.0",
      rank: "专业前 10%",
      courses: ["数据结构", "操作系统"],
      honors: ["三好学生"],
    });
    expect(r.profile.skills[0]?.category).toBe("编程语言");
    expect(r.conflicts).toEqual([]);
  });
});

describe("applyFacts duplicates", () => {
  it("records nothing when the payload matches what is already there", () => {
    const first = applyFacts(
      Profile.parse({}),
      [
        fact("basics", { name: "李明" }, "我叫李明"),
        fact("education", { school: "江城职业技术学院", degree: "associate" }, "江城职业技术学院，大专"),
      ],
      ctx,
    );
    const again = applyFacts(
      first.profile,
      [
        fact("basics", { name: "李明" }, "我叫李明"),
        fact("basics", {}, "我叫李明"),
        fact("education", { school: "江城职业技术学院" }, "江城职业技术学院，大专"),
      ],
      ctx,
    );
    expect(again.facts).toEqual([]);
    expect(again.unchanged).toEqual([0, 1, 2]);
    expect(again.profile).toEqual(first.profile);
  });
});
