import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: { TALKSUME_DEV_AUTH: "1" },
    include: [
      "packages/*/src/**/*.test.ts",
      "cloud/*/src/**/*.test.ts",
      "apps/*/src/**/*.test.ts",
      "apps/*/src/**/*.test.tsx",
      "scripts/**/*.test.ts",
    ],
  },
});
