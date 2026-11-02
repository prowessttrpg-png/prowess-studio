-- PAS-10 M6-WO7 — Character Signature Abilities. Adds the Character-owned Signature Ability roster header (abilityKind
-- SPELL only) and the append-only finalized Signature Spell revisions. Character Spells are NOT Compendium canon: no
-- Entity, EntityVersion, ChangeSet or Release row is created or changed. No existing table or row changes; no Spell
-- component is duplicated; nothing derived (cost, capacity, range, Sustain) is stored.

-- CreateTable
CREATE TABLE "character_signature_abilities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "character_id" UUID NOT NULL,
    "ability_kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "current_revision_id" UUID,
    "draft_payload" JSONB,
    "lock_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retired_at" TIMESTAMPTZ(6),

    CONSTRAINT "character_signature_abilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "character_signature_spell_revisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ability_id" UUID NOT NULL,
    "revision_number" INTEGER NOT NULL,
    "character_release_id" UUID NOT NULL,
    "previous_revision_id" UUID,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "character_signature_spell_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "character_signature_abilities_current_revision_id_key" ON "character_signature_abilities"("current_revision_id");

-- CreateIndex
CREATE INDEX "character_signature_abilities_character_id_idx" ON "character_signature_abilities"("character_id");

-- CreateIndex
CREATE UNIQUE INDEX "character_signature_spell_revisions_previous_revision_id_key" ON "character_signature_spell_revisions"("previous_revision_id");

-- CreateIndex
CREATE INDEX "character_signature_spell_revisions_character_release_id_idx" ON "character_signature_spell_revisions"("character_release_id");

-- CreateIndex
CREATE UNIQUE INDEX "character_signature_spell_revisions_ability_revision_key" ON "character_signature_spell_revisions"("ability_id", "revision_number");

-- AddForeignKey
ALTER TABLE "character_signature_abilities" ADD CONSTRAINT "character_signature_abilities_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "character_signature_abilities" ADD CONSTRAINT "character_signature_abilities_current_revision_id_fkey" FOREIGN KEY ("current_revision_id") REFERENCES "character_signature_spell_revisions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "character_signature_spell_revisions" ADD CONSTRAINT "character_signature_spell_revisions_ability_id_fkey" FOREIGN KEY ("ability_id") REFERENCES "character_signature_abilities"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "character_signature_spell_revisions" ADD CONSTRAINT "character_signature_spell_revisions_character_release_id_fkey" FOREIGN KEY ("character_release_id") REFERENCES "ruleset_releases"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "character_signature_spell_revisions" ADD CONSTRAINT "character_signature_spell_revisions_previous_revision_id_fkey" FOREIGN KEY ("previous_revision_id") REFERENCES "character_signature_spell_revisions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Integrity (hand-written; Prisma does not model CHECK constraints or triggers).
-- WO7 supports Spells only; the status vocabulary is closed; a finalized (ACTIVE / RETIRED) ability has a current revision;
-- revision numbers start at 1; the lock version starts at 1; a payload is a JSON object.
ALTER TABLE "character_signature_abilities" ADD CONSTRAINT "character_signature_abilities_kind_check" CHECK ("ability_kind" = 'SPELL');
ALTER TABLE "character_signature_abilities" ADD CONSTRAINT "character_signature_abilities_status_check" CHECK ("status" IN ('DRAFT', 'ACTIVE', 'RETIRED'));
ALTER TABLE "character_signature_abilities" ADD CONSTRAINT "character_signature_abilities_current_check" CHECK ("status" = 'DRAFT' OR "current_revision_id" IS NOT NULL OR "retired_at" IS NOT NULL);
ALTER TABLE "character_signature_abilities" ADD CONSTRAINT "character_signature_abilities_retired_check" CHECK (("status" = 'RETIRED') = ("retired_at" IS NOT NULL));
ALTER TABLE "character_signature_abilities" ADD CONSTRAINT "character_signature_abilities_draft_check" CHECK ("draft_payload" IS NULL OR jsonb_typeof("draft_payload") = 'object');
ALTER TABLE "character_signature_abilities" ADD CONSTRAINT "character_signature_abilities_lock_version_check" CHECK ("lock_version" >= 1);
ALTER TABLE "character_signature_spell_revisions" ADD CONSTRAINT "character_signature_spell_revisions_number_check" CHECK ("revision_number" >= 1);
ALTER TABLE "character_signature_spell_revisions" ADD CONSTRAINT "character_signature_spell_revisions_payload_check" CHECK (jsonb_typeof("payload") = 'object');

-- Finalized revisions are append-only history (M6-I092): UPDATE and DELETE are refused at the database.
CREATE FUNCTION "character_signature_spell_revisions_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'CHARACTER_SIGNATURE_SPELL_REVISION_IMMUTABLE: finalized Signature Spell revisions are append-only (%)', TG_OP USING ERRCODE = 'check_violation';
END;
$$;
CREATE TRIGGER "character_signature_spell_revisions_append_only" BEFORE UPDATE OR DELETE ON "character_signature_spell_revisions" FOR EACH ROW EXECUTE FUNCTION "character_signature_spell_revisions_append_only"();

-- An ability's current revision is one of ITS OWN revisions.
CREATE FUNCTION "character_signature_abilities_current_revision_owned"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."current_revision_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "character_signature_spell_revisions" r WHERE r."id" = NEW."current_revision_id" AND r."ability_id" = NEW."id") THEN
    RAISE EXCEPTION 'CHARACTER_SIGNATURE_ABILITY_CURRENT_REVISION: the current revision of a Signature Ability is one of its own revisions' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "character_signature_abilities_current_revision_owned" BEFORE INSERT OR UPDATE OF "current_revision_id" ON "character_signature_abilities" FOR EACH ROW EXECUTE FUNCTION "character_signature_abilities_current_revision_owned"();
