import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  publicDir: "../../apps/web/public",
  resolve: { dedupe: ["react", "react-dom", "react-router", "@tanstack/react-query"] },
  server: {
    proxy: { "/api": process.env.API_ORIGIN ?? "http://localhost:8080" },
  },
});
