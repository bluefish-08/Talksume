import type { Education, Profile } from "@talksume/core";
import { DEGREE_RANK } from "./filters.ts";

const endKey = (e: Pick<Education, "start" | "end">) =>
  e.end === "present" ? "9999-99" : (e.end ?? e.start ?? "");

/** 最高学历在前，其次毕业时间晚的，仍相同则后加入的在前（画像里新增的教育追加在末尾）。 */
export function educationByRecency(profile: Pick<Profile, "education">): Education[] {
  return profile.education
    .map((edu, index) => ({ edu, index }))
    .sort(
      (a, b) =>
        DEGREE_RANK[b.edu.degree] - DEGREE_RANK[a.edu.degree] ||
        endKey(b.edu).localeCompare(endKey(a.edu)) ||
        b.index - a.index,
    )
    .map((x) => x.edu);
}

export function primaryEducation(profile: Pick<Profile, "education">): Education | undefined {
  return educationByRecency(profile)[0];
}
