-- M6-WO10: Character Play Workspace — one runtime row per Character and an append-only gameplay event ledger.
-- Additive only: no existing table, row, Release or Ability revision is rewritten. Current resource values stay in
-- character_resource_states (one authority); this migration adds only the runtime-only state and the ledger.

CREATE TABLE "character_play_runtimes" (
    "character_id" UUID NOT NULL,
    "ruleset_release_id" UUID NOT NULL,
    "state" JSONB NOT NULL,
    "lock_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "character_play_runtimes_pkey" PRIMARY KEY ("character_id")
);

CREATE TABLE "character_play_events" (
    "id" UUID NOT NULL,
    "character_id" UUID NOT NULL,
    "ruleset_release_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "idempotency_key" UUID NOT NULL,
    "request_hash" TEXT NOT NULL,
    "operation_kind" TEXT NOT NULL,
    "classification" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "runtime_version" INTEGER NOT NULL,
    "play_state_version" INTEGER NOT NULL,
    "record" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "character_play_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "character_play_runtimes_ruleset_release_id_idx" ON "character_play_runtimes"("ruleset_release_id");

CREATE UNIQUE INDEX "character_play_events_character_sequence_key" ON "character_play_events"("character_id", "sequence");

CREATE UNIQUE INDEX "character_play_events_character_idempotency_key" ON "character_play_events"("character_id", "idempotency_key");

CREATE INDEX "character_play_events_ruleset_release_id_idx" ON "character_play_events"("ruleset_release_id");

ALTER TABLE "character_play_runtimes" ADD CONSTRAINT "character_play_runtimes_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "character_play_runtimes" ADD CONSTRAINT "character_play_runtimes_ruleset_release_id_fkey" FOREIGN KEY ("ruleset_release_id") REFERENCES "ruleset_releases"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "character_play_events" ADD CONSTRAINT "character_play_events_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "character_play_runtimes"("character_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "character_play_events" ADD CONSTRAINT "character_play_events_ruleset_release_id_fkey" FOREIGN KEY ("ruleset_release_id") REFERENCES "ruleset_releases"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Bounds: runtime versions and sequences count from 1 (play_state_version 0 = the sheet was never saved); the closed vocabularies; JSON objects only; bounded text.
ALTER TABLE "character_play_runtimes" ADD CONSTRAINT "character_play_runtimes_lock_version_check" CHECK ("lock_version" >= 1);
ALTER TABLE "character_play_runtimes" ADD CONSTRAINT "character_play_runtimes_state_check" CHECK (jsonb_typeof("state") = 'object');
ALTER TABLE "character_play_events" ADD CONSTRAINT "character_play_events_sequence_check" CHECK ("sequence" >= 1);
ALTER TABLE "character_play_events" ADD CONSTRAINT "character_play_events_versions_check" CHECK ("runtime_version" >= 1 AND "play_state_version" >= 0);
ALTER TABLE "character_play_events" ADD CONSTRAINT "character_play_events_record_check" CHECK (jsonb_typeof("record") = 'object');
ALTER TABLE "character_play_events" ADD CONSTRAINT "character_play_events_classification_check" CHECK ("classification" IN ('RULES_EXECUTED', 'MANUAL_ADJUSTMENT', 'REFERENCE_ONLY', 'NOTE'));
ALTER TABLE "character_play_events" ADD CONSTRAINT "character_play_events_operation_kind_check" CHECK ("operation_kind" IN ('TIMING', 'GENERAL_ACTION', 'MOVE', 'WEAPON_ATTACK', 'SPELL', 'MANEUVER', 'ACTIVE_MAGIC', 'MANUAL_ADJUSTMENT', 'NOTE', 'RECONCILE'));
ALTER TABLE "character_play_events" ADD CONSTRAINT "character_play_events_request_hash_check" CHECK ("request_hash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "character_play_events" ADD CONSTRAINT "character_play_events_summary_check" CHECK (char_length("summary") BETWEEN 1 AND 2000);

-- The ledger is append-only: a committed gameplay event is never edited or deleted (corrections are new events).
CREATE FUNCTION "character_play_events_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'CHARACTER_PLAY_EVENT_IMMUTABLE: committed gameplay events are append-only (%)', TG_OP USING ERRCODE = 'check_violation';
END;
$$;
CREATE TRIGGER "character_play_events_append_only" BEFORE UPDATE OR DELETE ON "character_play_events" FOR EACH ROW EXECUTE FUNCTION "character_play_events_append_only"();

-- An event belongs to the runtime's own Release.
CREATE FUNCTION "character_play_events_runtime_release"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "character_play_runtimes" r WHERE r."character_id" = NEW."character_id" AND r."ruleset_release_id" = NEW."ruleset_release_id") THEN
    RAISE EXCEPTION 'CHARACTER_PLAY_EVENT_RELEASE: an event is recorded under its runtime''s exact Release' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "character_play_events_runtime_release" BEFORE INSERT ON "character_play_events" FOR EACH ROW EXECUTE FUNCTION "character_play_events_runtime_release"();

-- A runtime keeps the Release it was created under (a Release change is a reconciliation, never a silent rewrite).
CREATE FUNCTION "character_play_runtimes_release_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."ruleset_release_id" <> OLD."ruleset_release_id" OR NEW."character_id" <> OLD."character_id" THEN
    RAISE EXCEPTION 'CHARACTER_PLAY_RUNTIME_IDENTITY: a play runtime keeps its Character and Release' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "character_play_runtimes_release_immutable" BEFORE UPDATE ON "character_play_runtimes" FOR EACH ROW EXECUTE FUNCTION "character_play_runtimes_release_immutable"();
