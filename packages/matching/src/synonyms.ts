export type SkillCategory = "lang" | "tech" | "tool" | "domain";

interface SkillDef {
  name: string;
  aliases: string[];
  category: SkillCategory;
  /** 英文短别名（Go、C、AE 等）需区分大小写，避免误伤普通单词。 */
  caseSensitive?: string[];
}

const def = (
  name: string,
  category: SkillCategory,
  aliases: string[] = [],
  caseSensitive: string[] = [],
): SkillDef => ({ name, category, aliases, caseSensitive });

const SKILLS: SkillDef[] = [
  def("Python", "lang", ["python", "python3"]),
  def("Java", "lang", ["java"]),
  def("JavaScript", "lang", ["javascript", "js", "ecmascript", "es6"]),
  def("TypeScript", "lang", ["typescript", "ts"]),
  def("Go", "lang", ["golang", "go语言"], ["Go"]),
  def("C++", "lang", ["c++", "cpp"]),
  def("C", "lang", ["c语言"], ["C"]),
  def("C#", "lang", ["c#", "csharp"]),
  def("Rust", "lang", ["rust"]),
  def("Kotlin", "lang", ["kotlin"]),
  def("Swift", "lang", ["swift"]),
  def("Objective-C", "lang", ["objective-c", "objc"], ["OC"]),
  def("PHP", "lang", ["php"]),
  def("Shell", "lang", ["shell", "bash", "shell脚本"]),
  def("SQL", "lang", ["sql", "mysql语句"]),
  def("Lua", "lang", ["lua"]),
  def("Scala", "lang", ["scala"]),
  def("MATLAB", "lang", ["matlab"]),
  def("Dart", "lang", ["dart", "flutter"]),

  def("React", "tech", ["react", "react.js", "reactjs"]),
  def("Vue", "tech", ["vue", "vue.js", "vue3", "vuejs"]),
  def("HTML/CSS", "tech", ["html", "css", "html5", "css3"]),
  def("Node.js", "tech", ["node.js", "nodejs", "node"]),
  def("小程序", "tech", ["小程序", "miniprogram"]),
  def("Android", "tech", ["android", "安卓"]),
  def("iOS", "tech", ["ios"]),
  def("Spring", "tech", ["spring", "springboot", "spring boot", "springcloud", "spring cloud"]),
  def("MySQL", "tech", ["mysql"]),
  def("PostgreSQL", "tech", ["postgresql", "postgres"]),
  def("Redis", "tech", ["redis"]),
  def("MongoDB", "tech", ["mongodb", "mongo"]),
  def("Kafka", "tech", ["kafka"]),
  def("消息队列", "tech", ["消息队列", "rabbitmq", "rocketmq", "mq"]),
  def("Elasticsearch", "tech", ["elasticsearch"]),
  def("Docker", "tech", ["docker", "容器化"]),
  def("Kubernetes", "tech", ["kubernetes", "k8s", "云原生"]),
  def("Linux", "tech", ["linux", "unix"]),
  def("分布式", "tech", ["分布式", "高并发", "高可用"]),
  def("微服务", "tech", ["微服务", "grpc", "rpc"]),
  def("网络协议", "tech", ["tcp", "udp", "http", "网络协议", "网络编程"]),
  def("操作系统", "tech", ["操作系统"]),
  def("数据结构与算法", "tech", ["数据结构", "算法与数据结构", "leetcode"]),
  def("数据库", "tech", ["数据库", "nosql"]),
  def("Git", "tool", ["git", "github", "gitlab"]),
  def("CI/CD", "tool", ["ci/cd", "jenkins", "持续集成"]),

  def("Hadoop", "tech", ["hadoop", "hdfs", "mapreduce"]),
  def("Spark", "tech", ["spark"]),
  def("Flink", "tech", ["flink"]),
  def("Hive", "tech", ["hive"]),
  def("数据仓库", "tech", ["数据仓库", "数仓", "etl"]),
  def("数据分析", "domain", ["数据分析", "数据挖掘", "商业分析", "data analysis"]),
  def("数据可视化", "domain", ["数据可视化", "tableau", "power bi", "powerbi", "帆软", "finebi"]),
  def("Excel", "tool", ["excel", "wps表格"]),
  def("Pandas", "tech", ["pandas", "numpy"]),
  def("统计学", "domain", ["统计学", "统计分析", "统计建模", "假设检验", "回归分析"]),
  def("A/B测试", "domain", ["a/b测试", "ab测试", "a/b test", "abtest", "ab实验"]),

  def("机器学习", "domain", ["机器学习", "machine learning", "ml", "sklearn", "scikit-learn", "xgboost"]),
  def("深度学习", "domain", ["深度学习", "deep learning", "dl", "神经网络"]),
  def("PyTorch", "tech", ["pytorch", "torch"]),
  def("TensorFlow", "tech", ["tensorflow", "keras"]),
  def("自然语言处理", "domain", ["自然语言处理", "nlp", "文本挖掘", "文本分类"]),
  def("计算机视觉", "domain", ["计算机视觉", "cv", "图像识别", "目标检测", "opencv", "图像处理"]),
  def("大模型", "domain", ["大模型", "llm", "大语言模型", "语言模型", "gpt", "aigc", "生成式ai", "多模态"]),
  def("推荐系统", "domain", ["推荐系统", "推荐算法", "召回排序", "排序模型"]),
  def("Transformer", "tech", ["transformer", "bert"]),
  def("RAG", "tech", ["rag", "检索增强", "向量检索", "向量数据库"]),
  def("Agent", "domain", ["agent", "智能体", "langchain", "mcp"]),
  def("Prompt工程", "domain", ["prompt", "提示词", "提示工程"]),
  def("强化学习", "domain", ["强化学习", "rlhf"]),
  def("CUDA", "tech", ["cuda", "gpu编程", "高性能计算"]),

  def("Unity", "tool", ["unity", "unity3d"]),
  def("Unreal Engine", "tool", ["unreal", "虚幻", "虚幻引擎", "ue4", "ue5", "ue"]),
  def("OpenGL", "tech", ["opengl", "vulkan", "directx", "图形学", "图形渲染"]),
  def("Shader", "tech", ["shader", "着色器", "hlsl", "glsl"]),

  def("Figma", "tool", ["figma"]),
  def("Photoshop", "tool", ["photoshop"], ["PS"]),
  def("Illustrator", "tool", ["illustrator"], ["AI软件"]),
  def("Sketch", "tool", ["sketch"]),
  def("Blender", "tool", ["blender"]),
  def("Maya", "tool", ["maya", "3dsmax", "3ds max"]),
  def("After Effects", "tool", ["after effects"], ["AE"]),
  def("Axure", "tool", ["axure", "墨刀", "原型设计", "原型工具"]),
  def("Cinema 4D", "tool", ["c4d", "cinema 4d", "zbrush"]),
  def("交互设计", "domain", ["交互设计", "用户体验", "用户体验设计", "ux设计"]),
  def("视觉设计", "domain", ["视觉设计", "平面设计", "品牌设计", "ui设计", "界面设计"]),

  def("PRD", "domain", ["prd", "需求文档", "需求分析", "产品需求"]),
  def("用户研究", "domain", ["用户研究", "用户调研", "问卷调研", "用户访谈"]),
  def("文案写作", "domain", ["文案", "内容策划", "文字功底"]),
  def("新媒体运营", "domain", ["新媒体", "公众号", "小红书", "抖音运营", "社群运营", "内容运营"]),
  def("PPT/Office", "tool", ["ppt", "powerpoint", "office"]),
  def("项目管理", "domain", ["项目管理", "项目推进", "项目协调"]),
  def("自动化测试", "domain", [
    "自动化测试",
    "selenium",
    "appium",
    "jmeter",
    "pytest",
    "性能测试",
    "测试用例",
  ]),
  def("英语", "domain", ["英语", "cet-6", "cet6", "六级", "雅思", "托福"]),
];

