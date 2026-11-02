import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "cloud/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts"],
  },
});
