import { describe, expect, it } from "vitest";
import {
  UnsafeTestDatabaseResetError,
  assertRunningAgainstTestDatabase,
  assertSafeToResetTestDatabase,
} from "../../src/testDatabaseGuard";

const TEST_URL = "postgresql://postgres:postgres@localhost:5432/prowess_studio_test";
const DEV_URL = "postgresql://postgres:postgres@localhost:5432/prowess_studio_dev";
const REMOTE_TEST_NAMED_URL = "postgresql://postgres:postgres@db.example.com:5432/prowess_studio_test";

describe("assertSafeToResetTestDatabase", () => {
  it("passes for the real local test database URL with explicit confirmation", () => {
    expect(() =>
      assertSafeToResetTestDatabase({ databaseUrl: TEST_URL, explicitlyAllowed: true }),
    ).not.toThrow();
  });

  it("rejects the development database URL outright, even with explicit confirmation", () => {
    expect(() =>
      assertSafeToResetTestDatabase({ databaseUrl: DEV_URL, explicitlyAllowed: true }),
    ).toThrow(UnsafeTestDatabaseResetError);
  });

  it("rejects when explicit confirmation is not given, even against the real test URL", () => {
    expect(() =>
      assertSafeToResetTestDatabase({ databaseUrl: TEST_URL, explicitlyAllowed: false }),
    ).toThrow(UnsafeTestDatabaseResetError);
  });

  it("rejects a remote host even if the database name ends with _test", () => {
    expect(() =>
      assertSafeToResetTestDatabase({ databaseUrl: REMOTE_TEST_NAMED_URL, explicitlyAllowed: true }),
    ).toThrow(UnsafeTestDatabaseResetError);
  });

  it("rejects an unparseable connection string", () => {
    expect(() =>
      assertSafeToResetTestDatabase({ databaseUrl: "not-a-url", explicitlyAllowed: true }),
    ).toThrow(UnsafeTestDatabaseResetError);
  });

  it("reports every failing check, not just the first", () => {
    try {
      assertSafeToResetTestDatabase({ databaseUrl: REMOTE_TEST_NAMED_URL.replace("_test", "_prod"), explicitlyAllowed: false });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(UnsafeTestDatabaseResetError);
      const message = (error as UnsafeTestDatabaseResetError).message;
      // remote host + wrong name + no explicit flag = 3 problems
      expect(message).toContain("not a recognized local/test host");
      expect(message).toContain('does not end with "_test"');
      expect(message).toContain("explicit confirmation was not given");
    }
  });
});

describe("assertRunningAgainstTestDatabase (lighter guard, no explicit-flag requirement)", () => {
  it("passes for the real local test database URL", () => {
    expect(() => assertRunningAgainstTestDatabase(TEST_URL)).not.toThrow();
  });

  it("rejects the development database URL", () => {
    expect(() => assertRunningAgainstTestDatabase(DEV_URL)).toThrow(UnsafeTestDatabaseResetError);
  });

  it("rejects a remote test-named host", () => {
    expect(() => assertRunningAgainstTestDatabase(REMOTE_TEST_NAMED_URL)).toThrow(
      UnsafeTestDatabaseResetError,
    );
  });
});
