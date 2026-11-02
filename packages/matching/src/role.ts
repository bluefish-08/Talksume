export type RoleFamily =
  | "backend"
  | "frontend"
  | "client"
  | "fullstack"
  | "algorithm"
  | "ai_app"
  | "data"
  | "test"
  | "infra"
  | "engine"
  | "hardware"
  | "tech_other"
  | "product"
  | "gamedesign"
  | "design"
  | "pm"
  | "ops"
  | "marketing"
  | "biz"
  | "func"
  | "other";

export const ROLE_LABELS: Record<RoleFamily, string> = {
  backend: "后端开发",
  frontend: "前端开发",
  client: "客户端开发",
  fullstack: "全栈开发",
  algorithm: "算法",
  ai_app: "AI 应用开发",
  data: "数据分析/开发",
  test: "测试",
  infra: "基础架构/运维",
  engine: "引擎/图形",
  hardware: "硬件/智能系统",
  tech_other: "技术研发",
  product: "产品",
  gamedesign: "游戏策划",
  design: "设计",
  pm: "项目管理",
  ops: "运营",
  marketing: "市场/营销",
  biz: "商务/销售/采购",
  func: "职能（人力/法务/财务等）",
  other: "其他",
};

// 顺序即优先级：先命中的类别生效，如「产品运营」归运营、「测试开发」归测试
const RULES: [RoleFamily, RegExp][] = [
  ["test", /测试|QA/i],
  ["gamedesign", /策划/],
  ["pm", /项目管理|项目经理/],
  ["ops", /运营|用户研究/],
  ["design", /设计|美术|原画|UI|UX|交互|视觉|动效|动画|建模|模型师|特效|CG|插画/i],
  ["product", /产品|\bPM\b/i],
  ["algorithm", /算法|机器学习|深度学习|NLP|CV|推荐|大模型|研究员|感知|多模态|数据科学|AIGC/i],
  ["fullstack", /全栈/],
  ["backend", /后端|后台|服务端|server/i],
  ["frontend", /前端|web/i],
  ["client", /客户端|移动端|iOS|Android|安卓/i],
  ["ai_app", /Agent|AI\s*应用|AI\s*工程|AI\s*编程/i],
  ["data", /数据分析|数据开发|数据工程|商业分析|BA\/DS|数仓|数据仓库|\bBI\b|数据/i],
  ["engine", /引擎|渲染|编辑器|动捕/],
  ["infra", /运维|SRE|基础架构|架构|内核|高性能计算|云原生|平台软件/i],
  ["hardware", /硬件|电气|自动驾驶|无人机|毫米波|机器人|智能硬件|系统工程师/],
  ["marketing", /市场|营销|推广|投放|发行|新媒体|品牌/],
  ["biz", /商务|销售|采购|渠道|招商|拓展|顾问|选址/],
  ["func", /HR|招聘|人力|法务|财务|投资|行政|物业|内控|Internal Control|质量管理|制片/i],
  ["tech_other", /工程师|开发|研发|程序|技术/],
];

export function classifyRole(text: string): RoleFamily {
  for (const [family, re] of RULES) if (re.test(text)) return family;
  return "other";
}

const RELATED: [RoleFamily, RoleFamily, number][] = [
  ["backend", "fullstack", 0.7],
  ["backend", "ai_app", 0.6],
  ["backend", "infra", 0.6],
  ["backend", "data", 0.5],
  ["backend", "tech_other", 0.5],
  ["backend", "engine", 0.4],
  ["backend", "client", 0.4],
  ["backend", "frontend", 0.4],
  ["backend", "algorithm", 0.3],
  ["backend", "test", 0.3],
  ["frontend", "fullstack", 0.8],
  ["frontend", "client", 0.6],
  ["frontend", "tech_other", 0.5],
  ["client", "engine", 0.7],
  ["client", "fullstack", 0.5],
  ["client", "tech_other", 0.5],
  ["algorithm", "ai_app", 0.7],
  ["algorithm", "data", 0.6],
  ["algorithm", "tech_other", 0.4],
  ["ai_app", "fullstack", 0.7],
  ["ai_app", "data", 0.4],
  ["data", "tech_other", 0.4],
  ["test", "tech_other", 0.4],
  ["infra", "hardware", 0.3],
  ["infra", "tech_other", 0.5],
  ["engine", "tech_other", 0.5],
  ["hardware", "tech_other", 0.4],
  ["product", "gamedesign", 0.6],
  ["product", "pm", 0.5],
  ["product", "ops", 0.5],
  ["product", "design", 0.4],
  ["product", "data", 0.3],
  ["gamedesign", "design", 0.3],
  ["gamedesign", "ops", 0.3],
  ["ops", "marketing", 0.6],
  ["ops", "biz", 0.4],
  ["ops", "pm", 0.3],
  ["marketing", "biz", 0.5],
  ["design", "ops", 0.15],
];

const RELATED_INDEX = new Map<string, number>();
for (const [a, b, w] of RELATED) {
  RELATED_INDEX.set(`${a}|${b}`, w);
  RELATED_INDEX.set(`${b}|${a}`, w);
}

/** 两个岗位类别的相近程度，同类为 1，无关为 0。 */
export function roleRelatedness(a: RoleFamily, b: RoleFamily): number {
  if (a === b) return a === "other" ? 0 : 1;
  return RELATED_INDEX.get(`${a}|${b}`) ?? 0;
}
