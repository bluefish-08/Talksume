import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import { qk } from "../../api/queries.ts";
import { useToast } from "../../components/Toast.tsx";
import type { ImportResult } from "./api.ts";
import { type ImportMode, ImportResumeDialog } from "./ImportResumeDialog.tsx";

export function useResumeImport(conversationId?: string) {
  const [mode, setMode] = useState<ImportMode | null>(null);
  const client = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();

  const onImported = (result: ImportResult) => {
    setMode(null);
    for (const queryKey of [qk.conversations, qk.profile, qk.resume]) {
      void client.invalidateQueries({ queryKey });
    }
    void client.invalidateQueries({ queryKey: ["conversation-detail", result.conversationId] });
    toast(
      result.conflicts > 0
        ? `已导入 ${result.imported} 条，${result.conflicts} 处不一致等你确认`
        : `已导入 ${result.imported} 条`,
    );
    navigate(`/c/${result.conversationId}`);
  };

  const dialog = mode && (
    <ImportResumeDialog
      initialMode={mode}
      {...(conversationId && { conversationId })}
      onClose={() => setMode(null)}
      onImported={onImported}
    />
  );
  return { open: (next: ImportMode = "file") => setMode(next), dialog };
}
