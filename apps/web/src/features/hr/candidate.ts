import type { HrApplication } from "./types.ts";

export interface CandidateIdentity {
  name: string;
  /** 邮箱、电话；简历里没有时回落到账号邮箱。 */
  contacts: string[];
}

const EMAIL = /^[^\s@]+@[^\s@]+$/;
const PHONE = /^\+?[\d\s-]{7,}$/;

/** 以所附简历快照里的信息为准，没有简历才用账号信息。 */
export function candidateIdentity({
  candidate,
  resume,
}: Pick<HrApplication, "candidate" | "resume">): CandidateIdentity {
  const basics = resume?.content.basics;
  const name = basics?.name.trim() || candidate.displayName;
  const raw = (basics?.contacts ?? []).map((c) => c.trim());
  const contacts = [raw.find((c) => EMAIL.test(c)), raw.find((c) => PHONE.test(c))].filter(
    (c): c is string => !!c,
  );
  return { name, contacts: contacts.length > 0 ? contacts : [candidate.email] };
}
