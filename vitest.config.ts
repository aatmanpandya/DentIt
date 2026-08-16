import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import path from "node:path";

/**
 * Vitest doesn't load .env.local the way `next dev` does — DB-backed tests silently
 * fell back to postgres' default connection (the OS user, no password) whenever a
 * fresh shell hadn't sourced .env.local first. Real env vars (CI sets DATABASE_URL etc.
 * directly) still win; this only fills in what's missing.
 */
const fileEnv = loadEnv("", process.cwd(), "");
for (const [key, value] of Object.entries(fileEnv)) {
  if (process.env[key] === undefined) process.env[key] = value;
}

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
