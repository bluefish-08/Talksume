import { linkClass } from "@talksume/web/components/Sidebar.tsx";
import { IconButton } from "@talksume/web/components/ui.tsx";
import type { WebExtensions } from "@talksume/web/extensions.ts";
import { Briefcase, LogOut, Mail, Settings } from "lucide-react";
import { NavLink, useNavigate } from "react-router";
import { RedirectIfAuthed, RequireAuth, RequireRole, UnauthorizedWatcher } from "./auth/AuthGate.tsx";
import { useLogout, useMe } from "./auth/api.ts";
import { AdminInvitationsPage } from "./pages/AdminInvitations.tsx";
import { ForgotPasswordPage } from "./pages/ForgotPassword.tsx";
import { InvitePage } from "./pages/Invite.tsx";
import { LoginPage } from "./pages/Login.tsx";
import { RegisterPage } from "./pages/Register.tsx";
import { ResetPasswordPage } from "./pages/ResetPassword.tsx";
import { SettingsPage } from "./pages/Settings.tsx";
import { VerifyEmailPage } from "./pages/VerifyEmail.tsx";
import { VerifyPendingPage } from "./pages/VerifyPending.tsx";

function SidebarLinks({ onNavigate }: { onNavigate?: (() => void) | undefined }) {
  const role = useMe().data?.role;
  return (
    <>
      <NavLink to="/settings" className={linkClass} onClick={onNavigate}>
        <Settings size={18} strokeWidth={1.6} aria-hidden="true" />
        账号设置
      </NavLink>
      {(role === "hr" || role === "admin") && (
        <NavLink to="/hr" className={linkClass} onClick={onNavigate}>
          <Briefcase size={18} strokeWidth={1.6} aria-hidden="true" />
          HR 工作台
        </NavLink>
      )}
      {role === "admin" && (
        <NavLink to="/admin/invitations" className={linkClass} onClick={onNavigate}>
          <Mail size={18} strokeWidth={1.6} aria-hidden="true" />
          HR 邀请
        </NavLink>
      )}
    </>
  );
}

function SidebarAccount() {
  const logout = useLogout();
  const navigate = useNavigate();
  return (
    <IconButton
      label="退出登录"
      onClick={() => logout.mutate(undefined, { onSuccess: () => navigate("/login", { replace: true }) })}
    >
      <LogOut size={16} strokeWidth={1.6} aria-hidden="true" />
    </IconButton>
  );
}

function useLogoutAction() {
  const logout = useLogout();
  return () => logout.mutate();
}

export const cloudExtensions: WebExtensions = {
  Provider: UnauthorizedWatcher,
  Gate: RequireAuth,
  publicRoutes: [
    {
      element: <RedirectIfAuthed />,
      children: [
        { path: "login", element: <LoginPage /> },
        { path: "register", element: <RegisterPage /> },
        { path: "forgot-password", element: <ForgotPasswordPage /> },
      ],
    },
    { path: "verify-email", element: <VerifyEmailPage /> },
    { path: "verify-pending", element: <VerifyPendingPage /> },
    { path: "reset-password", element: <ResetPasswordPage /> },
    { path: "invite", element: <InvitePage /> },
  ],
  shellRoutes: [
    { path: "settings", element: <SettingsPage /> },
    {
      path: "admin/invitations",
      element: (
        <RequireRole roles={["admin"]}>
          <AdminInvitationsPage />
        </RequireRole>
      ),
    },
  ],
  SidebarLinks,
  SidebarAccount,
  useAccount: () => useMe().data ?? null,
  useLogout: useLogoutAction,
};
