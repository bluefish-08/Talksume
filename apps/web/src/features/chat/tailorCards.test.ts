import { describe, expect, it } from "vitest";
import {
  cardStatus,
  changeLabel,
  clipLabel,
  levelName,
  menuKeyAction,
  mergeTailorCard,
  placeTailorCards,
  versionMenuItems,
  withLiveSelection,
} from "./tailorCards.ts";
import type { ChatMessage, TailorCard, TailorCardItem } from "./types.ts";

const card = (jobId: string, changes = 2, extra: Partial<TailorCard> = {}): TailorCard => ({
  jobId,
  company: "美团",
  title: "后端开发工程师（实习）",
  level: "light",
  changes,
  rejected: 0,
  ...extra,
});

const message = (key: string, tailor?: TailorCard): Pick<ChatMessage, "key" | "tailor"> => ({
  key,
  ...(tailor && { tailor }),
});

const item = (extra: Partial<TailorCardItem>): TailorCardItem => ({
  id: "x",
  title: "云图数据",
  summary: "模型给的长理由",
  selected: true,
  blocked: false,
  ...extra,
});

const view = (over: Record<string, unknown> = {}) =>
  ({ adopted: null, selected: [], revoked: false, changes: [], ...over }) as never;

describe("定制卡片在同一场对话里的位置", () => {
  it("同一岗位后面又出了新版时，旧的收成一行", () => {
    const placed = placeTailorCards([
      message("u1"),
      message("a1", card("demo:mt1", 3)),
      message("a2", card("demo:other")),
      message("a3", card("demo:mt1", 2)),
    ]);
    expect(placed.get("a1")).toMatchObject({ superseded: true });
    expect(placed.get("a2")).toMatchObject({ superseded: false });
    expect(placed.get("a3")).toMatchObject({ superseded: false });
    expect(placed.get("a1")?.card.changes).toBe(3);
  });

  it("没有新版时不折叠，跨岗位互不影响", () => {
    const placed = placeTailorCards([message("a1", card("demo:mt1")), message("a2", card("demo:other"))]);
    expect(placed.get("a1")?.superseded).toBe(false);
    expect(placed.get("a2")?.superseded).toBe(false);
  });

  it("select/revoke 的更新卡不单独占位，也不产生「上一版」", () => {
    const generation = card("demo:mt1", 3, {
      kind: "generation",
      status: "draft",
      items: [item({ id: "summary", number: 1 })],
    });
    const update = card("demo:mt1", 2, {
      kind: "update",
      status: "revoked",
      items: [item({ id: "summary", number: 1, selected: false })],
    });
    const placed = placeTailorCards([message("a1", generation), message("a2", update)]);
    expect([...placed.keys()]).toEqual(["a1"]);
    expect(placed.get("a1")?.superseded).toBe(false);
    expect(placed.get("a1")?.card.status).toBe("revoked");
    expect(placed.get("a1")?.card.items?.[0]?.selected).toBe(false);
    expect(placed.get("a1")?.card.kind).toBe("generation");
  });

  it("旧数据没有 kind 时按新生成处理；更新只并进它之前最近一次生成", () => {
    const legacy = card("demo:mt1", 3);
    const update = card("demo:mt1", 2, { kind: "update", status: "adopted" });
    const placed = placeTailorCards([message("a1", legacy), message("a2", update)]);
    expect(placed.get("a1")?.card.status).toBe("adopted");
    expect(placed.has("a2")).toBe(false);
  });

  it("更新卡合并时保留生成卡的 kind，并覆盖状态和选中项", () => {
    const merged = mergeTailorCard(
      card("demo:mt1", 3, { kind: "generation", status: "draft", items: [item({ id: "a" })] }),
      card("demo:mt1", 2, { kind: "update", status: "adopted", items: [item({ id: "a", selected: false })] }),
    );
    expect(merged).toMatchObject({ kind: "generation", status: "adopted", changes: 2 });
    expect(merged.items?.[0]?.selected).toBe(false);
  });
});

