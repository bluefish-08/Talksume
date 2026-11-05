/** 实习、项目条目的身份：泛称（「课程设计」「一家公司」）只当占位，说出具体名称时认领同一条。 */

type Rec = Record<string, unknown>;
export type IdentitySection = "experiences" | "projects";

export const IDENTITY_SECTIONS: readonly string[] = ["experiences", "projects"];

const plain = (text: unknown) =>
  String(text ?? "")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "");

const PENDING_NOTE = /[（(][^）)]*[待未暂][^）)]*[）)]/g;
const TECH =
  /(?<![a-z])(?:java(?:script)?|python|golang|go|c\+\+|c#|c|typescript|js|ts|vue|react|web|android|ios|php|sql|mysql|spring(?:boot)?|html5?|css|node(?:js)?|qt|swing|unity|matlab|linux|app|ai|it)(?![a-z])/g;
const FILLER =
  /^(?:我们?的|一个|一份|一次|一家|某个|某家|某|小|简单的?|期末|课上的?|学校的?|大[一二三四](?:时|的)?)+/;

const PROJECT_GENERIC = new Set([
  "",
  "项目",
  "小项目",
  "练手项目",
  "练习项目",
  "个人项目",
  "作品",
  "东西",
  "系统",
  "管理系统",
  "网站",
  "小程序",
  "软件",
  "程序",
  "社团",
  "社团活动",
  "学生会",
  "志愿者",
  "志愿活动",
  "志愿服务",
  "学生活动",
  "校园活动",
  "活动",
]);
const PROJECT_SUFFIX =
  /(?:课程设计|课设|大作业|课程作业|作业|课程项目|毕业设计|毕设|毕业论文|实训项目|实训|实验|比赛|竞赛|大赛|杯)$/;
const THING =
  /系统|平台|网站|网页|小程序|游戏|工具|机器人|商城|应用|软件|程序|助手|模型|算法|分析|预测|识别|检测|爬虫|博客|管理|编译器|播放器|插件/;
const COMPANY_GENERIC =
  /^(?:小|大|本地|当地|私人)?(?:互联网|科技|软件|外包|网络|it)?(?:公司|单位|企业|实习单位|实习|兼职|工作室|打工)?$/;

const keyOf = (section: IdentitySection) => (section === "projects" ? "name" : "company");

function core(section: IdentitySection, name: unknown): string {
  const text = String(name ?? "")
    .toLowerCase()
    .replace(PENDING_NOTE, "");
  const stripped = section === "projects" ? text.replace(TECH, "") : text;
  return plain(stripped).replace(FILLER, "").replace(/的$/, "");
}

/** 名字只是类别或课程，说明不了做的是什么。 */
export function isGenericName(section: string, name: unknown): boolean {
  if (!IDENTITY_SECTIONS.includes(section)) return false;
  const s = section as IdentitySection;
  const c = core(s, name);
  if (s === "experiences") return COMPANY_GENERIC.test(c);
  if (PROJECT_GENERIC.has(c)) return true;
  const suffix = c.match(PROJECT_SUFFIX);
  return !!suffix && !THING.test(c.slice(0, suffix.index));
}

const STORY: Record<IdentitySection, readonly string[]> = {
  projects: ["situation", "task", "action", "result", "highlights"],
  experiences: ["bullets", "highlights"],
};

const filled = (v: unknown) =>
  v !== undefined &&
  v !== null &&
  (typeof v !== "string" || v.trim() !== "") &&
  (!Array.isArray(v) || v.length > 0);

/** 讲过做法或要点：即使名字是泛称，也是一段真实经历。单有角色不算，模型常顺手补一个「参与」。 */
export function hasStory(section: string, item: Rec): boolean {
  if (!IDENTITY_SECTIONS.includes(section)) return true;
  return STORY[section as IdentitySection].some((f) => filled(item[f]));
}

/** 除了名字和类别还有别的内容。 */
export function hasContent(item: Rec, keyField: string): boolean {
  return Object.entries(item).some(
    ([k, v]) => !["id", "sourceFactIds", "kind", keyField].includes(k) && filled(v),
  );
}

/** 占位条目：只有泛称、没讲过内容，不进简历、不计完整度。 */
export function isPlaceholder(section: string, item: Rec): boolean {
  if (!IDENTITY_SECTIONS.includes(section)) return false;
  return isGenericName(section, item[keyOf(section as IdentitySection)]) && !hasStory(section, item);
}

const CATEGORIES: readonly [string, RegExp][] = [
  ["course", /课程设计|课设|大作业|课程作业|课程项目|实训|实验课/],
  ["thesis", /毕业设计|毕设|毕业论文/],
  ["contest", /比赛|竞赛|大赛|杯/],
  ["self", /自学|练手|自己(?:做|写|搭)|个人项目|教程|开源|博客/],
  ["campus", /社团|学生会|志愿|协会|班委|班干部|学生活动|校园活动/],
  ["work", /实习|兼职|勤工|家教|打工/],
];

function categoriesOf(text: string): Set<string> {
  return new Set(CATEGORIES.filter(([, re]) => re.test(text)).map(([c]) => c));
}

/** 用户在说另一段经历，不是在给刚才那条起名。 */
const ANOTHER = /还(?:做|写|参加|有|搞|弄)|另(?:外|一)|此外|其[他它]|别的|也(?:做|写|参加|搞)过/;

export interface Candidate {
  item: Rec;
  draft: boolean;
}

export interface Resolution extends Candidate {
  /** 认领后改用的名字。 */
  rename?: string;
}

const MIN_CONTAIN = 4;

function contains(a: string, b: string): boolean {
  return Math.min(a.length, b.length) >= MIN_CONTAIN && (a.includes(b) || b.includes(a));
}

function compatible(section: IdentitySection, hit: Rec, incoming: Rec, quote: string): boolean {
  if (ANOTHER.test(quote)) return false;
  if (hit.kind !== undefined && incoming.kind !== undefined && hit.kind !== incoming.kind) return false;
  const was = categoriesOf(String(hit[keyOf(section)] ?? ""));
  const now = categoriesOf(`${String(incoming[keyOf(section)] ?? "")} ${quote}`);
  return was.size === 0 || now.size === 0 || [...was].some((c) => now.has(c));
}

/**
 * 找新写入的条目对应已有的哪一条。pool 依次是画像里的条目和暂存条目（旧到新），
 * aliases 给出条目用过的全部名字（来自引用的事实）。
 */
export function resolveIdentity(
  section: string,
  name: string,
  incoming: Rec,
  quote: string,
  pool: readonly Candidate[],
  aliases: (item: Rec) => string[],
): Resolution | undefined {
  const norm = (v: unknown) =>
    String(v ?? "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "");
  const key = norm(name);
  const keyField = section === "education" ? "school" : section === "experiences" ? "company" : "name";
  const exact = (c: Candidate) => norm(c.item[keyField]) === key;
  const byName = pool.find(exact) ?? pool.find((c) => aliases(c.item).some((a) => norm(a) === key));
  if (byName) return byName;
  if (!IDENTITY_SECTIONS.includes(section)) return undefined;
  const s = section as IdentitySection;
  const field = keyField;
  const names = (c: Candidate) => [String(c.item[field] ?? ""), ...aliases(c.item)];

  if (isGenericName(s, name)) {
    const wanted = categoriesOf(name);
    if (wanted.size === 0) return undefined;
    const hits = pool.filter((c) =>
      names(c).some((n) => isGenericName(s, n) && [...categoriesOf(n)].some((x) => wanted.has(x))),
    );
    const hit = hits.length === 1 ? hits[0] : undefined;
    const current = plain(hit?.item[field]);
    // 「机械原理课程设计」仍是泛称，但比占位的「课程设计」多了信息，改用更具体的名字
    return hit && plain(name).length > current.length && plain(name).includes(current)
      ? { ...hit, rename: name }
      : hit;
  }

  const p = plain(name);
  const containing = pool.filter((c) => names(c).some((n) => !isGenericName(s, n) && contains(p, plain(n))));
  if (containing.length === 1) {
    const hit = containing[0] as Candidate;
    const current = plain(hit.item[field]);
    const longer = p.length > current.length && p.includes(current);
    return longer || isGenericName(s, hit.item[field]) ? { ...hit, rename: name } : hit;
  }
  if (containing.length > 1) return undefined;

  const named = pool.filter((c) => {
    const current = plain(c.item[field]);
    return isGenericName(s, c.item[field]) && current.length > 0 && p.includes(current);
  });
  const open = named.length > 0 ? named : pool.filter((c) => isPlaceholder(s, c.item));
  const fits = open.filter((c) => compatible(s, c.item, incoming, quote));
  const newest = fits.filter((c) => c.draft).at(-1) ?? fits.at(-1);
  return newest ? { ...newest, rename: name } : undefined;
}

/** 占位条目的追问：问清做的是什么，不问角色、技术栈这些细节。 */
export function placeholderQuestion(section: string, label: string): string {
  return section === "experiences"
    ? "是在哪家公司？"
    : `${label ? `这个${label.replace(/^(?:做过)?(?:一个)?/, "")}` : "它"}具体做的是什么？有名字的话也说一下。`;
}
