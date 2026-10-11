# database/migrations

Pointer only — this directory holds no migrations.

The canonical, hash-pinned Prisma migration history lives in
`packages/prowess-db/prisma/migrations/` (22 migrations through M3). Never add migrations here and never edit an
applied migration; see `docs/architecture/database.md` for the migration workflow and drift checking.
