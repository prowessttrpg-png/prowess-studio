// Recreate package-local pnpm links at the prototype's final location.
import { existsSync, lstatSync, readFileSync, realpathSync, statSync, symlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function relativeInside(root, candidate) {
  const relative = path.relative(root, candidate);
  if (!relative || path.isAbsolute(relative) || relative.split(path.sep)[0] === "..") {
    throw new Error("Package path escapes its root: " + candidate);
  }
  return relative;
}

export function materializeLinks(directory, entries) {
  const root = realpathSync(directory);
  for (const [name, relativeTarget] of entries) {
    if (path.isAbsolute(name) || path.isAbsolute(relativeTarget)) throw new Error("Expected package-relative links.");
    const link = path.resolve(root, name);
    const target = path.resolve(root, relativeTarget);
    relativeInside(root, link);
    relativeInside(root, target);
    const parent = path.dirname(link);
    if (realpathSync(parent) !== parent || realpathSync(target) !== target) {
      throw new Error("Link endpoints must be staged physical paths: " + name);
    }
    if (existsSync(link)) {
      if (!lstatSync(link).isSymbolicLink() || realpathSync(link) !== target) {
        throw new Error("Unexpected existing package entry: " + name);
      }
      continue;
    }
    const isDirectory = statSync(target).isDirectory();
    const windowsJunction = process.platform === "win32" && isDirectory;
    symlinkSync(
      windowsJunction ? target : path.relative(parent, target),
      link,
      windowsJunction ? "junction" : isDirectory ? "dir" : "file",
    );
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = import.meta.dirname;
  materializeLinks(root, JSON.parse(readFileSync(path.join(root, "links.json"), "utf8")));
}
