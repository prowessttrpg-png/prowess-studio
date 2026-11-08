import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";

/** Test-worker compatibility only (M6-WO11 browser specs). The approved PostgreSQL test fixtures of @prowess/db import
 * the @prowess/game test worlds as JSON without Node's import attribute; inside the Playwright worker, load exactly
 * those test-world JSON files as inert JS literals. No application, pricing or production loader changes. */
registerHooks({
  load(url, context, nextLoad) {
    if (url.startsWith("file:") && url.includes("/packages/prowess-game/src/testing/") && url.endsWith(".json")) {
      const data: unknown = JSON.parse(readFileSync(new URL(url), "utf8"));
      return { format: "module", source: `export default ${JSON.stringify(data)};`, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
