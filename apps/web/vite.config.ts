import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { "/api": process.env.API_ORIGIN ?? "http://localhost:8080" },
  },
});
