import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, RouterProvider } from "react-router";
import { AppShell } from "./components/AppShell.tsx";
import { ToastProvider } from "./components/Toast.tsx";
import { ApplicationsPage } from "./pages/Applications.tsx";
import { ChatPage } from "./pages/Chat.tsx";
import { HomePage } from "./pages/Home.tsx";
import { HrPage } from "./pages/Hr.tsx";
import { JobsPage } from "./pages/Jobs.tsx";
import { ResumePage } from "./pages/Resume.tsx";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 } },
});

const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "c/:id", element: <ChatPage /> },
      { path: "resume", element: <ResumePage /> },
      { path: "jobs", element: <JobsPage /> },
      { path: "applications", element: <ApplicationsPage /> },
    ],
  },
  { path: "hr", element: <HrPage /> },
]);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  );
}
