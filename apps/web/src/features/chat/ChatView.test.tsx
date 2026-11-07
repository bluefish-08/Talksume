import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { ChatView } from "./ChatView.tsx";
import type { ConversationDetail } from "./types.ts";

vi.mock("./useChatSession.ts", () => ({
  useChatSession: () => ({
    messages: [],
    send: vi.fn(),
    resume: { basics: { name: "李明", contacts: [] }, sections: [] },
    conflicts: [],
    streaming: false,
    resolving: false,
    completeness: { score: 0.79, progress: 1, sections: [], missing: [], gaps: [], tips: [] },
    highlights: new Set<string>(),
    focus: "education",
    stop: vi.fn(),
    retry: vi.fn(),
    resolveConflict: vi.fn(),
  }),
}));
vi.mock("../resume/polishQueries.ts", () => ({ usePolishedResume: () => ({ basics: {}, sections: [] }) }));
vi.mock("../resume/queries.ts", () => ({
  STYLE_ASK_MESSAGE: "帮我再设计几版简历样式",
  useFacts: () => ({ data: [] }),
}));
vi.mock("../../api/queries.ts", () => ({
  useConversations: () => ({ data: [{ id: "c1", title: "后端实习" }] }),
}));
vi.mock("../resume-import/useResumeImport.tsx", () => ({
  useResumeImport: () => ({ open: vi.fn(), dialog: null }),
}));
vi.mock("./useImageDraft.ts", () => ({
  REPLICA_DEFAULT_TEXT: "复刻",
  useImageDraft: () => ({ images: [], items: [], ids: [], uploading: false, clear: vi.fn() }),
}));
vi.mock("./useStickToBottom.ts", () => ({
  useStickToBottom: () => ({ ref: { current: null }, onScroll: vi.fn(), pin: vi.fn() }),
}));
vi.mock("./Composer.tsx", () => ({ Composer: () => null }));
vi.mock("./MessageList.tsx", () => ({ MessageList: () => null }));
vi.mock("./ResumePane.tsx", () => ({ ResumePane: () => <aside>简历面板</aside> }));
vi.mock("../resume-import/ImportPrompt.tsx", () => ({ ImportPrompt: () => null }));

const detail = { id: "c1", title: "后端实习", messages: [] } as unknown as ConversationDetail;

describe("对话页", () => {
  it("标题旁没有进度 chip", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <QueryClientProvider client={new QueryClient()}>
          <ChatView detail={detail} />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(html).toContain("后端实习");
    expect(html).toContain("简历 79%");
    expect(html).toContain("简历面板");
    expect(html).not.toContain("教育背景");
    expect(html).not.toContain("信息已基本完整");
  });
});
