-- M6-WO8: shared Character Signature roster, separate append-only Maneuver history.
-- No existing Spell revision or canonical Release is rewritten.


CREATE TABLE "character_signature_maneuver_revisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ability_id" UUID NOT NULL,
    "revision_number" INTEGER NOT NULL,
    "character_release_id" UUID NOT NULL,
    "previous_revision_id" UUID,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "character_signature_maneuver_revisions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "character_signature_abilities" ADD COLUMN "current_maneuver_revision_id" UUID;

CREATE UNIQUE INDEX "character_signature_maneuver_revisions_previous_revision_id_key" ON "character_signature_maneuver_revisions"("previous_revision_id");

CREATE INDEX "character_signature_maneuver_revisions_character_release_id_idx" ON "character_signature_maneuver_revisions"("character_release_id");

CREATE UNIQUE INDEX "character_signature_maneuver_revisions_ability_revision_key" ON "character_signature_maneuver_revisions"("ability_id", "revision_number");

ALTER TABLE "character_signature_maneuver_revisions" ADD CONSTRAINT "character_signature_maneuver_revisions_ability_id_fkey" FOREIGN KEY ("ability_id") REFERENCES "character_signature_abilities"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "character_signature_maneuver_revisions" ADD CONSTRAINT "character_signature_maneuver_revisions_character_release_id_fkey" FOREIGN KEY ("character_release_id") REFERENCES "ruleset_releases"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "character_signature_maneuver_revisions" ADD CONSTRAINT "character_signature_maneuver_revisions_previous_revision_id_fkey" FOREIGN KEY ("previous_revision_id") REFERENCES "character_signature_maneuver_revisions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "character_signature_maneuver_revisions" ADD CONSTRAINT "character_signature_maneuver_revisions_number_check" CHECK ("revision_number" >= 1);

ALTER TABLE "character_signature_maneuver_revisions" ADD CONSTRAINT "character_signature_maneuver_revisions_payload_check" CHECK (jsonb_typeof("payload") = 'object');

CREATE UNIQUE INDEX "character_signature_abilities_current_maneuver_revision_id_key" ON "character_signature_abilities"("current_maneuver_revision_id");
ALTER TABLE "character_signature_abilities" ADD CONSTRAINT "character_signature_abilities_current_maneuver_revision_id_fkey" FOREIGN KEY ("current_maneuver_revision_id") REFERENCES "character_signature_maneuver_revisions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "character_signature_abilities" DROP CONSTRAINT "character_signature_abilities_kind_check";
ALTER TABLE "character_signature_abilities" ADD CONSTRAINT "character_signature_abilities_kind_check" CHECK ("ability_kind" IN ('SPELL', 'MANEUVER'));
ALTER TABLE "character_signature_abilities" DROP CONSTRAINT "character_signature_abilities_current_check";
ALTER TABLE "character_signature_abilities" ADD CONSTRAINT "character_signature_abilities_current_check" CHECK (
  ("ability_kind" = 'SPELL' AND "current_maneuver_revision_id" IS NULL AND ("status" <> 'ACTIVE' OR "current_revision_id" IS NOT NULL)) OR
  ("ability_kind" = 'MANEUVER' AND "current_revision_id" IS NULL AND ("status" <> 'ACTIVE' OR "current_maneuver_revision_id" IS NOT NULL))
);
CREATE FUNCTION "character_signature_maneuver_revisions_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'CHARACTER_SIGNATURE_MANEUVER_REVISION_IMMUTABLE: finalized Maneuver revisions are append-only (%)', TG_OP USING ERRCODE = 'check_violation';
END;
$$;
CREATE TRIGGER "character_signature_maneuver_revisions_append_only" BEFORE UPDATE OR DELETE ON "character_signature_maneuver_revisions" FOR EACH ROW EXECUTE FUNCTION "character_signature_maneuver_revisions_append_only"();
CREATE OR REPLACE FUNCTION "character_signature_abilities_current_revision_owned"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."ability_kind" <> OLD."ability_kind" THEN
    RAISE EXCEPTION 'CHARACTER_SIGNATURE_ABILITY_KIND_IMMUTABLE' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."current_revision_id" IS NOT NULL AND (NEW."ability_kind" <> 'SPELL' OR NOT EXISTS (SELECT 1 FROM "character_signature_spell_revisions" r WHERE r."id" = NEW."current_revision_id" AND r."ability_id" = NEW."id")) THEN
    RAISE EXCEPTION 'CHARACTER_SIGNATURE_ABILITY_CURRENT_REVISION: own Spell revision required' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."current_maneuver_revision_id" IS NOT NULL AND (NEW."ability_kind" <> 'MANEUVER' OR NOT EXISTS (SELECT 1 FROM "character_signature_maneuver_revisions" r WHERE r."id" = NEW."current_maneuver_revision_id" AND r."ability_id" = NEW."id")) THEN
    RAISE EXCEPTION 'CHARACTER_SIGNATURE_ABILITY_CURRENT_REVISION: own Maneuver revision required' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER "character_signature_abilities_current_revision_owned" ON "character_signature_abilities";
CREATE TRIGGER "character_signature_abilities_current_revision_owned" BEFORE INSERT OR UPDATE OF "ability_kind", "current_revision_id", "current_maneuver_revision_id" ON "character_signature_abilities" FOR EACH ROW EXECUTE FUNCTION "character_signature_abilities_current_revision_owned"();
CREATE FUNCTION "character_signature_revision_kind_owned"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected_kind TEXT;
BEGIN
  expected_kind := CASE WHEN TG_TABLE_NAME = 'character_signature_spell_revisions' THEN 'SPELL' ELSE 'MANEUVER' END;
  IF NOT EXISTS (SELECT 1 FROM "character_signature_abilities" WHERE "id" = NEW."ability_id" AND "ability_kind" = expected_kind) THEN
    RAISE EXCEPTION 'CHARACTER_SIGNATURE_REVISION_KIND: revision must belong to an ability of its own kind' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."previous_revision_id" IS NOT NULL THEN
    IF expected_kind = 'SPELL' AND NOT EXISTS (SELECT 1 FROM "character_signature_spell_revisions" WHERE "id" = NEW."previous_revision_id" AND "ability_id" = NEW."ability_id") THEN
      RAISE EXCEPTION 'CHARACTER_SIGNATURE_REVISION_PREDECESSOR' USING ERRCODE = 'check_violation';
    END IF;
    IF expected_kind = 'MANEUVER' AND NOT EXISTS (SELECT 1 FROM "character_signature_maneuver_revisions" WHERE "id" = NEW."previous_revision_id" AND "ability_id" = NEW."ability_id") THEN
      RAISE EXCEPTION 'CHARACTER_SIGNATURE_REVISION_PREDECESSOR' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "character_signature_spell_revisions_kind_owned" BEFORE INSERT ON "character_signature_spell_revisions" FOR EACH ROW EXECUTE FUNCTION "character_signature_revision_kind_owned"();
CREATE TRIGGER "character_signature_maneuver_revisions_kind_owned" BEFORE INSERT ON "character_signature_maneuver_revisions" FOR EACH ROW EXECUTE FUNCTION "character_signature_revision_kind_owned"();
