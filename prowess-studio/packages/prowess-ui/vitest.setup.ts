import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";

// @testing-library/react only auto-registers its own afterEach(cleanup)
// when it detects global test hooks (vitest's `globals: true`), which this
// project deliberately doesn't enable (tests import describe/it/etc.
// explicitly from "vitest"). Without this, DOM trees from earlier tests in
// the same file persist and can collide with later queries.
afterEach(cleanup);
