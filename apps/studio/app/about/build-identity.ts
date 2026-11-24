import { descriptorFor, GENERIC_DESCRIPTOR } from "../compendium/admin/_lib/descriptors";

/** RULES-WO1: the identity of the running build, from the environment the desktop controller sets (never guessed). */
export interface BuildIdentity {
  readonly version: string;
  readonly mode: "DESKTOP" | "OTHER";
  readonly commit: string | null;
  readonly tree: string | null;
  readonly packageSha256: string | null;
}

const hex = (v: string | undefined, length: number) => (typeof v === "string" && new RegExp(`^[0-9a-f]{${length}}$`).test(v) ? v : null);

export function buildIdentity(env: Readonly<Record<string, string | undefined>>, packageVersion: string): BuildIdentity {
  const version = typeof env.PROWESS_APP_VERSION === "string" && /^\d+\.\d+\.\d+$/.test(env.PROWESS_APP_VERSION) ? env.PROWESS_APP_VERSION : packageVersion;
  return {
    version,
    mode: env.PROWESS_DESKTOP_MODE === "true" ? "DESKTOP" : "OTHER",
    commit: hex(env.PROWESS_BUILD_COMMIT, 40),
    tree: hex(env.PROWESS_BUILD_TREE, 40),
    packageSha256: hex(env.PROWESS_PACKAGE_SHA256, 64),
  };
}

/** Which authorable Definition kinds this build edits with a guided descriptor, from the code itself. */
export function guidedEditorCoverage(kinds: ReadonlyArray<{ definitionKind: string; sharedContract: string | null; authorable: boolean; authoringSchemaVersion: number | null }>): { guided: string[]; technical: string[] } {
  const guided: string[] = [];
  const technical: string[] = [];
  for (const kind of kinds) {
    if (!kind.authorable) continue;
    (descriptorFor(kind, kind.authoringSchemaVersion) === GENERIC_DESCRIPTOR ? technical : guided).push(kind.definitionKind);
  }
  return { guided, technical };
}
