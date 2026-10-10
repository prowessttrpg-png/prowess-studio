import Link from "next/link";

/** Developer landing (PAS-10 M2-WO10 §89): links into the Ruleset / Canon governance workspace. */
export default function DeveloperPage() {
  return (
    <section>
      <h1>Developer</h1>
      <ul className="gov-list" aria-label="Developer tools">
        <li className="gov-card">
          <h2 className="gov-card__title">
            <Link href="/developer/rulesets">Rulesets &amp; Canon Manager</Link>
          </h2>
          <p>Ruleset governance: manifests, Canon policies, rule conflicts, decisions, ChangeSets, impact review and immutable releases.</p>
        </li>
        <li className="gov-card">
          <h2 className="gov-card__title">
            <Link href="/developer/import">Import Studio</Link>
          </h2>
          <p>Registered source snapshots, structure inspection, Import Batches, extraction, matching evidence and explicit import review. Approved for Import is not Canon.</p>
        </li>
        <li className="gov-card">
          <h2 className="gov-card__title">Rules Inspector, Tests</h2>
          <p>Placeholder — calculation traces and test tooling arrive in later milestones.</p>
        </li>
      </ul>
    </section>
  );
}
