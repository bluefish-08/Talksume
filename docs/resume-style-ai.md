# 对话定制简历样式：方案

> 目标：用户在对话里说「更稳重一点、标题用深绿、两栏」，助手生成一套只属于他的简历样式，右侧预览和导出的 PDF 都按这套样式来。

## 1. 现状

- `packages/core/src/resume-style.ts`：4 个预设模板（campus / modern / minimal / tech）× 4 种强调色，偏好存在 `users.resume_style`（jsonb），读的时候坏值一律回落到默认。
- `packages/resume-render`：`renderFragment` 输出「CSS + 不含 html/body 的片段」，网页预览把它 `innerHTML` 进 shadow DOM，PDF 端包成整页后 `page.setContent` + `page.pdf`。两边是同一份 HTML/CSS。
- PDF 端已经做了：`javaScriptEnabled: false`，页面里带 `default-src 'none'; style-src 'unsafe-inline'` 的 CSP。没做：网络请求拦截。
- 前端预览：`ResumePreview` 用 `root.innerHTML = ...`，任何未转义的内容都会直接进 DOM。

## 2. 两种做法

### (a) agent 直接写整页 HTML

模型按用户描述输出一整份 HTML（含 CSS），我们拿去预览和打印。

### (b) agent 只产出受约束的样式描述，套在我们自己的骨架上

模型只输出一份「主题 JSON」，字段全部是枚举或经过校验的颜色值；HTML 骨架、内容转义、CSS 生成都由我们的代码完成。

(b) 还能再细分成两档：

- **b1 白名单 CSS**：允许模型写 CSS，但过一遍属性和取值白名单。
- **b2 主题 JSON**：完全不让模型写 CSS，只填 `headingStyle: "bar"`、`accent: "#166534"` 这类字段，CSS 由代码按字段拼出来。

## 3. 对比

| 维度 | (a) 整页 HTML | (b1) 白名单 CSS | (b2) 主题 JSON（采用） |
|---|---|---|---|
| 服务端无头浏览器 SSRF | 高。`<img src>`、`<link>`、`@import`、`url()`、`<iframe>`、`<meta refresh>` 都会发请求，内网地址（元数据服务、Postgres、Redis 的 HTTP 探测）可被打到 | 中。`url()`、`@import`、`image-set()`、`@font-face src` 都要拦，漏一个就是 SSRF | 无。模型输出里没有任何 URL 能进 CSS |
| 服务端 JS 执行 | 高。即便关了 JS，`<meta http-equiv>`、SVG/MathML 的各种怪招也要逐个防 | 无（只有 CSS） | 无 |
| 前端预览 XSS | 高。要上 DOMPurify 级别的清洗，或者塞 sandbox iframe；预览现在是 shadow DOM + innerHTML，直接放不安全 | 低。CSS 本身不执行脚本，但 `content: attr()`、属性选择器可以做数据外带 | 无。颜色值过了 `^#[0-9a-f]{6}$`，其余字段是枚举 |
| 内容被模型改写 | 高。模型重写整页时会顺手改措辞、漏条目、编造内容，等于绕过了「只写用户说过的事实」的整套防线 | 无 | 无。内容仍然来自画像，渲染代码只认 `ResumeContent` |
| ATS 可读性 | 不可控。模型可能用表格排版、图片承载文字、`::before` 塞文字、打乱 DOM 顺序 | 部分可控。DOM 是我们的，但 CSS 能用 `order`、`position: absolute`、`content` 打乱视觉与文本顺序 | 可控。DOM 顺序固定、文字都在节点里；两栏布局时 DOM 先侧栏后正文，已知风险见下 |
| 分页与打印 | 不可控。每份 HTML 的分页表现都不一样，没法做密度自适应 | 部分可控。模型能改字号、边距，现有的密度估算会失准 | 可控。字号、间距、边距仍由 `layout.ts` 的密度档位决定，主题只给「宽松 / 标准 / 紧凑 / 自动」 |
| 回退到预设模板 | 难。坏 HTML 只能整份丢弃 | 中。CSS 部分失效时样式会半残 | 易。主题存成 `resume_style.theme`，校验失败直接丢掉，回落到同时保存的预设模板和强调色 |
| DOCX 导出 | 无法复用 | 无法复用 | 能复用颜色（DOCX 用主题的强调色），布局回落到对应的预设 |
| 评测 | 难。只能截图人工看，或者再让一个模型评审 | 中 | 易。工具参数是结构化的，「深绿」→ 色相落在绿色区间、「两栏」→ `layout: "sidebar"` 都能写成断言 |
| 表达力 | 最高 | 高 | 中。覆盖配色、字体、标题样式、抬头样式、对齐、单双栏、项目符号、密度；做不到任意装饰（底纹、图标、照片） |
| 实现成本 | 低（但安全加固成本高） | 高（要写 CSS 解析和白名单） | 低 |

