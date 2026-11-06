import { api } from "@talksume/web/api/client.ts";
import { Button, Spinner } from "@talksume/web/components/ui.tsx";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router";
import styles from "../auth/Auth.module.css";
import { AuthPage, FormError } from "../auth/AuthCard.tsx";
import { meKey, useMe } from "../auth/api.ts";

export function InvitePage() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const peek = useQuery({
    queryKey: ["invite-peek", token],
    enabled: !!token,
    retry: false,
    queryFn: () =>
      api.get<{ email: string | null }>(
        `/api/v1/auth/invitations/peek?token=${encodeURIComponent(token ?? "")}`,
      ),
  });
  const accept = useMutation({
    mutationFn: () => api.post("/api/v1/auth/invitations/accept", { token }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: meKey });
      navigate("/hr", { replace: true });
    },
  });

  if (!token || peek.isError) {
    return (
      <AuthPage title="邀请已失效" lead="这个邀请链接无效、已被使用、已被撤销或已过期。">
        <p>请联系管理员重新生成邀请链接。</p>
        <Link to="/">回到首页</Link>
      </AuthPage>
    );
  }
  if (peek.isPending || me.isPending) {
    return (
      <AuthPage title="正在检查邀请…">
        <Spinner />
      </AuthPage>
    );
  }

  const here = `/invite?token=${encodeURIComponent(token)}`;
  const user = me.data;

  return (
    <AuthPage title="HR 邀请" lead="接受邀请后，你的账号可以发布岗位、处理候选人的投递。">
      {peek.data.email && <p className={styles.notice}>这个邀请仅限 {peek.data.email} 使用。</p>}
      {user?.emailVerified ? (
        <>
          <p>
            当前账号：<strong>{user.email}</strong>
          </p>
          <FormError error={accept.error} />
          <Button variant="dark" size="lg" disabled={accept.isPending} onClick={() => accept.mutate()}>
            {accept.isPending ? "处理中…" : "接受邀请，成为 HR"}
          </Button>
        </>
      ) : (
        <>
          <Button
            variant="dark"
            size="lg"
            className={styles.fill}
            onClick={() => navigate(`/register?invite=${encodeURIComponent(token)}`)}
          >
            用这个邀请注册新账号
          </Button>
          <div className={styles.footer}>
            <Link to={`/login?next=${encodeURIComponent(here)}`}>已有账号？登录后接受</Link>
          </div>
        </>
      )}
    </AuthPage>
  );
}
