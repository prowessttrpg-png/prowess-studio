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
          <h2 className="gov-card__title">Rules Inspector, Sources, Tests</h2>
          <p>Placeholder — calculation traces, source review and test tooling arrive in later milestones.</p>
        </li>
      </ul>
    </section>
  );
}
