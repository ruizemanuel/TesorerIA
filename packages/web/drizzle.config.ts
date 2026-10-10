import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  // Only `db:migrate` against Neon uses it (Task 15), with the direct, unpooled URL.
  dbCredentials: { url: process.env.DATABASE_URL_UNPOOLED ?? "" },
});
