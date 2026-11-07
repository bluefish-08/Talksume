import { describe, expect, it } from "vitest";
import {
  mergePolishCard,
  pendingPolishIds,
  placePolishCards,
  polishStatus,
  withLivePolishItems,
} from "./polishCards.ts";
import type { PolishCard } from "./types.ts";

function itemAt(items: PolishCard["items"], i: number): PolishCard["items"][number] {
  const item = items[i];
  if (!item) throw new Error("缺少测试数据");
  return item;
}

const generation: PolishCard = {
  kind: "generation",
  status: "draft",
  items: [
    {
      id: "p1",
      number: 1,
      heading: "云图数据",
      before: "旧",
      after: "新",
      state: "pending",
      blocked: false,
    },
    {
      id: "p2",
      heading: "校园二手交易平台",
      before: "旧",
      after: "新",
      state: "pending",
      blocked: true,
      violations: ["主导"],
    },
  ],
};

describe("润色卡片", () => {
  it("更新卡合并进最近一次生成卡，不单独占位", () => {
    const update: PolishCard = {
      kind: "update",
      status: "adopted",
      items: generation.items.map((item) => ({ ...item, state: "accepted" as const })),
    };
    const placed = placePolishCards([
      { key: "a1", polish: generation },
      { key: "a2", polish: update },
    ]);
    expect([...placed.keys()]).toEqual(["a1"]);
    expect(placed.get("a1")?.card.status).toBe("adopted");
    expect(placed.get("a1")?.card.kind).toBe("generation");
  });

  it("新的生成卡让旧卡折叠", () => {
    const next: PolishCard = { kind: "generation", status: "draft", items: [] };
    const placed = placePolishCards([
      { key: "a1", polish: generation },
      { key: "a2", polish: next },
    ]);
    expect(placed.get("a1")?.superseded).toBe(true);
    expect(placed.get("a2")?.superseded).toBe(false);
  });

  it("合并只替换状态和条目，保留原 generation 类型", () => {
    const merged = mergePolishCard(generation, { kind: "update", status: "partial", items: [] });
    expect(merged).toMatchObject({ kind: "generation", status: "partial", items: generation.items });
  });

  it("都用上只取待定且没被拦下的 id", () => {
    expect(pendingPolishIds(generation.items)).toEqual(["p1"]);
    expect(polishStatus(generation.items)).toBe("draft");
    expect(polishStatus(generation.items.map((item) => ({ ...item, state: "accepted" as const })))).toBe(
      "adopted",
    );
    expect(
      polishStatus([
        ...generation.items,
        { ...itemAt(generation.items, 0), id: "p3", number: 2, state: "accepted" as const },
      ]),
    ).toBe("partial");
    expect(
      polishStatus(
        generation.items.map((item) => ({ ...item, blocked: false, state: "dismissed" as const })),
      ),
    ).toBe("none");
  });

  it("卡片条目跟随服务端当前状态", () => {
    const live = withLivePolishItems(generation.items, [
      {
        itemKey: "experiences:云图数据",
        sectionKind: "experiences",
        heading: "云图数据",
        slot: 0,
        text: "旧",
        sourceHash: "h",
        factIds: [],
        stale: false,
        polish: {
          id: "p1",
          suggestion: "新建议",
          accepted: "已采用的新",
          status: "accepted",
          violations: [],
        },
      },
    ]);
    expect(live[0]).toMatchObject({ after: "已采用的新", state: "accepted", blocked: false });
    expect(live[1]?.blocked).toBe(true);
  });
});
