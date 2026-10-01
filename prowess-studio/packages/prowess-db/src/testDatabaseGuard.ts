/**
 * Guards against ever running a destructive operation (a full reset) or a
 * write-bearing integration test suite against anything other than the
 * clearly-isolated test database.
 *
 * Deliberately does NOT rely on `NODE_ENV` alone — a misconfigured
 * `NODE_ENV` (or a `DATABASE_URL` that got overridden some other way)
 * should not be enough, by itself, to let a destructive command through.
 * Instead this checks three independent things about the *actual resolved*
 * connection string, and requires ALL of them:
 *
 *   1. The host is a recognized local/test host (localhost/127.0.0.1/::1) —
 *      a remote or shared database is refused outright, regardless of its
 *      name.
 *   2. The database name ends with `_test` — matches the project's naming
 *      convention (`prowess_studio_test`).
 *   3. `explicitlyAllowed` is `true` — passed in by the caller, not read
 *      from any committed `.env` file. The one vetted entrypoint for a
 *      full reset (`db:reset:test`, see
 *      packages/prowess-db/scripts/reset-test-db.mjs) sets this itself,
 *      right before calling this guard — never as an ambient environment
 *      default. This is what makes the flag meaningful: an accidental or
 *      unrelated invocation won't have it set, only a deliberate run
 *      through the reviewed reset path will.
 */
export class UnsafeTestDatabaseResetError extends Error {
  constructor(problems: readonly string[]) {
    super(
      `Refusing to run a destructive operation against what is not clearly the isolated test database:\n${problems
        .map((problem) => `  - ${problem}`)
        .join("\n")}`,
    );
    this.name = "UnsafeTestDatabaseResetError";
  }
}

const ALLOWED_LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function parseDatabaseUrl(databaseUrl: string): URL {
  try {
    return new URL(databaseUrl);
  } catch {
    throw new UnsafeTestDatabaseResetError([
      "DATABASE_URL could not be parsed as a valid connection URL",
    ]);
  }
}

export interface TestDatabaseGuardOptions {
  databaseUrl: string;
  /**
   * Must be computed and passed as `true` by the caller, immediately
   * before the destructive operation — never sourced from a committed
   * `.env` file. See the class doc above for why.
   */
  explicitlyAllowed: boolean;
}

/**
 * The strict guard: all three checks must pass, or this throws
 * {@link UnsafeTestDatabaseResetError}. Use this immediately before any
 * genuinely destructive operation (a full `prisma migrate reset`, a
 * `TRUNCATE`, a `DROP`).
 */
export function assertSafeToResetTestDatabase({
  databaseUrl,
  explicitlyAllowed,
}: TestDatabaseGuardOptions): void {
  const parsed = parseDatabaseUrl(databaseUrl);
  const host = parsed.hostname;
  const databaseName = parsed.pathname.replace(/^\//, "");
  const problems: string[] = [];

  if (!ALLOWED_LOCAL_HOSTS.has(host)) {
    problems.push(
      `host "${host}" is not a recognized local/test host (expected one of: ${[...ALLOWED_LOCAL_HOSTS].join(", ")})`,
    );
  }

  if (!databaseName.endsWith("_test")) {
    problems.push(`database name "${databaseName}" does not end with "_test"`);
  }

  if (!explicitlyAllowed) {
    problems.push("explicit confirmation was not given (explicitlyAllowed was not true)");
  }

  if (problems.length > 0) {
    throw new UnsafeTestDatabaseResetError(problems);
  }
}

/**
 * The lighter guard: checks host + database name only (no explicit-flag
 * requirement). Intended as a `beforeAll` sanity check at the top of every
 * database integration test file, so a misconfigured `DATABASE_URL` fails
 * the suite immediately and loudly rather than silently writing
 * probe/test data into the wrong database.
 */
export function assertRunningAgainstTestDatabase(databaseUrl: string): void {
  const parsed = parseDatabaseUrl(databaseUrl);
  const host = parsed.hostname;
  const databaseName = parsed.pathname.replace(/^\//, "");
  const problems: string[] = [];

  if (!ALLOWED_LOCAL_HOSTS.has(host)) {
    problems.push(
      `host "${host}" is not a recognized local/test host (expected one of: ${[...ALLOWED_LOCAL_HOSTS].join(", ")})`,
    );
  }
  if (!databaseName.endsWith("_test")) {
    problems.push(`database name "${databaseName}" does not end with "_test"`);
  }

  if (problems.length > 0) {
    throw new UnsafeTestDatabaseResetError(problems);
  }
}
