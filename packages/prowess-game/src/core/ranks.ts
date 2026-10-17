import type { JsonObject } from "@prowess/model";
import { deepFreeze } from "../internal/plain-data.js";
import { Problems, finish, type ProwessOutcome } from "../internal/problems.js";
import { CORE_ERROR_CODES as K } from "../definition/codes.js";
import type { RankLadderPayload } from "../definition/core-payload.js";
import type { CoreEntry } from "./definitions.js";

/**
 * Rank comparison as M4 data (PAS-10 M5-WO2 §92–93). A rank requirement ("requires Expert") becomes an M4
 * RANK_AT_LEAST predicate whose order comes from the exact RANK_LADDER Definition — never from string comparison,
 * alphabetical order or a TypeScript enum position. The ladder's `order` is position only; what a rank is WORTH (a Skill
 * bonus, a Martial Rank value, an Affinity discount) is separate, system-specific content (M5-I047).
 */
const ladderRank = (ladder: CoreEntry<RankLadderPayload>, rankKey: string) => ladder.payload.ranks.find((r) => r.rankKey === rankKey);

/** The M4 RANK_AT_LEAST predicate for "at least `requiredRankKey` on this ladder", with the ladder's provenance. */
export function rankAtLeastRequirement(ladder: CoreEntry<RankLadderPayload>, factKey: string, requiredRankKey: string): ProwessOutcome<JsonObject> {
  const p = new Problems();
  const required = ladderRank(ladder, requiredRankKey);
  if (required === undefined) p.add(K.UNKNOWN_RANK, ["requiredRankKey"], `${JSON.stringify(requiredRankKey)} is not a rank of ${ladder.ref.canonicalKey}`);
  return finish(p, () =>
    deepFreeze({ kind: "RANK_AT_LEAST", factKey, requiredRankKey, requiredOrder: (required as { order: number }).order, provenance: ladder.provenance as unknown as JsonObject }),
  );
}

/** The M4 rank fact for a held rank, ordered by the exact ladder. */
export function rankFact(ladder: CoreEntry<RankLadderPayload>, factKey: string, rankKey: string): ProwessOutcome<JsonObject> {
  const p = new Problems();
  const held = ladderRank(ladder, rankKey);
  if (held === undefined) p.add(K.UNKNOWN_RANK, ["rankKey"], `${JSON.stringify(rankKey)} is not a rank of ${ladder.ref.canonicalKey}`);
  return finish(p, () => deepFreeze({ key: factKey, rankKey, order: (held as { order: number }).order, provenance: ladder.provenance as unknown as JsonObject }));
}
