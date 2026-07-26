import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["server/**/*.test.ts", "shared/**/*.test.ts"],
    // rebuild() runs on every write and sharp decodes real images.
    testTimeout: 20_000,
  },
});
