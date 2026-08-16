import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Without this, vitest cannot resolve the `@/*` alias that nearly every service file
 * uses (tsconfig.json defines it for Next's bundler, but vitest doesn't read tsconfig
 * paths on its own). Before this file existed, any test importing service-layer code
 * failed at collection with "Failed to load url @/..." — silently blocking TDD on the
 * one layer CLAUDE.md says all business logic must live in.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
