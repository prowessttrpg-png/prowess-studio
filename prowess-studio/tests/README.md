# tests/

Reserved for cross-package integration and end-to-end suites that don't
belong to a single package/app (e.g. future rules-engine integration tests,
M1-WO11 historical reproducibility tests). As of M0-WO1:

- Package-local unit tests live beside their source
  (`packages/*/src/**/*.test.ts`, `apps/studio/tests/unit/`).
- The Playwright e2e suite lives in `apps/studio/tests/e2e/`.

This directory is currently empty by design.
