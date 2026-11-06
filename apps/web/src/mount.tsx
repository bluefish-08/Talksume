import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";

/** 注册完扩展点后调用。 */
export function mountApp(): void {
  const root = document.getElementById("root");
  if (!root) throw new Error("缺少 #root 挂载点");
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
