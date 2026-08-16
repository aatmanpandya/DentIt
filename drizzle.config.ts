import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/server/db/schema/index.ts",
  out: "./src/server/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://dentit:dentit_dev@localhost:55432/dentit",
  },
});
