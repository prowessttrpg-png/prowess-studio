-- PAS-10 M6-WO3 — Character foundation. Adds ONLY the Character-domain tables, their constraints and guards; no
-- existing table, column, index or constraint is changed. Characters are player state, never Entity / EntityVersion.

-- CreateTable
CREATE TABLE "characters" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "concept" TEXT,
    "ruleset_release_id" UUID NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "ancestry_entity_id" UUID,
    "ancestry_entity_version_id" UUID,
    "primary_affinity_entity_id" UUID,
    "primary_affinity_entity_version_id" UUID,
    "core_creation_completed_at" TIMESTAMPTZ(6),
    "lock_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "characters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "character_stat_allocations" (
    "character_id" UUID NOT NULL,
    "stat" TEXT NOT NULL,
    "points_spent" INTEGER NOT NULL,

    CONSTRAINT "character_stat_allocations_pkey" PRIMARY KEY ("character_id","stat")
);

-- CreateTable
CREATE TABLE "character_ancestry_stat_choices" (
    "character_id" UUID NOT NULL,
    "grant_key" TEXT NOT NULL,
    "stat" TEXT NOT NULL,

    CONSTRAINT "character_ancestry_stat_choices_pkey" PRIMARY KEY ("character_id","grant_key","stat")
);

-- CreateTable
CREATE TABLE "character_skill_ranks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "character_id" UUID NOT NULL,
    "skill_entity_id" UUID NOT NULL,
    "skill_entity_version_id" UUID NOT NULL,
    "rank_key" TEXT NOT NULL,
    "source_kind" TEXT NOT NULL,
    "source_grant_key" TEXT,

    CONSTRAINT "character_skill_ranks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "characters_ruleset_release_id_idx" ON "characters"("ruleset_release_id");

-- CreateIndex
CREATE INDEX "characters_ancestry_entity_version_id_idx" ON "characters"("ancestry_entity_version_id");

-- CreateIndex
CREATE INDEX "characters_primary_affinity_entity_version_id_idx" ON "characters"("primary_affinity_entity_version_id");

-- CreateIndex
CREATE INDEX "character_skill_ranks_skill_entity_version_id_idx" ON "character_skill_ranks"("skill_entity_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "character_skill_ranks_character_id_skill_entity_id_key" ON "character_skill_ranks"("character_id", "skill_entity_id");

-- AddForeignKey
ALTER TABLE "characters" ADD CONSTRAINT "characters_ruleset_release_id_fkey" FOREIGN KEY ("ruleset_release_id") REFERENCES "ruleset_releases"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "characters" ADD CONSTRAINT "characters_ancestry_version_fkey" FOREIGN KEY ("ancestry_entity_version_id", "ancestry_entity_id") REFERENCES "entity_versions"("id", "entity_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "characters" ADD CONSTRAINT "characters_primary_affinity_version_fkey" FOREIGN KEY ("primary_affinity_entity_version_id", "primary_affinity_entity_id") REFERENCES "entity_versions"("id", "entity_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "character_stat_allocations" ADD CONSTRAINT "character_stat_allocations_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "character_ancestry_stat_choices" ADD CONSTRAINT "character_ancestry_stat_choices_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "character_skill_ranks" ADD CONSTRAINT "character_skill_ranks_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "character_skill_ranks" ADD CONSTRAINT "character_skill_ranks_skill_version_fkey" FOREIGN KEY ("skill_entity_version_id", "skill_entity_id") REFERENCES "entity_versions"("id", "entity_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- CHECK constraints (Prisma does not model CHECK constraints; they are invisible to schema.prisma and to the drift
-- check). An exact reference is both ids or neither — a composite foreign key with one NULL column is not enforced.
ALTER TABLE "characters" ADD CONSTRAINT "characters_ancestry_pair_check" CHECK (("ancestry_entity_id" IS NULL) = ("ancestry_entity_version_id" IS NULL));
ALTER TABLE "characters" ADD CONSTRAINT "characters_primary_affinity_pair_check" CHECK (("primary_affinity_entity_id" IS NULL) = ("primary_affinity_entity_version_id" IS NULL));
ALTER TABLE "characters" ADD CONSTRAINT "characters_level_check" CHECK ("level" >= 1);
ALTER TABLE "characters" ADD CONSTRAINT "characters_lock_version_check" CHECK ("lock_version" >= 1);
ALTER TABLE "characters" ADD CONSTRAINT "characters_name_check" CHECK (length(btrim("name")) > 0);
ALTER TABLE "character_stat_allocations" ADD CONSTRAINT "character_stat_allocations_points_check" CHECK ("points_spent" >= 0);

-- Guards (defence in depth behind the service): a Character's Release is immutable from creation; once core creation
-- is complete its mechanical inputs are frozen (only name / concept / bookkeeping may change) and completion cannot be
-- undone; the child rows of a completed Character cannot be inserted, changed or removed.
CREATE FUNCTION "characters_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."ruleset_release_id" IS DISTINCT FROM OLD."ruleset_release_id" THEN
    RAISE EXCEPTION 'CHARACTER_RELEASE_IMMUTABLE: a Character''s Release cannot change after creation' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."core_creation_completed_at" IS NOT NULL AND (
       NEW."core_creation_completed_at" IS DISTINCT FROM OLD."core_creation_completed_at"
    OR NEW."level" IS DISTINCT FROM OLD."level"
    OR NEW."ancestry_entity_id" IS DISTINCT FROM OLD."ancestry_entity_id"
    OR NEW."ancestry_entity_version_id" IS DISTINCT FROM OLD."ancestry_entity_version_id"
    OR NEW."primary_affinity_entity_id" IS DISTINCT FROM OLD."primary_affinity_entity_id"
    OR NEW."primary_affinity_entity_version_id" IS DISTINCT FROM OLD."primary_affinity_entity_version_id") THEN
    RAISE EXCEPTION 'CHARACTER_CORE_FROZEN: core creation is complete; mechanical choices are frozen' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "characters_guard" BEFORE UPDATE ON "characters" FOR EACH ROW EXECUTE FUNCTION "characters_guard"();

CREATE FUNCTION "character_children_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target UUID := CASE WHEN TG_OP = 'DELETE' THEN OLD."character_id" ELSE NEW."character_id" END;
BEGIN
  IF EXISTS (SELECT 1 FROM "characters" c WHERE c."id" = target AND c."core_creation_completed_at" IS NOT NULL)
     OR (TG_OP = 'UPDATE' AND EXISTS (SELECT 1 FROM "characters" c WHERE c."id" = OLD."character_id" AND c."core_creation_completed_at" IS NOT NULL)) THEN
    RAISE EXCEPTION 'CHARACTER_CORE_FROZEN: core creation is complete; mechanical choices are frozen' USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
CREATE TRIGGER "character_stat_allocations_guard" BEFORE INSERT OR UPDATE OR DELETE ON "character_stat_allocations" FOR EACH ROW EXECUTE FUNCTION "character_children_guard"();
CREATE TRIGGER "character_ancestry_stat_choices_guard" BEFORE INSERT OR UPDATE OR DELETE ON "character_ancestry_stat_choices" FOR EACH ROW EXECUTE FUNCTION "character_children_guard"();
CREATE TRIGGER "character_skill_ranks_guard" BEFORE INSERT OR UPDATE OR DELETE ON "character_skill_ranks" FOR EACH ROW EXECUTE FUNCTION "character_children_guard"();
