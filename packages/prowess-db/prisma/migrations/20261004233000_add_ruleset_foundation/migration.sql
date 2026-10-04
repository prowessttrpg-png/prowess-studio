-- CreateEnum
CREATE TYPE "RulesetStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'DEPRECATED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "RulesetChannel" AS ENUM ('DEVELOPMENT', 'INTERNAL_PLAYTEST', 'CORE_PLAYTEST', 'EXPERIMENTAL', 'STABLE', 'LEGACY');

-- CreateTable
CREATE TABLE "rulesets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "canonical_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "RulesetStatus" NOT NULL DEFAULT 'DRAFT',
    "channel" "RulesetChannel" NOT NULL,
    "version_label" TEXT,
    "parent_ruleset_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "rulesets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rulesets_canonical_key_key" ON "rulesets"("canonical_key");

-- CreateIndex
CREATE INDEX "rulesets_parent_ruleset_id_idx" ON "rulesets"("parent_ruleset_id");

-- AddForeignKey
ALTER TABLE "rulesets" ADD CONSTRAINT "rulesets_parent_ruleset_id_fkey" FOREIGN KEY ("parent_ruleset_id") REFERENCES "rulesets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
