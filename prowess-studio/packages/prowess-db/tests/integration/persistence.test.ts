/**
 * Real Prisma-based database integration tests.
 *
 * Replaces the earlier BLOCKED placeholder (prisma-blocked.test.ts) now
 * that Prisma generation is unblocked — confirmed via the M0-WO3 Prisma
 * Verification Gate running in GitHub Actions, a genuine Prisma-capable
 * environment this sandbox is not. Covers the same proofs
 * packages/prowess-db/sandbox-verification/ proved via raw `pg` (now
 * removed); this is the permanent replacement, exercised entirely through
 * the centralized `prisma` client from src/client.ts — no raw SQL, no
 * second persistence implementation.
 *
 * Runs only against prowess_studio_test — see
 * tests/integration/setup.mjs (loads apps/studio/.env.test before this
 * file's top-level `import { prisma } ...` constructs the client) and the
 * assertRunningAgainstTestDatabase() guard in beforeAll below.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/index";
import {
  UnsafeTestDatabaseResetError,
  assertRunningAgainstTestDatabase,
  assertSafeToResetTestDatabase,
} from "../../src/testDatabaseGuard";
import { PrismaClient } from "../../generated/prisma/client";
import { getDevDatabaseUrl, getTestDatabaseUrl } from "./env";

const TEST_DATABASE_URL = getTestDatabaseUrl();
const DEV_DATABASE_URL = getDevDatabaseUrl();

/**
 * A separate, one-off client pointed at the DEVELOPMENT database, used
 * only to prove isolation (test 7 below). The shared `prisma` singleton
 * imported above is always pointed at whichever DATABASE_URL this process
 * started with (the test database — enforced by the beforeAll guard
 * below) and must never be repurposed mid-suite.
 */
let devOnlyClient: PrismaClient;

describe("Prisma database integration tests (prowess_studio_test only)", () => {
  beforeAll(() => {
    assertRunningAgainstTestDatabase(TEST_DATABASE_URL);
    devOnlyClient = new PrismaClient({
      adapter: new PrismaPg({ connectionString: DEV_DATABASE_URL }),
    });
  });

  afterAll(async () => {
    // Leave the probe table clean for the next run rather than
    // accumulating rows across repeated CI runs — safe because this
    // table is explicitly internal-only scratch data (see schema.prisma),
    // and the beforeAll guard above already confirmed we're on the test
    // database before any write in this file ever ran.
    await prisma.systemMigrationProbe.deleteMany({});
    await prisma.$disconnect();
    await devOnlyClient.$disconnect();
  });

  it("1. Connection: the test environment can connect to the isolated test database", async () => {
    const result = await prisma.$queryRaw<{ one: number }[]>`SELECT 1 AS one;`;
    expect(result[0]?.one).toBe(1);
  });

  it("2-5. Create, Read, Update, Delete", async () => {
    const created = await prisma.systemMigrationProbe.create({
      data: { label: "crud-probe" },
    });
    expect(created.label).toBe("crud-probe");

    const read = await prisma.systemMigrationProbe.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(read.label).toBe("crud-probe");

    const updated = await prisma.systemMigrationProbe.update({
      where: { id: created.id },
      data: { label: "crud-probe-updated" },
    });
    expect(updated.label).toBe("crud-probe-updated");

    await prisma.systemMigrationProbe.delete({ where: { id: created.id } });

    const afterDelete = await prisma.systemMigrationProbe.findUnique({
      where: { id: created.id },
    });
    expect(afterDelete).toBeNull();
  });

  it("6. Transaction commit: both writes persist", async () => {
    const [a, b] = await prisma.$transaction([
      prisma.systemMigrationProbe.create({ data: { label: "commit-a" } }),
      prisma.systemMigrationProbe.create({ data: { label: "commit-b" } }),
    ]);

    const found = await prisma.systemMigrationProbe.findMany({
      where: { id: { in: [a.id, b.id] } },
      orderBy: { label: "asc" },
    });
    expect(found.map((row) => row.label)).toEqual(["commit-a", "commit-b"]);
  });

  it("6b. Transaction rollback: deliberately throwing inside the transaction leaves no partial data", async () => {
    const uniqueLabel = "rollback-should-not-persist";
    let caught: unknown;

    try {
      await prisma.$transaction(async (tx) => {
        await tx.systemMigrationProbe.create({ data: { label: uniqueLabel } });
        throw new Error("deliberate failure before commit");
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    const found = await prisma.systemMigrationProbe.findFirst({
      where: { label: uniqueLabel },
    });
    expect(found).toBeNull();
  });

  it("7. Dev/test isolation: data written via the test client never appears in the development database", async () => {
    const uniqueLabel = `isolation-probe-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await prisma.systemMigrationProbe.create({ data: { label: uniqueLabel } });

    const inTest = await prisma.systemMigrationProbe.findFirst({ where: { label: uniqueLabel } });
    const inDev = await devOnlyClient.systemMigrationProbe.findFirst({
      where: { label: uniqueLabel },
    });

    expect(inTest).not.toBeNull();
    expect(inDev).toBeNull();
  });

  it("8. Safety guard: a destructive reset against a non-test database URL still fails", () => {
    expect(() =>
      assertSafeToResetTestDatabase({ databaseUrl: DEV_DATABASE_URL, explicitlyAllowed: true }),
    ).toThrow(UnsafeTestDatabaseResetError);

    // Positive control: the real test URL, with explicit confirmation, is
    // still accepted by the same guard.
    expect(() =>
      assertSafeToResetTestDatabase({ databaseUrl: TEST_DATABASE_URL, explicitlyAllowed: true }),
    ).not.toThrow();
  });
});
