/**
 * Recognizing a Postgres unique-constraint violation, independent of how the
 * Prisma runtime reports it.
 *
 * Why this exists: every duplicate-detector in this package used to read
 * `error.meta.target`. That field belongs to Prisma's classic query engine.
 * With Prisma 7's driver adapter (`@prisma/adapter-pg`, which this project
 * uses) it is ABSENT: the error is still code `P2002`, but it names the
 * violated CONSTRAINT instead — in its message ("Unique constraint failed on
 * the constraint: `entities_canonical_key_key`") and in
 * `meta.driverAdapterError.cause.constraint.index`. The old detectors
 * therefore never matched, and a duplicate escaped as a raw Prisma error
 * instead of a controlled DomainError (and the revision-allocation retry
 * never retried). Found by the first real CI run; the authoring sandbox
 * could not run Prisma.
 *
 * Matching is by constraint NAME (the names are fixed by the migrations and
 * pinned by tests/unit/prisma-errors.test.ts). The classic `meta.target`
 * column-list form is still honored when a matcher supplies `fields`.
 *
 * Duck-typed on purpose (no `instanceof`, no import of the generated
 * client): it is trivially unit-testable with plain objects shaped like the
 * errors seen in CI. Internal to @prowess/db — not exported from index.ts.
 */
export interface UniqueConstraintMatcher {
  /** The unique index/constraint name, exactly as created by the migration. */
  constraint: string;
  /** Classic-engine fallback: every one of these columns must be in `meta.target`. */
  fields?: readonly string[];
}

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

interface PrismaLikeError {
  code?: unknown;
  message?: unknown;
  meta?: {
    target?: unknown;
    driverAdapterError?: { cause?: { constraint?: { index?: unknown } } };
  };
}

export function isUniqueViolation(error: unknown, matcher: UniqueConstraintMatcher): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const e = error as PrismaLikeError;
  if (e.code !== "P2002") {
    return false;
  }

  const wanted = normalize(matcher.constraint);
  const named: string[] = [];

  // Driver-adapter form: the constraint name in the message...
  if (typeof e.message === "string") {
    const fromMessage = /constraint:\s*`([^`]+)`/.exec(e.message);
    if (fromMessage?.[1]) named.push(fromMessage[1]);
  }
  // ...and structured in meta.
  const index = e.meta?.driverAdapterError?.cause?.constraint?.index;
  if (typeof index === "string") named.push(index);
  // Classic engines sometimes put an index name in meta.target as a string.
  if (typeof e.meta?.target === "string") named.push(e.meta.target);

  if (named.some((candidate) => normalize(candidate) === wanted)) {
    return true;
  }

  // Classic-engine column list.
  const target = e.meta?.target;
  if (matcher.fields && matcher.fields.length > 0 && Array.isArray(target)) {
    const columns = target.map((column) => normalize(String(column)));
    return matcher.fields.every((field) => columns.includes(normalize(field)));
  }
  return false;
}
