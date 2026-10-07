"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, type ReactNode } from "react";
import type { RulesetDto } from "../../../../src/api-client";
import { Crumbs, IdLine, StatusBadge } from "./primitives";

export const SECTIONS = [
  { slug: "", label: "Overview" },
  { slug: "manifests", label: "Manifests" },
  { slug: "policies", label: "Canon Policy" },
  { slug: "conflicts", label: "Conflicts" },
  { slug: "decisions", label: "Decisions" },
  { slug: "change-sets", label: "ChangeSets" },
  { slug: "releases", label: "Releases" },
] as const;

interface WorkspaceValue {
  ruleset: RulesetDto;
  reloadRuleset: () => void;
}
export const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function useWorkspace(): WorkspaceValue {
  const value = useContext(WorkspaceContext);
  if (value === null) throw new Error("useWorkspace must be used inside the Ruleset workspace");
  return value;
}

export const sectionHref = (rulesetId: string, slug: string, id?: string) =>
  `/developer/rulesets/${rulesetId}${slug ? `/${slug}` : ""}${id ? `/${id}` : ""}`;

/** Section tabs: a nav of links (keyboard-native), horizontally scrollable on narrow screens (§3, §55, §57). */
export function WorkspaceTabs({ rulesetId }: { rulesetId: string }) {
  const pathname = usePathname();
  const base = sectionHref(rulesetId, "");
  return (
    <nav aria-label="Ruleset sections" className="gov-tabs">
      <ul>
        {SECTIONS.map((s) => {
          const href = sectionHref(rulesetId, s.slug);
          const active = s.slug === "" ? pathname === base : pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={s.slug || "overview"}>
              <Link href={href} aria-current={active ? "page" : undefined} data-active={active}>
                {s.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function WorkspaceHeader({ ruleset }: { ruleset: RulesetDto }) {
  return (
    <header className="gov-workspace__header">
      <p className="gov-eyebrow">Ruleset workspace</p>
      <h1>{ruleset.name}</h1>
      <p className="gov-meta">
        <StatusBadge value={ruleset.status} kind="ruleset-status" /> <StatusBadge value={ruleset.channel} kind="channel" /> <code>{ruleset.canonicalKey}</code>
      </p>
      <IdLine label="Ruleset ID" id={ruleset.id} />
    </header>
  );
}

/** Breadcrumbs for a page inside the workspace (§48). */
export function SectionCrumbs({ section, record }: { section?: { label: string; slug: string }; record?: string }) {
  const { ruleset } = useWorkspace();
  const items: Array<{ label: string; href?: string }> = [
    { label: "Developer", href: "/developer" },
    { label: "Rulesets", href: "/developer/rulesets" },
    { label: ruleset.name, href: sectionHref(ruleset.id, "") },
  ];
  if (section) items.push({ label: section.label, href: sectionHref(ruleset.id, section.slug) });
  if (record) items.push({ label: record });
  return <Crumbs items={items} />;
}

export function SectionHeading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="gov-section-heading">
      <h2>{title}</h2>
      {children}
    </div>
  );
}
