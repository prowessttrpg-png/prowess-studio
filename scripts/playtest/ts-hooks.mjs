// Developer-only Node module hooks for the M6-WO12 playtest preparation (never imported by the application or tests).
// The approved PostgreSQL test fixtures are TypeScript sources that import (a) sibling modules by ".js" or extensionless
// specifiers that exist as ".ts", and (b) JSON test worlds without an import attribute. Node runs the TypeScript with
// --experimental-transform-types; these hooks only map those two specifier forms. Nothing else is changed.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  if (/^\.{1,2}\//.test(specifier) && context.parentURL?.startsWith("file:")) {
    const base = new URL(specifier, context.parentURL);
    const path = fileURLToPath(base);
    const candidates = path.endsWith(".js") ? [path.slice(0, -3) + ".ts"] : /\.[a-z]+$/i.test(path) ? [] : [path + ".ts", path + ".js", path + "/index.ts"];
    for (const c of candidates) if (existsSync(c)) return nextResolve(new URL(`file://${c}`).href, context);
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.startsWith("file:") && url.endsWith(".json")) {
    return { format: "module", source: `export default ${readFileSync(new URL(url), "utf8")};`, shortCircuit: true };
  }
  return nextLoad(url, context);
}
