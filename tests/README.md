# tests/

Orientation only — every suite lives beside the code it tests. The current test layers:

| Layer | Location | Notes |
| --- | --- | --- |
| Package unit tests | `packages/*/src/**/*.test.ts`, `packages/prowess-db/tests/unit/` | Vitest; no database |
| Studio unit / component tests and static audit gates | `apps/studio/tests/unit/` | Vitest + Testing Library; includes the M1–M3 static audits (route inventories, layering, migration pins, invariant coverage) |
| Database integration | `packages/prowess-db/tests/integration/` | real PostgreSQL (`prowess_studio_test` only, guarded); includes the M1 / M2 / M3 audit and Golden lifecycle suites |
| API integration | `apps/studio/tests/integration/` | the real Next.js route handlers against PostgreSQL |
| End-to-end | `apps/studio/tests/e2e/` | Playwright, including mobile layouts |
| Migrations / drift | CI | migration chain from an empty database and a blocking Prisma drift check |

See `docs/architecture/ci.md` for how CI runs each layer.