describe("卡片状态跟服务端一致", () => {
  it("已采用优先，其次看服务端撤销标记，再看更新卡快照", () => {
    expect(cardStatus(undefined)).toBe("draft");
    expect(
      cardStatus(
        view({
          adopted: { resumeVersionId: "v1", adoptedAt: "2026-10-01T00:00:00.000Z" },
          selected: ["summary"],
        }),
      ),
    ).toBe("adopted");
    expect(
      cardStatus(
        view({
          adopted: { resumeVersionId: "v1", adoptedAt: "2026-10-01T00:00:00.000Z" },
          selected: [],
        }),
      ),
    ).toBe("draft");
    expect(cardStatus(view({ revoked: true }))).toBe("revoked");
    expect(cardStatus(undefined, { status: "revoked" })).toBe("revoked");
  });

  it("选中状态以服务端为准，撤销后被拦下和未选中的都不亮", () => {
    const items = [item({ id: "a" }), item({ id: "b" }), item({ id: "bad", blocked: true, selected: false })];
    expect(withLiveSelection(items, view({ selected: ["a"] }), "draft").map((i) => i.selected)).toEqual([
      true,
      false,
      false,
    ]);
    expect(withLiveSelection(items, view(), "draft").map((i) => i.selected)).toEqual([true, true, false]);
    expect(withLiveSelection(items, view({ revoked: true }), "revoked").map((i) => i.selected)).toEqual([
      false,
      false,
      false,
    ]);
  });

  it("档位显示中文名", () => {
    expect(levelName("light")).toBe("微调");
    expect(levelName("keywords")).toBe("嵌入关键词");
    expect(levelName("deep")).toBe("深度改写");
    expect(levelName(undefined)).toBe("");
  });
});

describe("确定性的改动短标签", () => {
  it("按改动数据生成，不看模型理由", () => {
    expect(changeLabel(item({ kind: "summary", hadBefore: false }))).toBe("补一段摘要");
    expect(changeLabel(item({ kind: "summary", hadBefore: true }))).toBe("改写摘要");
    expect(changeLabel(item({ kind: "bullet_order", order: ["缓存优化"] }))).toBe("缓存优化提到第一条");
    expect(changeLabel(item({ kind: "bullet", name: "订单查询接口开发" }))).toBe("改写「订单查询接口开发」");
    expect(changeLabel(item({ kind: "item_order", order: ["校园跑腿"] }))).toBe("校园跑腿移到前面");
    expect(
      changeLabel(
        item({
          kind: "skill_order",
          order: ["Redis", "MySQL", "Java"],
          orderBefore: ["Java", "MySQL", "Redis"],
        }),
      ),
    ).toBe("Redis提前");
    expect(
      changeLabel(
        item({
          kind: "skill_order",
          order: ["Redis", "MySQL", "Kafka", "Java"],
          orderBefore: ["Java", "MySQL", "Redis", "Kafka"],
        }),
      ),
    ).toBe("Redis、Kafka提前");
  });

  it("长标签截到 24 字以内并带省略号", () => {
    const long = "非常非常长的一段实习经历名称超过二十四字还要更长";
    const label = changeLabel(item({ kind: "item_order", order: [long] }));
    expect(Array.from(label)).toHaveLength(24);
    expect(label.endsWith("…")).toBe(true);
    expect(clipLabel("短标签")).toBe("短标签");
  });

  it("旧卡片没有 kind 时退回原有摘要，截断后仍可读", () => {
    const label = changeLabel(item({ kind: undefined, summary: "把摘要改成更贴近岗位的说法" }));
    expect(label).toBe("把摘要改成更贴近岗位的说法");
  });
});

describe("版本菜单", () => {
  it("草稿态：主简历未选、定制版显示草稿与改动数、底部是放弃草稿", () => {
    const items = versionMenuItems({ company: "美团", changes: 3, status: "draft", showingTailored: true });
    expect(items).toMatchObject([
      { id: "main", checked: false, label: "主简历", detail: "投其他岗位时用" },
      { id: "tailored", checked: true, label: "美团定制版", detail: "草稿 · 3 处改动" },
      { id: "revoke", label: "放弃草稿", danger: false },
    ]);
  });

  it("已采用态：定制版说明岗位用途，底部是危险的改回主简历", () => {
    const items = versionMenuItems({
      company: "美团",
      changes: 3,
      status: "adopted",
      showingTailored: false,
    });
    expect(items[1]).toMatchObject({
      checked: false,
      detail: "已采用 · 3 处改动 · 投美团这个岗位时用",
    });
    expect(items[2]).toMatchObject({ label: "改回主简历", danger: true });
  });

  it("已改回主简历也显示在菜单说明里", () => {
    const items = versionMenuItems({
      company: "美团",
      changes: 2,
      status: "revoked",
      showingTailored: false,
    });
    expect(items[1]).toMatchObject({ detail: "已改回主简历 · 2 处改动" });
  });

  it("键盘：Escape 关闭，方向键和 Home/End 移动焦点", () => {
    expect(menuKeyAction("Escape")).toBe("close");
    expect(menuKeyAction("ArrowDown")).toBe("next");
    expect(menuKeyAction("ArrowUp")).toBe("prev");
    expect(menuKeyAction("Home")).toBe("first");
    expect(menuKeyAction("End")).toBe("last");
    expect(menuKeyAction("Tab")).toBeUndefined();
  });
});
