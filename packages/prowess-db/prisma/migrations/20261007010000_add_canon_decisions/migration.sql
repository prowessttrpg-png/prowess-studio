-- CreateEnum
CREATE TYPE "CanonDecisionType" AS ENUM ('SELECT_RULE', 'KEEP_SEPARATE', 'MERGE', 'RESOLVE_CONFLICT');

-- CreateEnum
CREATE TYPE "CanonConflictDisposition" AS ENUM ('RESOLVED', 'ACCEPTED_DIVERGENCE', 'DISMISSED');

-- CreateTable
CREATE TABLE "canon_decisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ruleset_id" UUID NOT NULL,
    "entity_id" UUID NOT NULL,
    "rule_conflict_id" UUID NOT NULL,
    "canon_policy_id" UUID NOT NULL,
    "decision_type" "CanonDecisionType" NOT NULL,
    "conflict_disposition" "CanonConflictDisposition" NOT NULL,
    "result_entity_version_id" UUID,
    "rationale" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "canon_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canon_decision_selections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "canon_decision_id" UUID NOT NULL,
    "rule_conflict_id" UUID NOT NULL,
    "rule_conflict_candidate_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "canon_decision_selections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "canon_decisions_ruleset_id_idx" ON "canon_decisions"("ruleset_id");

-- CreateIndex
CREATE INDEX "canon_decisions_rule_conflict_id_idx" ON "canon_decisions"("rule_conflict_id");

-- CreateIndex
CREATE INDEX "canon_decisions_canon_policy_id_idx" ON "canon_decisions"("canon_policy_id");

-- CreateIndex
CREATE INDEX "canon_decisions_result_entity_version_id_idx" ON "canon_decisions"("result_entity_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "canon_decisions_id_rule_conflict_id_key" ON "canon_decisions"("id", "rule_conflict_id");

-- CreateIndex
CREATE INDEX "canon_decision_selections_candidate_id_idx" ON "canon_decision_selections"("rule_conflict_candidate_id");

-- CreateIndex
CREATE UNIQUE INDEX "canon_decision_selections_decision_candidate_key" ON "canon_decision_selections"("canon_decision_id", "rule_conflict_candidate_id");

-- CreateIndex
CREATE UNIQUE INDEX "canon_policies_id_ruleset_id_key" ON "canon_policies"("id", "ruleset_id");

-- CreateIndex
CREATE UNIQUE INDEX "rule_conflict_candidates_id_rule_conflict_id_key" ON "rule_conflict_candidates"("id", "rule_conflict_id");

-- CreateIndex
CREATE UNIQUE INDEX "rule_conflicts_id_ruleset_id_entity_id_key" ON "rule_conflicts"("id", "ruleset_id", "entity_id");

-- AddForeignKey
ALTER TABLE "canon_decisions" ADD CONSTRAINT "canon_decisions_ruleset_id_fkey" FOREIGN KEY ("ruleset_id") REFERENCES "rulesets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canon_decisions" ADD CONSTRAINT "canon_decisions_conflict_fkey" FOREIGN KEY ("rule_conflict_id", "ruleset_id", "entity_id") REFERENCES "rule_conflicts"("id", "ruleset_id", "entity_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canon_decisions" ADD CONSTRAINT "canon_decisions_policy_fkey" FOREIGN KEY ("canon_policy_id", "ruleset_id") REFERENCES "canon_policies"("id", "ruleset_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canon_decisions" ADD CONSTRAINT "canon_decisions_result_version_fkey" FOREIGN KEY ("result_entity_version_id", "entity_id") REFERENCES "entity_versions"("id", "entity_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canon_decision_selections" ADD CONSTRAINT "canon_decision_selections_decision_fkey" FOREIGN KEY ("canon_decision_id", "rule_conflict_id") REFERENCES "canon_decisions"("id", "rule_conflict_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canon_decision_selections" ADD CONSTRAINT "canon_decision_selections_candidate_fkey" FOREIGN KEY ("rule_conflict_candidate_id", "rule_conflict_id") REFERENCES "rule_conflict_candidates"("id", "rule_conflict_id") ON DELETE RESTRICT ON UPDATE CASCADE;
