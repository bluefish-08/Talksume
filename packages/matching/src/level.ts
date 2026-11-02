import type { Job, Profile } from "@talksume/core";

const SENIOR_TITLE = /高级|资深|专家|主管|负责人|架构师|总监/;
const YEARS =
  /(?<!\d)(\d{1,2})\s*(?:[-~至到]\s*\d{1,2}\s*)?年(?:及)?(?:以上|以内)?(?:的)?[^。；;\n]{0,12}?(?:经验|经历)/;
const IMPLIED_SENIOR_YEARS = 3;

export function requiredYears(
  job: Pick<Job, "title" | "jdText">,
): { years: number; quote: string } | undefined {
  const m = job.jdText.match(YEARS);
  const years = m ? Number(m[1]) : 0;
  if (m && years >= 2) return { years, quote: m[0].trim().slice(0, 30) };
  if (SENIOR_TITLE.test(job.title)) return { years: IMPLIED_SENIOR_YEARS, quote: job.title };
  return undefined;
}

const monthIndex = (ym: string) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;

/** 全职经验按整年算，实习和兼职折半。 */
export function experienceYears(profile: Pick<Profile, "experiences">, now = new Date()): number {
  const nowIndex = now.getFullYear() * 12 + now.getMonth();
  let months = 0;
  for (const e of profile.experiences) {
    if (!e.start) continue;
    const end = e.end === "present" || !e.end ? nowIndex : monthIndex(e.end);
    const span = Math.max(0, end - monthIndex(e.start) + 1);
    months += e.kind === "fulltime" ? span : span / 2;
  }
  return months / 12;
}

/** 岗位要求多年经验而画像远不及时整体降分；候选人经验达到七成以上不处理。 */
export function levelAdjustment(
  profile: Pick<Profile, "experiences">,
  job: Pick<Job, "title" | "jdText">,
  now?: Date,
): { multiplier: number; evidence?: string } {
  const need = requiredYears(job);
  if (!need) return { multiplier: 1 };
  const have = experienceYears(profile, now);
  if (have >= need.years * 0.7) return { multiplier: 1 };
  const multiplier = have >= need.years * 0.35 ? 0.8 : 0.6;
  return {
    multiplier,
    evidence: `岗位要求资深经验（JD「${need.quote}」），画像累计工作经验（实习折半）约 ${have.toFixed(1)} 年，整体降分`,
  };
}
