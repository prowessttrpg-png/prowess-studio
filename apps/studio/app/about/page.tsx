import Link from "next/link";
import studioPackage from "../../package.json";
import { buildIdentity } from "./build-identity";
import { EditorCoverage } from "./EditorCoverage";

export const dynamic = "force-dynamic";

/**
 * /about — RULES-WO1 "About this build". Shows exactly which build is running: the app version, and — for an installed
 * desktop package — the source commit and tree the installer was built from (passed by the desktop controller from the
 * signed prototype manifest), so two installs that both say the same version can be told apart. It also lists, from
 * this build's own code, which Definition kinds have a guided game-language editor and which still fall back to the
 * technical editor. Read-only; nothing is fetched from the network.
 */
export default function AboutPage() {
  const id = buildIdentity(process.env, studioPackage.version);
  return (
    <section className="prowess-reference" data-testid="about-build">
      <h1>About this build</h1>
      <dl className="gov-dl" data-testid="about-identity">
        <dt>Version</dt>
        <dd data-testid="about-version">{id.version}</dd>
        <dt>Kind of build</dt>
        <dd data-testid="about-mode">{id.mode === "DESKTOP" ? "Installed desktop app" : "Development or server build"}</dd>
        <dt>Source commit</dt>
        <dd>{id.commit === null ? <span className="gov-muted">Not recorded for this build</span> : <code data-testid="about-commit">{id.commit}</code>}</dd>
        <dt>Source tree</dt>
        <dd>{id.tree === null ? <span className="gov-muted">Not recorded for this build</span> : <code data-testid="about-tree">{id.tree}</code>}</dd>
        <dt>Package fingerprint</dt>
        <dd>{id.packageSha256 === null ? <span className="gov-muted">Not recorded for this build</span> : <code>{id.packageSha256}</code>}</dd>
      </dl>
      <p className="gov-muted">When reporting a problem, include the version and the source commit. Two installs with the same version can still be different builds; the commit tells them apart.</p>

      <h2>Editors in this build</h2>
      <EditorCoverage />
      <p>
        <Link href="/compendium/admin">Compendium authoring</Link>
      </p>
    </section>
  );
}
