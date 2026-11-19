-- M7-WO1: Encounter foundation and roster — encounters prepared on ONE exact published Release, named sides, Character
-- memberships (references, never resource copies) and an append-only command history. Additive only: no existing table,
-- row, Release, Character or play state is rewritten. The table / index / foreign-key statements below are exactly what
-- the Prisma schema engine generates for the M7-WO1 models; the CHECKs and triggers after them are hand-written guards.

-- CreateTable
CREATE TABLE "encounters" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "ruleset_release_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "archived_at" TIMESTAMPTZ(6),
    "lock_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "encounters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "encounter_sides" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "encounter_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "encounter_sides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "encounter_participants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "encounter_id" UUID NOT NULL,
    "ruleset_release_id" UUID NOT NULL,
    "side_id" UUID,
    "character_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "encounter_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "encounter_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "encounter_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "idempotency_key" UUID NOT NULL,
    "request_hash" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "encounter_version" INTEGER NOT NULL,
    "record" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "encounter_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "encounters_ruleset_release_id_idx" ON "encounters"("ruleset_release_id");

-- CreateIndex
CREATE UNIQUE INDEX "encounters_id_ruleset_release_id_key" ON "encounters"("id", "ruleset_release_id");

-- CreateIndex
CREATE UNIQUE INDEX "encounter_sides_id_encounter_id_key" ON "encounter_sides"("id", "encounter_id");

-- CreateIndex
CREATE UNIQUE INDEX "encounter_sides_encounter_id_ordinal_key" ON "encounter_sides"("encounter_id", "ordinal");

-- CreateIndex
CREATE INDEX "encounter_participants_side_id_encounter_id_idx" ON "encounter_participants"("side_id", "encounter_id");

-- CreateIndex
CREATE INDEX "encounter_participants_character_id_idx" ON "encounter_participants"("character_id");

-- CreateIndex
CREATE INDEX "encounter_participants_encounter_id_ruleset_release_id_idx" ON "encounter_participants"("encounter_id", "ruleset_release_id");

-- CreateIndex
CREATE UNIQUE INDEX "encounter_participants_encounter_id_character_id_key" ON "encounter_participants"("encounter_id", "character_id");

