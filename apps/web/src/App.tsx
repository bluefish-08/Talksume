import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { createBrowserRouter, Outlet, RouterProvider } from "react-router";
import { AppShell } from "./components/AppShell.tsx";
import { ToastProvider } from "./components/Toast.tsx";
import { getExtensions, type WebExtensions } from "./extensions.ts";
import { ApplicationsPage } from "./pages/Applications.tsx";
import { ChatPage } from "./pages/Chat.tsx";
import { HomePage } from "./pages/Home.tsx";
import { HrPage } from "./pages/Hr.tsx";
import { JobsPage } from "./pages/Jobs.tsx";
import { ResumePage } from "./pages/Resume.tsx";
import { TailorPage } from "./pages/Tailor.tsx";

function PassGate() {
  return <Outlet />;
}

function Passthrough({ children }: { children: ReactNode }) {
  return children;
}

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 } },
});

function buildRouter(ext: WebExtensions) {
  const Gate = ext.Gate ?? PassGate;
  return createBrowserRouter([
    ...(ext.publicRoutes ?? []),
    {
      element: <Gate />,
      children: [
        {
          element: <AppShell />,
          children: [
            { index: true, element: <HomePage /> },
            { path: "c/:id", element: <ChatPage /> },
            { path: "resume", element: <ResumePage /> },
            { path: "jobs", element: <JobsPage /> },
            { path: "applications", element: <ApplicationsPage /> },
            { path: "tailor/:jobId", element: <TailorPage /> },
            ...(ext.shellRoutes ?? []),
          ],
        },
      ],
    },
    { element: <Gate roles={["hr", "admin"]} />, children: [{ path: "hr", element: <HrPage /> }] },
  ]);
}

export function App() {
  const ext = getExtensions();
  const [router] = useState(() => buildRouter(ext));
  const Provider = ext.Provider ?? Passthrough;
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <Provider>
          <RouterProvider router={router} />
        </Provider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
