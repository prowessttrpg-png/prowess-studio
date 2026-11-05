import { assertRunningAgainstTestDatabase } from "./testDatabaseGuard.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

/**
 * A single, centralized PrismaClient instance for the whole application.
 *
 * WHY A DRIVER ADAPTER (do not construct `new PrismaClient()` with no
 * arguments — Prisma 7 rejects that at runtime): as of Prisma 7, the
 * generated Client no longer manages its own database connection
 * internally for any database — it always delegates that to a JS driver
 * adapter you supply. For PostgreSQL that's `@prisma/adapter-pg`, built on
 * the `pg` driver. This is Prisma's own required architecture in v7, not a
 * project-specific choice, and not a replacement of Prisma by `pg` — `pg`
 * here is a low-level connection driver Prisma's adapter uses internally;
 * all schema definition, migrations, and query generation remain Prisma's.
 * Compare this to packages/prowess-db/sandbox-verification/, which uses
 * `pg` directly with no Prisma involved at all — a different, temporary,
 * unrelated use.
 *
 * WHY A SINGLETON (do not construct more than one, anywhere): each
 * PrismaClient (and the connection pool its adapter owns) is meant to be
 * created once per process. Next.js's dev server hot-reloads modules on
 * every file save; without this guard, every reload would construct a
 * brand-new PrismaClient — and therefore a brand-new connection pool —
 * while the previous one silently leaks, eventually exhausting
 * PostgreSQL's max_connections. Caching the instance on `globalThis`
 * survives module reloads in dev (the global itself is not reset by HMR)
 * while still being a plain, ordinary singleton in production and in
 * tests (where there is no HMR to guard against, but a single shared
 * instance is still correct and cheaper).
 *
 * No route, page, or component should import `PrismaClient` or
 * `@prisma/adapter-pg` directly, or construct its own instance — always
 * import `prisma` from here (or from `@prowess/db`'s package entry point).
 */
declare global {
  var __prowessPrismaClient: PrismaClient | undefined;
}

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set — cannot construct the Prisma client. " +
        "See apps/studio/src/config (M0-WO2) for where this should come from.",
    );
  }
  const adapter = new PrismaPg({ connectionString });
  // M6-WO8 local verification: emulated PostgreSQL can exceed Prisma's default 2-second transaction startup.
  // Native CI and production retain their existing defaults. An explicit override is accepted only for a guarded
  // local *_test database, including a production-mode E2E server. It changes waiting time,
  // never isolation, locking, queries, rules or database integrity checks.
  const rawTimeout = process.env.PROWESS_TEST_TRANSACTION_TIMEOUT_MS;
  let transactionOptions: { maxWait: number; timeout: number } | undefined;
  if (rawTimeout !== undefined) {
    assertRunningAgainstTestDatabase(connectionString);
    const milliseconds = Number(rawTimeout);
    if (!Number.isSafeInteger(milliseconds) || milliseconds < 1 || milliseconds > 120_000) throw new Error("PROWESS_TEST_TRANSACTION_TIMEOUT_MS must be an integer from 1 to 120000");
    transactionOptions = { maxWait: milliseconds, timeout: milliseconds };
  }
  return new PrismaClient({ adapter, ...(transactionOptions ? { transactionOptions } : {}) });
}

export const prisma: PrismaClient = globalThis.__prowessPrismaClient ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__prowessPrismaClient = prisma;
}
