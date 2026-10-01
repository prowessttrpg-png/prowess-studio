import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";

// See packages/prowess-ui/vitest.setup.ts for why this is needed — this
// project doesn't enable vitest's `globals: true`, so Testing Library's
// own auto-cleanup never registers.
afterEach(cleanup);
