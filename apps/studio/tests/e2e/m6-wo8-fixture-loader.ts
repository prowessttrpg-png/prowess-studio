import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";

/** Test-worker compatibility only. Existing approved game fixtures import their JSON content without Node's
 * native import attribute. Keep those historical files unchanged; load only that exact fixture-content directory
 * as inert JS JSON literals inside the Playwright Node worker. No application, pricing or production loader changes. */
registerHooks({
  load(url, context, nextLoad) {
    if (url.startsWith("file:") && url.includes("/packages/prowess-game/src/content/core-playtest-v0.1/") && url.endsWith(".json")) {
      const data: unknown = JSON.parse(readFileSync(new URL(url), "utf8"));
      return { format: "module", source: `export default ${JSON.stringify(data)};`, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
