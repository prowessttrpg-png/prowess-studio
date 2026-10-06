import type { ChangeSetStatus, RulesetStatus } from "@prowess/model";
import { prisma } from "../client.js";

/**
 * Review-lifecycle writes (PAS-10 M2-WO8 §10–§17). Internal to @prowess/db. Each is ONE expected-state
 * conditional UPDATE that changes ONLY `status`: of two concurrent callers, exactly one matches the
 * expected status; the other matches zero rows. Returns whether this caller won.
 */
export async function transitionChangeSetStatusAtomic(id: string, from: ChangeSetStatus, to: ChangeSetStatus): Promise<boolean> {
  const { count } = await prisma.changeSet.updateMany({ where: { id, status: from }, data: { status: to } });
  return count === 1;
}

export async function transitionRulesetStatusAtomic(id: string, from: RulesetStatus, to: RulesetStatus): Promise<boolean> {
  const { count } = await prisma.ruleset.updateMany({ where: { id, status: from }, data: { status: to } });
  return count === 1;
}