interface Matcher {
  name: string;
  category: SkillCategory;
  find: (text: string) => { index: number; length: number } | undefined;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isAscii = (s: string) => /^[\x20-\x7e]+$/.test(s);
const ASCII_LEFT = "(?<![A-Za-z0-9+#.\\-])";

function matcherFor(skill: SkillDef): Matcher {
  const insensitive = skill.aliases.map((alias) =>
    isAscii(alias) ? `${ASCII_LEFT}${escapeRe(alias)}(?![A-Za-z0-9+#]|\\.[A-Za-z0-9])` : escapeRe(alias),
  );
  const ci = insensitive.length > 0 ? new RegExp(insensitive.join("|"), "i") : undefined;
  const sensitive = (skill.caseSensitive ?? []).map((a) => `${ASCII_LEFT}${escapeRe(a)}(?![A-Za-z0-9+#]|端)`);
  const cs = sensitive.length > 0 ? new RegExp(sensitive.join("|")) : undefined;
  return {
    name: skill.name,
    category: skill.category,
    find(text) {
      const found = ci?.exec(text) ?? cs?.exec(text);
      return found ? { index: found.index, length: found[0].length } : undefined;
    },
  };
}

const MATCHERS = SKILLS.map(matcherFor);
const BY_NAME = new Map(SKILLS.map((s) => [s.name, s]));

/** 技能名到统一规范名的映射，覆盖大小写与中英文同义（JS/JavaScript、Golang/Go、机器学习/ML）。 */
const ALIAS_INDEX = new Map<string, string>();
for (const skill of SKILLS) {
  ALIAS_INDEX.set(skill.name.toLowerCase(), skill.name);
  for (const alias of skill.aliases) ALIAS_INDEX.set(alias.toLowerCase(), skill.name);
  for (const alias of skill.caseSensitive ?? []) ALIAS_INDEX.set(alias.toLowerCase(), skill.name);
}

export interface SkillHit {
  name: string;
  category: SkillCategory;
  /** 命中位置附近的原文片段。 */
  snippet: string;
}

export function snippetAround(text: string, index: number, length: number, radius = 18): string {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + length + radius);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ")}${end < text.length ? "…" : ""}`;
}

