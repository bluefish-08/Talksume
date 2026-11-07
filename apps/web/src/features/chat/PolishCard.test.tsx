import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ToastProvider } from "../../components/Toast.tsx";
import { acceptAllDecision, PolishCardView } from "./PolishCard.tsx";
import type { PolishCard } from "./types.ts";

function render(card: PolishCard, superseded = false): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>
        <PolishCardView card={card} superseded={superseded} onOpen={() => {}} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const card: PolishCard = {
  kind: "generation",
  status: "draft",
  items: [
    {
      id: "p1",
      number: 1,
      heading: "云图数据",
      before: "我用 Redis 搞了个缓存，然后接口快了很多",
      after: "基于 Redis 实现热点数据缓存",
      state: "pending",
      blocked: false,
    },
    {
      id: "p2",
      heading: "校园二手交易平台",
      before: "做了个交易平台",
      after: "主导校园交易平台",
      state: "pending",
      blocked: true,
      violations: ["主导"],
    },
  ],
};

describe("润色卡片渲染", () => {
  it("待定时显示草稿、编号、原句和两个按钮，拦下的单独灰显", () => {
    const html = render(card);
    expect(html).toContain("润色 · 1 处");
    expect(html).toContain("草稿");
    expect(html).toContain("云图数据");
    expect(html).toContain("改写「我用 Redis 搞了个…」");
    expect(html).toContain("没改：主导（你没说过）");
    expect(html).toContain("都用上");
    expect(html).toContain("在右边看");
  });

  it("全部采用后显示已采用，不再出现都用上", () => {
    const html = render({
      ...card,
      status: "adopted",
      items: card.items.map((item) => ({ ...item, state: "accepted" as const, blocked: false })),
    });
    expect(html).toContain("已采用");
    expect(html).toContain('data-state="accepted"');
    expect(html).not.toContain("都用上");
  });

  it("全部不要时显示没采用，行上标不要并把改写文字划掉", () => {
    const first = card.items[0];
    if (!first) throw new Error("缺少测试数据");
    const html = render({
      ...card,
      status: "none",
      items: [{ ...first, state: "dismissed", after: "基于 Redis 实现热点数据缓存" }],
    });
    expect(html).toContain("没采用");
    expect(html).toContain('data-state="dismissed"');
    expect(html).toContain("不要");
    expect(html).toContain("基于 Redis 实现热点数据缓存");
  });

  it("部分采用时显示部分采用和都用上", () => {
    const first = card.items[0];
    if (!first) throw new Error("缺少测试数据");
    const html = render({
      ...card,
      status: "partial",
      items: [
        { ...first, state: "accepted" },
        { ...first, id: "p3", number: 2, state: "pending" },
      ],
    });
    expect(html).toContain("部分采用");
    expect(html).toContain("都用上");
  });

  it("都用上只提交待定且没被拦下的 id", () => {
    expect(acceptAllDecision(card.items)).toEqual({ ids: ["p1"], action: "accept" });
  });

  it("旧卡折叠成一行", () => {
    const html = render(card, true);
    expect(html).toContain("上一版润色 · 1 处建议");
    expect(html).not.toContain("云图数据");
  });
});
