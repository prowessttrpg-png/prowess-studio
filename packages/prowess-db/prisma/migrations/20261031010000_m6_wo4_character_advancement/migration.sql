-- PAS-10 M6-WO4 — Character advancement. Adds the append-only advancement history of a Character (one row per Level
-- reached after creation, with its Stat Points, Skill advancement and Affinity progression choice) and replaces the
-- M6-WO3 Level freeze with an advancement-aware Level guard. No existing row is changed; no advancement is synthesized
-- for existing Characters (they stay Level 1 with an empty history).

-- CreateTable
CREATE TABLE "character_advancements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "character_id" UUID NOT NULL,
    "from_level" INTEGER NOT NULL,
    "to_level" INTEGER NOT NULL,
    "lock_version_before" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "character_advancements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "character_stat_advancements" (
    "advancement_id" UUID NOT NULL,
    "stat" TEXT NOT NULL,
    "points_spent" INTEGER NOT NULL,

    CONSTRAINT "character_stat_advancements_pkey" PRIMARY KEY ("advancement_id","stat")
);

-- CreateTable
CREATE TABLE "character_skill_advancements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "advancement_id" UUID NOT NULL,
    "skill_entity_id" UUID NOT NULL,
    "skill_entity_version_id" UUID NOT NULL,
    "action" TEXT NOT NULL,

    CONSTRAINT "character_skill_advancements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "character_affinity_advancement_choices" (
    "advancement_id" UUID NOT NULL,
    "option_key" TEXT NOT NULL,
    "affinity_entity_id" UUID,
    "affinity_entity_version_id" UUID,

    CONSTRAINT "character_affinity_advancement_choices_pkey" PRIMARY KEY ("advancement_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "character_advancements_character_id_to_level_key" ON "character_advancements"("character_id", "to_level");

-- CreateIndex
CREATE INDEX "character_skill_advancements_skill_entity_version_id_idx" ON "character_skill_advancements"("skill_entity_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "character_skill_advancements_advancement_id_skill_entity_id_key" ON "character_skill_advancements"("advancement_id", "skill_entity_id");

-- CreateIndex
CREATE INDEX "character_affinity_adv_choices_affinity_version_id_idx" ON "character_affinity_advancement_choices"("affinity_entity_version_id");

-- AddForeignKey
ALTER TABLE "character_advancements" ADD CONSTRAINT "character_advancements_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "character_stat_advancements" ADD CONSTRAINT "character_stat_advancements_advancement_id_fkey" FOREIGN KEY ("advancement_id") REFERENCES "character_advancements"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "character_skill_advancements" ADD CONSTRAINT "character_skill_advancements_advancement_id_fkey" FOREIGN KEY ("advancement_id") REFERENCES "character_advancements"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "character_skill_advancements" ADD CONSTRAINT "character_skill_advancements_skill_version_fkey" FOREIGN KEY ("skill_entity_version_id", "skill_entity_id") REFERENCES "entity_versions"("id", "entity_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "character_affinity_advancement_choices" ADD CONSTRAINT "character_affinity_advancement_choices_advancement_id_fkey" FOREIGN KEY ("advancement_id") REFERENCES "character_advancements"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "character_affinity_advancement_choices" ADD CONSTRAINT "character_affinity_advancement_choices_affinity_version_fkey" FOREIGN KEY ("affinity_entity_version_id", "affinity_entity_id") REFERENCES "entity_versions"("id", "entity_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- CHECK constraints (not modelled by Prisma; invisible to schema.prisma and the drift check).
ALTER TABLE "character_advancements" ADD CONSTRAINT "character_advancements_one_level_check" CHECK ("from_level" >= 1 AND "to_level" = "from_level" + 1);
ALTER TABLE "character_advancements" ADD CONSTRAINT "character_advancements_lock_version_check" CHECK ("lock_version_before" >= 1);
ALTER TABLE "character_stat_advancements" ADD CONSTRAINT "character_stat_advancements_points_check" CHECK ("points_spent" > 0);
ALTER TABLE "character_affinity_advancement_choices" ADD CONSTRAINT "character_affinity_advancement_choices_pair_check" CHECK (("affinity_entity_id" IS NULL) = ("affinity_entity_version_id" IS NULL));

-- The M6-WO3 Character guard, with its Level rule REPLACED by an advancement-aware one (§44–§45): the Release stays
-- immutable; a completed Character's creation inputs stay frozen and completion cannot be undone; the Level of ANY
-- Character changes only by exactly +1, only once core creation is complete, and only when the advancement row for
-- exactly that Level already exists in the same transaction. A decrement, a repeat, a jump or a bare edit is refused.
CREATE OR REPLACE FUNCTION "characters_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."ruleset_release_id" IS DISTINCT FROM OLD."ruleset_release_id" THEN
    RAISE EXCEPTION 'CHARACTER_RELEASE_IMMUTABLE: a Character''s Release cannot change after creation' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."core_creation_completed_at" IS NOT NULL AND (
       NEW."core_creation_completed_at" IS DISTINCT FROM OLD."core_creation_completed_at"
    OR NEW."ancestry_entity_id" IS DISTINCT FROM OLD."ancestry_entity_id"
    OR NEW."ancestry_entity_version_id" IS DISTINCT FROM OLD."ancestry_entity_version_id"
    OR NEW."primary_affinity_entity_id" IS DISTINCT FROM OLD."primary_affinity_entity_id"
    OR NEW."primary_affinity_entity_version_id" IS DISTINCT FROM OLD."primary_affinity_entity_version_id") THEN
    RAISE EXCEPTION 'CHARACTER_CORE_FROZEN: core creation is complete; mechanical choices are frozen' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."level" IS DISTINCT FROM OLD."level" THEN
    IF OLD."core_creation_completed_at" IS NULL
       OR NEW."level" IS DISTINCT FROM OLD."level" + 1
       OR NOT EXISTS (SELECT 1 FROM "character_advancements" a WHERE a."character_id" = NEW."id" AND a."from_level" = OLD."level" AND a."to_level" = NEW."level") THEN
      RAISE EXCEPTION 'CHARACTER_LEVEL_GUARD: a Character''s Level changes only by one committed advancement of exactly one Level' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- An advancement row is inserted only for a completed Character, from its present Level (the Level update follows in
-- the same transaction). Committed history is append-only: no UPDATE or DELETE of any advancement row, and a child row
-- may only join an advancement that is still being committed (its Character has not reached its Level yet).
CREATE FUNCTION "character_advancements_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'CHARACTER_ADVANCEMENT_IMMUTABLE: committed advancement history is append-only' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "characters" c WHERE c."id" = NEW."character_id" AND c."core_creation_completed_at" IS NOT NULL AND c."level" = NEW."from_level") THEN
    RAISE EXCEPTION 'CHARACTER_ADVANCEMENT_ORDER: an advancement starts at the completed Character''s present Level' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "character_advancements_guard" BEFORE INSERT OR UPDATE OR DELETE ON "character_advancements" FOR EACH ROW EXECUTE FUNCTION "character_advancements_guard"();

CREATE FUNCTION "character_advancement_children_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' OR NOT EXISTS (
       SELECT 1 FROM "character_advancements" a JOIN "characters" c ON c."id" = a."character_id"
       WHERE a."id" = NEW."advancement_id" AND c."level" = a."from_level") THEN
    RAISE EXCEPTION 'CHARACTER_ADVANCEMENT_IMMUTABLE: committed advancement history is append-only' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "character_stat_advancements_guard" BEFORE INSERT OR UPDATE OR DELETE ON "character_stat_advancements" FOR EACH ROW EXECUTE FUNCTION "character_advancement_children_guard"();
CREATE TRIGGER "character_skill_advancements_guard" BEFORE INSERT OR UPDATE OR DELETE ON "character_skill_advancements" FOR EACH ROW EXECUTE FUNCTION "character_advancement_children_guard"();
CREATE TRIGGER "character_affinity_advancement_choices_guard" BEFORE INSERT OR UPDATE OR DELETE ON "character_affinity_advancement_choices" FOR EACH ROW EXECUTE FUNCTION "character_advancement_children_guard"();
