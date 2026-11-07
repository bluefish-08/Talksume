import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatHeader } from "./ChatHeader.tsx";

describe("对话页头", () => {
  it("只有标题和简历入口，没有进度 chip", () => {
    const html = renderToStaticMarkup(<ChatHeader title="后端实习" pct={79} onOpenPane={() => {}} />);
    expect(html).toContain("后端实习");
    expect(html).toContain("简历 79%");
    expect(html).not.toContain("信息已基本完整");
    expect(html).not.toContain("实习</span>");
    expect((html.match(/<span/g) ?? []).length).toBe(1);
  });
});
