// Prisma 7 configuration file.
//
// Prisma 7 removed the `datasource { url = ... }` field from schema.prisma
// entirely — connection URLs for Migrate now live here instead (see
// docs/architecture/database.md's "Prisma 7 config-file migration" note,
// and https://pris.ly/d/config-datasource).
//
// `engine: "classic"` is actually the default, but is set explicitly here
// to avoid any ambiguity with Prisma 7's other two engine modes (a driver
// adapter, or Prisma Accelerate) — this project uses neither. The
// generated Prisma Client still talks to PostgreSQL the same way it always
// has; only *how the CLI itself learns the connection string* changed.
//
// DATABASE_URL is expected to already be present in `process.env` by the
// time this file loads — populated by scripts/with-env.mjs (which every
// db:* root script runs first) exactly as before. This file does not load
// any .env file itself, to avoid a second, possibly-divergent source of
// truth for which .env file gets read.
import path from "node:path";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  engine: "classic",
  datasource: {
    url: env("DATABASE_URL"),
  },
  schema: path.join("prisma", "schema.prisma"),
});