-- CreateIndex
CREATE UNIQUE INDEX "encounter_events_encounter_id_sequence_key" ON "encounter_events"("encounter_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "encounter_events_idempotency_key_key" ON "encounter_events"("idempotency_key");

-- AddForeignKey
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_ruleset_release_id_fkey" FOREIGN KEY ("ruleset_release_id") REFERENCES "ruleset_releases"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "encounter_sides" ADD CONSTRAINT "encounter_sides_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "encounters"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "encounter_participants" ADD CONSTRAINT "encounter_participants_encounter_id_ruleset_release_id_fkey" FOREIGN KEY ("encounter_id", "ruleset_release_id") REFERENCES "encounters"("id", "ruleset_release_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "encounter_participants" ADD CONSTRAINT "encounter_participants_side_id_encounter_id_fkey" FOREIGN KEY ("side_id", "encounter_id") REFERENCES "encounter_sides"("id", "encounter_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "encounter_participants" ADD CONSTRAINT "encounter_participants_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "encounter_events" ADD CONSTRAINT "encounter_events_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "encounters"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Bounds and closed vocabularies.
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_status_check" CHECK ("status" IN ('PREPARATION', 'ARCHIVED'));
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_archived_at_check" CHECK (("status" = 'ARCHIVED') = ("archived_at" IS NOT NULL));
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_lock_version_check" CHECK ("lock_version" >= 1);
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_name_check" CHECK (char_length(btrim("name")) BETWEEN 1 AND 120 AND "name" = btrim("name"));
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_notes_check" CHECK ("notes" IS NULL OR char_length("notes") <= 4000);
ALTER TABLE "encounter_sides" ADD CONSTRAINT "encounter_sides_name_check" CHECK (char_length(btrim("name")) BETWEEN 1 AND 80 AND "name" = btrim("name"));
ALTER TABLE "encounter_sides" ADD CONSTRAINT "encounter_sides_ordinal_check" CHECK ("ordinal" >= 1);
ALTER TABLE "encounter_events" ADD CONSTRAINT "encounter_events_sequence_check" CHECK ("sequence" >= 1);
ALTER TABLE "encounter_events" ADD CONSTRAINT "encounter_events_version_check" CHECK ("encounter_version" >= 1);
ALTER TABLE "encounter_events" ADD CONSTRAINT "encounter_events_record_check" CHECK (jsonb_typeof("record") = 'object');
ALTER TABLE "encounter_events" ADD CONSTRAINT "encounter_events_request_hash_check" CHECK ("request_hash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "encounter_events" ADD CONSTRAINT "encounter_events_summary_check" CHECK (char_length("summary") BETWEEN 1 AND 2000);
ALTER TABLE "encounter_events" ADD CONSTRAINT "encounter_events_kind_check" CHECK ("kind" IN ('ENCOUNTER_CREATED', 'METADATA_UPDATED', 'SIDE_ADDED', 'SIDE_RENAMED', 'SIDE_REMOVED', 'PARTICIPANT_ADDED', 'PARTICIPANT_MOVED', 'PARTICIPANT_REMOVED', 'ENCOUNTER_ARCHIVED'));

-- The history is append-only: a committed encounter command is never edited or deleted.
CREATE FUNCTION "encounter_events_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ENCOUNTER_EVENT_IMMUTABLE: committed encounter commands are append-only (%)', TG_OP USING ERRCODE = 'check_violation';
END;
$$;
CREATE TRIGGER "encounter_events_append_only" BEFORE UPDATE OR DELETE ON "encounter_events" FOR EACH ROW EXECUTE FUNCTION "encounter_events_append_only"();

-- An encounter keeps its exact Release; ARCHIVED is terminal (an archived encounter is a read-only historical record).
CREATE FUNCTION "encounters_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."ruleset_release_id" <> OLD."ruleset_release_id" OR NEW."id" <> OLD."id" THEN
    RAISE EXCEPTION 'ENCOUNTER_IDENTITY: an encounter keeps its identity and exact Release' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."status" = 'ARCHIVED' THEN
    RAISE EXCEPTION 'ENCOUNTER_ARCHIVED: an archived encounter is read-only' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "encounters_guard" BEFORE UPDATE ON "encounters" FOR EACH ROW EXECUTE FUNCTION "encounters_guard"();
CREATE FUNCTION "encounters_no_delete"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ENCOUNTER_NO_DELETE: encounters are archived, never deleted' USING ERRCODE = 'check_violation';
END;
$$;
CREATE TRIGGER "encounters_no_delete" BEFORE DELETE ON "encounters" FOR EACH ROW EXECUTE FUNCTION "encounters_no_delete"();

-- Roster rows of an archived encounter never change (a workspace restore re-inserts them under the transfer setting).
CREATE FUNCTION "encounter_roster_open"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target uuid;
BEGIN
  IF current_setting('prowess.content_pack_transfer', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  target := CASE WHEN TG_OP = 'DELETE' THEN OLD."encounter_id" ELSE NEW."encounter_id" END;
  IF EXISTS (SELECT 1 FROM "encounters" e WHERE e."id" = target AND e."status" = 'ARCHIVED') THEN
    RAISE EXCEPTION 'ENCOUNTER_ARCHIVED: an archived encounter''s roster is read-only' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "encounter_sides_roster_open" BEFORE INSERT OR UPDATE OR DELETE ON "encounter_sides" FOR EACH ROW EXECUTE FUNCTION "encounter_roster_open"();
CREATE TRIGGER "encounter_participants_roster_open" BEFORE INSERT OR UPDATE OR DELETE ON "encounter_participants" FOR EACH ROW EXECUTE FUNCTION "encounter_roster_open"();

-- A side keeps its encounter. A membership keeps its encounter, Release and Character (only its side may change), and
-- the Character's OWN exact Release must be the encounter's: a Character on another Release can never join.
CREATE FUNCTION "encounter_sides_identity"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."encounter_id" <> OLD."encounter_id" OR NEW."ordinal" <> OLD."ordinal" THEN
    RAISE EXCEPTION 'ENCOUNTER_SIDE_IDENTITY: a side keeps its encounter and order' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "encounter_sides_identity" BEFORE UPDATE ON "encounter_sides" FOR EACH ROW EXECUTE FUNCTION "encounter_sides_identity"();
CREATE FUNCTION "encounter_participants_release"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW."encounter_id" <> OLD."encounter_id" OR NEW."character_id" <> OLD."character_id" OR NEW."ruleset_release_id" <> OLD."ruleset_release_id") THEN
    RAISE EXCEPTION 'ENCOUNTER_PARTICIPANT_IDENTITY: a membership keeps its encounter, Character and Release' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "characters" c WHERE c."id" = NEW."character_id" AND c."ruleset_release_id" = NEW."ruleset_release_id") THEN
    RAISE EXCEPTION 'ENCOUNTER_PARTICIPANT_RELEASE: a Character joins only an encounter on its own exact Release' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "encounter_participants_release" BEFORE INSERT OR UPDATE ON "encounter_participants" FOR EACH ROW EXECUTE FUNCTION "encounter_participants_release"();
