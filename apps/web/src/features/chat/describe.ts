import type { ProfileSection } from "../../api/types.ts";
import type { ProfileChange } from "./types.ts";

const FIELD_LABELS: Record<ProfileSection, Record<string, string>> = {
  basics: { name: "姓名", phone: "手机号", email: "邮箱", city: "所在城市", summary: "自我介绍" },
  education: {
    school: "学校",
    degree: "学位",
    major: "专业",
    start: "入学时间",
    end: "毕业时间",
    gpa: "成绩/排名",
    courses: "主修课程",
  },
  experiences: {
    company: "公司",
    title: "岗位",
    kind: "类型",
    start: "开始时间",
    end: "结束时间",
    bullets: "成果",
  },
  projects: {
    name: "项目名称",
    role: "角色",
    techStack: "技术栈",
    situation: "背景",
    task: "任务",
    action: "行动",
    result: "成果",
    start: "开始时间",
    end: "结束时间",
  },
  skills: { name: "技能", level: "熟练度" },
  awards: { name: "奖项", date: "获奖时间", description: "说明" },
  intention: {
    roles: "意向岗位",
    cities: "意向城市",
    jobType: "求职类型",
    availableFrom: "到岗时间",
    salaryMin: "期望月薪下限",
    salaryMax: "期望月薪上限",
  },
};

const ENUMS: Record<string, string> = {
  associate: "专科",
  bachelor: "本科",
  master: "硕士",
  phd: "博士",
  internship: "实习",
  fulltime: "全职",
  parttime: "兼职",
  campus: "校招",
  experienced: "社招",
  familiar: "了解",
  proficient: "熟练",
  expert: "精通",
  present: "至今",
};

const MAX_LEN = 60;

export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(formatValue).filter(Boolean).join("、");
  if (typeof value === "number") return `${value} 元`;
  if (typeof value !== "string") return "";
  const text = /^\d{4}-\d{2}$/.test(value) ? value.replace("-", ".") : (ENUMS[value] ?? value);
  return text.length > MAX_LEN ? `${text.slice(0, MAX_LEN)}…` : text;
}

function period(item: Record<string, unknown>): string {
  const start = formatValue(item.start);
  const end = formatValue(item.end);
  return start && end ? `${start} – ${end}` : start || end;
}

function itemSummary(section: ProfileSection, item: Record<string, unknown>): string {
  const parts: unknown[] = [];
  switch (section) {
    case "education":
      parts.push(item.school, item.major, item.degree);
      break;
    case "experiences":
      parts.push(item.company, item.title, period(item));
      break;
    case "projects":
      parts.push(item.name, item.role);
      break;
    case "skills":
      parts.push(item.name, item.level);
      break;
    default:
      parts.push(item.name);
  }
  return parts.map(formatValue).filter(Boolean).join(" · ");
}

/** 一条变更转成「分区 + 一句人话」。 */
export function describeChange(change: ProfileChange): string {
  if (change.field === "_item" && typeof change.value === "object" && change.value !== null) {
    return itemSummary(change.section, change.value as Record<string, unknown>);
  }
  const label = FIELD_LABELS[change.section][change.field] ?? change.field;
  const next = formatValue(change.value);
  const prev = formatValue(change.previous);
  return prev && prev !== next && !Array.isArray(change.value)
    ? `${label}：${prev} → ${next}`
    : `${label}：${next}`;
}