/** 在自由文本里查找词典中的技能，每个技能只返回第一次出现。 */
export function findSkills(text: string): SkillHit[] {
  const hits: SkillHit[] = [];
  for (const m of MATCHERS) {
    const found = m.find(text);
    if (found) {
      hits.push({
        name: m.name,
        category: m.category,
        snippet: snippetAround(text, found.index, found.length),
      });
    }
  }
  return hits;
}

export function skillCategory(name: string): SkillCategory | undefined {
  return BY_NAME.get(name)?.category;
}

/** 规范化一个用户填写的技能名；词典里没有时退化为去空白小写。 */
export function normalizeSkill(raw: string): string {
  const key = raw.trim().toLowerCase();
  const direct = ALIAS_INDEX.get(key);
  if (direct) return direct;
  const hits = findSkills(raw);
  const first = hits[0];
  if (first && hits.length === 1) return first.name;
  return key.replace(/\s+/g, " ");
}

/** 用户填写的一项技能可能是「Python/Go」这样的复合写法，拆成多个规范名。 */
export function normalizeSkillList(raw: string): string[] {
  const whole = ALIAS_INDEX.get(raw.trim().toLowerCase());
  if (whole) return [whole];
  const hits = findSkills(raw);
  if (hits.length > 0) return hits.map((h) => h.name);
  const single = normalizeSkill(raw);
  return single ? [single] : [];
}

/** 持有右侧任一技能，可对左侧技能算部分覆盖。 */
export const PARTIAL_COVERAGE: Record<string, string[]> = {
  机器学习: ["深度学习", "PyTorch", "TensorFlow", "自然语言处理", "计算机视觉", "推荐系统", "大模型"],
  深度学习: ["PyTorch", "TensorFlow", "Transformer", "大模型"],
  大模型: ["Transformer", "RAG", "Agent", "Prompt工程", "自然语言处理"],
  数据库: ["MySQL", "PostgreSQL", "Redis", "MongoDB", "SQL"],
  SQL: ["MySQL", "PostgreSQL"],
  数据分析: ["统计学", "数据可视化", "Excel", "Pandas"],
  数据可视化: ["Excel"],
  分布式: ["微服务", "Kafka", "Kubernetes"],
  消息队列: ["Kafka"],
  视觉设计: ["Photoshop", "Illustrator", "Figma", "Sketch"],
  交互设计: ["Figma", "Sketch", "Axure"],
  "HTML/CSS": ["React", "Vue"],
  JavaScript: ["TypeScript", "Node.js", "React", "Vue"],
  Android: ["Kotlin"],
  iOS: ["Swift", "Objective-C"],
  "C++": ["C"],
  Agent: ["大模型", "RAG", "Prompt工程"],
  推荐系统: ["机器学习"],
  新媒体运营: ["文案写作"],
  "PPT/Office": ["Excel"],
};
