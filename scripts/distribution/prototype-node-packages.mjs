import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { relativeInside } from "./prototype-links.mjs";

// Preserve both the installed package directories and the pnpm links used to find them.
export function collectNodePackages(repository, importer, rootPackage) {
  const entries = new Set();
  const visited = new Set();

  function visit(from, name, optional = false) {
    const resolver = createRequire(path.join(from, "package.json"));
    const entry = resolver.resolve.paths(name).map((directory) => path.join(directory, name)).find((candidate) => {
      const relative = path.relative(repository, candidate);
      return !path.isAbsolute(relative) && relative.split(path.sep)[0] !== ".." &&
        existsSync(path.join(candidate, "package.json"));
    });
    if (!entry) {
      if (optional) return;
      throw new Error("Missing required installed package " + name + " from " + from);
    }
    const directory = realpathSync(entry);
    relativeInside(repository, directory);
    entries.add(entry);
    entries.add(directory);
    if (visited.has(directory)) return;
    visited.add(directory);

    const { dependencies = {}, optionalDependencies = {}, peerDependencies = {}, peerDependenciesMeta = {} } =
      JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8"));
    for (const dependency of Object.keys({ ...dependencies, ...optionalDependencies, ...peerDependencies })) {
      const mayBeMissing = Object.hasOwn(optionalDependencies, dependency) ||
        (!Object.hasOwn(dependencies, dependency) && peerDependenciesMeta[dependency]?.optional === true);
      visit(directory, dependency, mayBeMissing);
    }
  }

  visit(importer, rootPackage);
  return entries;
}
