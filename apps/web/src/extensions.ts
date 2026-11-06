import type { ComponentType, ReactNode } from "react";
import type { RouteObject } from "react-router";

export interface WebAccount {
  id: string;
  email: string;
  displayName: string | null;
  role: string;
}

/** 部署版（比如云端）在启动时注册的扩展点；默认全空，本地版直接进应用。 */
export interface WebExtensions {
  /** 包在整个应用外面，放登录态监听这类全局逻辑。 */
  Provider?: ComponentType<{ children: ReactNode }>;
  /** 不带侧边栏、不要求登录的页面，比如登录、注册。 */
  publicRoutes?: RouteObject[];
  /** 业务页面的登录门：放行时渲染 <Outlet />，否则重定向；roles 给需要角色的页面。 */
  Gate?: ComponentType<{ roles?: readonly string[] }>;
  /** 带侧边栏、过登录门的额外页面。 */
  shellRoutes?: RouteObject[];
  /** 侧边栏底部额外的导航项。 */
  SidebarLinks?: ComponentType<{ onNavigate?: (() => void) | undefined }>;
  /** 侧边栏账号区里额外的控件，比如退出按钮。 */
  SidebarAccount?: ComponentType;
  /** 当前登录账号；没有登录系统时不用提供。 */
  useAccount?: () => WebAccount | null;
  /** 退出登录；HR 页的头部用它。 */
  useLogout?: () => () => void;
}

let current: WebExtensions = {};

export function registerExtensions(next: WebExtensions): void {
  current = next;
}

export function getExtensions(): WebExtensions {
  return current;
}