### 结论

**采用 (b)，而且是 b2 主题 JSON，不做白名单 CSS。** 理由：

1. 安全上，b2 把攻击面收缩到「6 位十六进制颜色 + 枚举」，不需要 CSS 解析器、不需要 DOMPurify，服务端浏览器和前端预览都没有可注入的位置。b1 的白名单要和浏览器 CSS 解析器的行为严格一致，`url()` 的各种转义、注释拆分、`\` 转义都是绕过点，不值得在比赛周期内去守。
2. 内容安全：简聊的核心承诺是「只写用户说过的事实」。(a) 让模型重写整页，等于给了它一个绕过事实校验的口子。
3. 「风格定制」的真实需求集中在配色、字体、标题样式、单双栏、疏密这几项，b2 的字段已经能覆盖；以后需要更多花样，加枚举值就行，每加一个都是我们自己写的、测过的 CSS。
4. 评测能落到结构化断言上，可以并进现有的探针评测。

## 4. 主题 JSON（`ResumeTheme`）

定义在 `packages/core/src/resume-theme.ts`，`.strict()`，多余字段（比如模型自作主张塞的 `css`）直接拒绝。

| 字段 | 取值 | 说明 |
|---|---|---|
| `name` | 1–12 字 | 展示名，如「稳重深绿」 |
| `accent` | `#rrggbb` | 主色：标题、线条、色块 |
| `headingColor` | `#rrggbb`，可选 | 分区标题文字色，默认等于 `accent` |
| `bodyFont` / `headingFont` | `sans` / `serif` | 只在我们预置的本地字体栈里选，不加载网络字体 |
| `header` | `plain` / `rule` / `band` | 抬头：无装饰 / 底部细线 / 主色色块白字 |
| `headerAlign` | `left` / `center` | 抬头对齐 |
| `headingStyle` | `underline` / `bar` / `block` / `plain` | 分区标题：下划线 / 左侧色条 / 色块白字 / 只变色 |
| `layout` | `single` / `sidebar` | 单栏 / 两栏（左窄栏放教育、技能、奖项） |
| `bullet` | `dot` / `square` / `dash` | 项目符号 |
| `skills` | `line` / `tags` | 技能以文字行或标签展示 |
| `density` | `auto` / `roomy` / `normal` / `compact` | 疏密，`auto` 走现有的一页自适应 |

校验之外还有一步**归一化**（`sanitizeTheme`）：

- 颜色统一转小写；
- 和白底的对比度低于 4.5:1（WCAG AA，正文级）就逐步混黑加深，直到达标，并把调整写进说明返回给模型（例如「浅黄 #fde047 太浅，打印看不清，已加深为 #8a7a26」）。`band` / `block` 用主色做底、白字，同一条规则也保证了白字可读。

存储：`users.resume_style` 原来是 `{ template, accent }`，现在多一个可选的 `theme`。保存主题时，同时按主题算出一个**最接近的预设**写进 `template` / `accent`（两栏 → tech，色块抬头 → modern，衬线 → minimal，其余 → campus；强调色按色相取最近的一个），作为：

