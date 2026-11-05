import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { ApiError, api } from "../api/client.ts";
import { Button, EmptyState, Spinner } from "../components/ui.tsx";
import { ChatView } from "../features/chat/ChatView.tsx";
import type { ConversationDetail } from "../features/chat/types.ts";
import styles from "./Chat.module.css";

export function ChatPage() {
  const { id = "" } = useParams();
  // 页面自己维护消息副本，所以每次进入都取最新快照，不复用缓存
  const detail = useQuery({
    queryKey: ["conversation-detail", id],
    queryFn: () => api.get<ConversationDetail>(`/api/v1/conversations/${encodeURIComponent(id)}`),
    gcTime: 0,
    staleTime: Number.POSITIVE_INFINITY,
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 1,
  });

  if (detail.isPending) {
    return (
      <div className={styles.center}>
        <Spinner />
      </div>
    );
  }
  if (detail.isError) {
    const missing = detail.error instanceof ApiError && detail.error.status === 404;
    return (
      <EmptyState title={missing ? "这段对话不存在" : "对话加载失败"}>
        {missing ? (
          <Link to="/">回到首页</Link>
        ) : (
          <Button variant="primary" onClick={() => void detail.refetch()}>
            重试
          </Button>
        )}
      </EmptyState>
    );
  }
  // 导入简历后会刷新快照，换 key 让会话按新消息重建
  return <ChatView key={`${detail.data.id}:${detail.dataUpdatedAt}`} detail={detail.data} />;
}
