import { DEFAULT_RESUME_STYLE } from "@talksume/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { ResumeContent } from "../api/types.ts";
import { ToastProvider } from "../components/Toast.tsx";
import { POLISH_ASK_MESSAGE } from "../features/resume/polishQueries.ts";
import { ResumePage } from "./Resume.tsx";

const resume: ResumeContent = {
  basics: { name: "李明", contacts: [] },
  sections: [{ kind: "skills", title: "专业技能", items: [{ heading: "语言", bullets: [] }] }],
};

vi.mock("../api/queries.ts", () => ({
  qk: { conversations: ["conversations"], profile: ["profile"], resume: ["resume"] },
  useProfile: () => ({
    data: {
      profile: { intention: { roles: [] } },
      completeness: { score: 0.79, sections: [], missing: [] },
    },
  }),
}));
vi.mock("../features/resume/queries.ts", () => ({
  STYLE_ASK_MESSAGE: "帮我再设计几版简历样式",
  useResume: () => ({ data: { resume }, isPending: false, isError: false, refetch: vi.fn() }),
  useResumeStyle: () => ({ style: DEFAULT_RESUME_STYLE }),
}));
vi.mock("../features/resume/ExportMenu.tsx", () => ({ ExportMenu: () => null }));
vi.mock("../features/resume/ResumePreview.tsx", () => ({ ResumePreview: () => null }));
vi.mock("../features/resume/SuggestionsMenu.tsx", () => ({ SuggestionsMenu: () => null }));
vi.mock("../features/resume/TemplatePicker.tsx", () => ({ TemplatePicker: () => null }));
vi.mock("../features/resume/ZoomControl.tsx", () => ({ ZoomControl: () => null }));
vi.mock("../features/resume-import/useResumeImport.tsx", () => ({
  useResumeImport: () => ({ open: vi.fn(), dialog: null }),
}));
vi.mock("../features/tailor/TailorDraft.tsx", () => ({ TailorDraft: () => null }));
vi.mock("../features/tailor/VersionSwitch.tsx", () => ({ VersionSwitch: () => null }));
vi.mock("../features/chat/ChatPanel.tsx", () => ({ ChatPanel: () => <aside>AI 助手</aside> }));

describe("/resume 润色入口", () => {
  it("按钮文案是润色，初始消息是让助手润色简历", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <QueryClientProvider client={new QueryClient()}>
          <ToastProvider>
            <ResumePage />
          </ToastProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(html).toContain("润色");
    expect(POLISH_ASK_MESSAGE).toBe("帮我润色一下简历");
  });
});
