"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CharacterApiError, getManeuver, rebuildManeuver, retireManeuver } from "../../_lib/character-client";
import type { ManeuverDetailDto } from "../../_lib/maneuver-types";
import { ManeuverReview, ManeuverState } from "./ManeuverReview";
import { shownManeuver } from "../../_lib/maneuver-format";
import { useRouter } from "next/navigation";

export function ManeuverDetail({ characterId, maneuverId }: { characterId: string; maneuverId: string }) {
  const router = useRouter();
  const [data, setData] = useState<ManeuverDetailDto | null>(null), [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const load = useCallback(async () => { try { setData(await getManeuver(characterId, maneuverId)); } catch (e) { setError(e instanceof CharacterApiError ? `${e.message} (${e.code})` : "Could not load this Maneuver."); } }, [characterId, maneuverId]);
  useEffect(() => { void load(); }, [load]); // eslint-disable-line react-hooks/set-state-in-effect -- fetch on mount
  if (!data) return <p role={error ? "alert" : "status"}>{error ?? "Loading Maneuver…"}</p>;
  const base = `/characters/${encodeURIComponent(characterId)}/maneuvers/${encodeURIComponent(maneuverId)}`;
  const shown = shownManeuver(data.maneuver);
  const command = async (action: "rebuild" | "retire") => {
    setBusy(true); setError(null);
    try {
      if (action === "rebuild") { await rebuildManeuver(characterId, maneuverId, data.maneuver.lockVersion); router.push(`${base}/edit`); }
      else { await retireManeuver(characterId, maneuverId, data.maneuver.lockVersion); await load(); }
    } catch (e) { setError(e instanceof CharacterApiError ? `${e.message} (${e.code}) — reload before retrying` : "The lifecycle request failed."); }
    finally { setBusy(false); }
  };
  return <article className="prowess-spell-builder" data-testid="maneuver-detail"><Link href={`/characters/${encodeURIComponent(characterId)}/abilities`}>Abilities</Link>
    <h1>{shown.draft?.concept.name ?? "Unreadable Maneuver"}</h1><p>{data.maneuver.status} · Revision {data.maneuver.current?.revisionNumber ?? "Draft"}</p><ManeuverState state={data.maneuver.state} />
    <p>Shared Signature slots: {data.signature.used} / {data.signature.capacity ?? "Unresolved"}.</p>
    {error ? <p role="alert">{error} <button onClick={() => void load()}>Reload saved Maneuver</button></p> : null}
    {data.maneuver.draft ? <Link href={`${base}/edit`}>Continue draft</Link> : null}
    {data.maneuver.status === "ACTIVE" && !data.maneuver.draft ? <button disabled={busy} onClick={() => void command("rebuild")}>Rebuild Maneuver</button> : null}
    {data.maneuver.status !== "RETIRED" ? <button disabled={busy} onClick={() => { if (window.confirm("Retire this Maneuver? Its revision history will be preserved.")) void command("retire"); }}>Retire Maneuver</button> : null}
    {shown.draft ? <ManeuverReview draft={shown.draft} evaluation={shown.evaluation} names={data.names} release={data.release} /> : <p>This revision is unreadable; no cost or substitute is invented.</p>}
    <section aria-label="Revision history"><h2>Immutable revision history</h2>{data.history.length ? data.history.map(r => <details key={r.revisionId} data-testid="maneuver-history-revision"><summary>Revision {r.revisionNumber}{r.current ? " (current)" : ""} · {r.createdAt}</summary><p>Exact Release: <code>{r.characterReleaseId}</code></p>{r.draft ? <ManeuverReview draft={r.draft} evaluation={r.evaluation} names={data.names} release={{ ...data.release, id: r.characterReleaseId }} /> : <p>Unreadable historical revision</p>}</details>) : <p>No finalized revisions yet. Drafts consume no Signature slot.</p>}</section>
  </article>;
}
