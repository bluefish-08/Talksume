import { type Job, Profile } from "@talksume/core";

export function makeJob(over: Partial<Job> & Pick<Job, "title">): Job {
  const id = over.id ?? `t:${over.title}`;
  return {
    id,
    source: "t",
    sourceJobId: id,
    company: "测试公司",
    cities: ["上海"],
    jdText: "负责相关工作。",
    tags: [],
    fetchedAt: new Date("2026-01-01"),
    ...over,
  };
}

export function makeProfile(over: Record<string, unknown> = {}): Profile {
  return Profile.parse({
    education: [{ id: "e1", school: "某大学", degree: "bachelor", major: "计算机科学与技术" }],
    skills: [{ id: "s1", name: "Python" }],
    intention: { roles: ["后端开发"], cities: ["上海"] },
    ...over,
  });
}