- 主题校验失败（例如以后改了 schema）时的回退；
- 投递快照（`resume_versions` 只有 template/accent 两列）和 HR 端看到的样式；
- DOCX 的版式。

不需要数据库迁移。

## 5. 渲染

- `renderFragment(content, { theme })`：有主题时先再跑一遍 `sanitizeTheme`（纵深防御：哪怕库里被写进了坏值，渲染层也只认合法主题，不合法就回落预设），然后用「公共基础 CSS + 按字段拼出的主题 CSS」。拼 CSS 的每一段都是代码里的常量，唯一插进去的变量是已校验的颜色和固定的字体栈。
- 两栏：`<div class="cols"><aside class="side">…</aside><div class="main">…</div></div>`，CSS grid 排版。DOM 顺序是「抬头 → 侧栏（教育、技能、奖项）→ 正文（经历、项目……）」。
- 密度：沿用 `layout.ts` 的档位和一页估算；两栏时按正文栏的宽度估算高度。
- PDF：在原有的禁用 JS + CSP 之上，加 `context.route("**/*", abort)` 拦截一切网络请求、`offline: true`、`serviceWorkers: "block"`。`setContent` 本身不走网络，所以拦截不影响正常渲染。

## 6. agent 工具 `design_resume_style`

- 参数就是主题字段（全部可选）加 `reset`。模型把用户的描述翻译成字段，**增量合并**到当前样式上：用户说「再紧凑一点」只改 `density`，其余不动。当前没有主题时，从当前预设推出一个起点。
- 服务端端口 `ResumeStyler.design(patch)`：读当前样式 → 合并 → `sanitizeTheme` → 存库 → 返回主题和调整说明。工具结果里给模型一段中文摘要和「预览已更新、导出 PDF 也会按这套样式」的口径；保存失败时明确告诉模型不能说已经改好。
- `reset: true` 清掉主题，回到预设模板。
- 和建档的关系：样式工具和岗位工具一样算「旁支任务」，这一轮不强制追加建档问题、不触发收尾；「样式已保存」这类话不会被「声称已记下却没写入」的检查误判。
- 前端收到 `resume_style` 事件后直接更新样式缓存，预览立刻换样式；顶部下拉显示「AI 定制 · 稳重深绿」，选任一预设即回到预设（主题被清掉）。

## 7. 评测

- 单元测试：校验器（坏颜色、多余字段、对比度加深、回退）、渲染（每个字段都落到 CSS、颜色只以 hex 形式出现、两栏 DOM 顺序、坏主题回落预设）、PDF 网络拦截（本地起一个 HTTP 服务，渲染带外链的 HTML，断言服务端一次请求都没收到）、工具调用（合并、reset、失败口径、事件）。
- 对话评测：新增探针 `style-request`，状态是建档中途，用户说「简历能不能更稳重一点，标题用深绿，做成两栏」，断言：调用了 `design_resume_style`、`layout = sidebar`、标题色色相在绿色区间且偏深、没有写画像、问句不超过 1 个。其余探针和多人设按手册 04 的门槛跑 A/B。

## 8. 已知局限

- 两栏对 ATS 有风险：多数 ATS 按 PDF 文本流读取，我们的 DOM 顺序是先侧栏后正文，读出来的顺序是「教育、技能 → 经历」，不会交错；但按坐标切块的解析器可能把左右两栏同一高度的行拼在一起。工具结果里会提醒用户：投递大厂的网申系统时优先单栏。
- 表达力有限：不支持照片、图标、底纹、自定义字体文件。
- 投递快照和 HR 端看到的是「最接近的预设」而不是主题本身（`resume_versions` 只有 template/accent 两列，要完整保留需要加一列，留到下一步）。
- DOCX 只用主题的颜色，版式回落到对应预设。
