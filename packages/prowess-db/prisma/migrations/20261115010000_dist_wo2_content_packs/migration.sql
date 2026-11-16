-- CreateTable
CREATE TABLE "content_pack_receipts" (
    "content_digest" CHAR(64) NOT NULL,
    "archive_sha256" CHAR(64) NOT NULL,
    "producer_id" UUID NOT NULL,
    "release_id" UUID NOT NULL,
    "manifest" JSONB NOT NULL,
    "installed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_pack_receipts_pkey" PRIMARY KEY ("content_digest")
);

-- CreateTable
CREATE TABLE "content_pack_ownership" (
    "kind" TEXT NOT NULL,
    "identity" TEXT NOT NULL,
    "content_digest" CHAR(64) NOT NULL,

    CONSTRAINT "content_pack_ownership_pkey" PRIMARY KEY ("kind","identity")
);

-- CreateTable
CREATE TABLE "content_pack_source_locations" (
    "id" UUID NOT NULL,
    "source_document_id" UUID NOT NULL,
    "snapshot_id" UUID NOT NULL,
    "content_hash" CHAR(64) NOT NULL,
    "section_id" UUID,
    "block_id" UUID,
    "table_id" UUID,

    CONSTRAINT "content_pack_source_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_pack_assets" (
    "sha256" CHAR(64) NOT NULL,
    "media_type" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,

    CONSTRAINT "content_pack_assets_pkey" PRIMARY KEY ("sha256")
);

-- CreateIndex
CREATE UNIQUE INDEX "content_pack_receipts_release_id_key" ON "content_pack_receipts"("release_id");

-- CreateIndex
CREATE INDEX "content_pack_ownership_content_digest_idx" ON "content_pack_ownership"("content_digest");

-- AddForeignKey
ALTER TABLE "content_pack_receipts" ADD CONSTRAINT "content_pack_receipts_release_id_fkey" FOREIGN KEY ("release_id") REFERENCES "ruleset_releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_pack_ownership" ADD CONSTRAINT "content_pack_ownership_content_digest_fkey" FOREIGN KEY ("content_digest") REFERENCES "content_pack_receipts"("content_digest") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_pack_source_locations" ADD CONSTRAINT "content_pack_source_locations_id_fkey" FOREIGN KEY ("id") REFERENCES "source_references"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Keep imported original records and their owned lineage read-only across all write paths.
-- Only the atomic transfer and validated whole-workspace restore set this transaction-local mode.
CREATE FUNCTION guard_content_pack_owned_record() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  entry jsonb;
  previous jsonb;
  identity_key text;
  association text;
BEGIN
  IF current_setting('prowess.content_pack_transfer', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP <> 'INSERT' THEN
    previous := to_jsonb(OLD);
    SELECT string_agg(previous ->> col, ':' ORDER BY ordinal) INTO identity_key
      FROM unnest(string_to_array(TG_ARGV[1], ',')) WITH ORDINALITY AS cols(col, ordinal);
    IF EXISTS (SELECT 1 FROM content_pack_ownership WHERE kind = TG_ARGV[0] AND identity = identity_key) THEN
      RAISE EXCEPTION 'Imported content is read-only (%)', TG_ARGV[0] USING ERRCODE = '23514', CONSTRAINT = 'content_pack_owned_record';
    END IF;
  END IF;

  IF TG_NARGS > 2 THEN
    IF TG_OP = 'INSERT' THEN entry := to_jsonb(NEW); ELSE entry := previous; END IF;
    FOR idx IN 2..TG_NARGS - 1 LOOP
      association := TG_ARGV[idx];
      identity_key := entry ->> split_part(association, ':', 2);
      IF EXISTS (SELECT 1 FROM content_pack_ownership WHERE kind = split_part(association, ':', 1) AND identity = identity_key) THEN
        RAISE EXCEPTION 'Imported content lineage is read-only (%)', TG_ARGV[0] USING ERRCODE = '23514', CONSTRAINT = 'content_pack_owned_record';
      END IF;
      IF TG_OP = 'UPDATE' THEN
        identity_key := to_jsonb(NEW) ->> split_part(association, ':', 2);
        IF EXISTS (SELECT 1 FROM content_pack_ownership WHERE kind = split_part(association, ':', 1) AND identity = identity_key) THEN
          RAISE EXCEPTION 'Imported content lineage is read-only (%)', TG_ARGV[0] USING ERRCODE = '23514', CONSTRAINT = 'content_pack_owned_record';
        END IF;
      END IF;
    END LOOP;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "content_pack_read_only" BEFORE INSERT OR UPDATE OR DELETE ON "rulesets"
  FOR EACH ROW EXECUTE FUNCTION guard_content_pack_owned_record('rulesets', 'id', 'rulesets:parent_ruleset_id');
CREATE TRIGGER "content_pack_read_only" BEFORE INSERT OR UPDATE OR DELETE ON "entities"
  FOR EACH ROW EXECUTE FUNCTION guard_content_pack_owned_record('entities', 'id');
CREATE TRIGGER "content_pack_read_only" BEFORE INSERT OR UPDATE OR DELETE ON "keyword_categories"
  FOR EACH ROW EXECUTE FUNCTION guard_content_pack_owned_record('keyword-categories', 'id');
CREATE TRIGGER "content_pack_read_only" BEFORE INSERT OR UPDATE OR DELETE ON "keyword_definitions"
  FOR EACH ROW EXECUTE FUNCTION guard_content_pack_owned_record('keyword-definitions', 'id');
CREATE TRIGGER "content_pack_read_only" BEFORE INSERT OR UPDATE OR DELETE ON "entity_versions"
  FOR EACH ROW EXECUTE FUNCTION guard_content_pack_owned_record('entity-versions', 'id', 'entities:entity_id');
CREATE TRIGGER "content_pack_read_only" BEFORE INSERT OR UPDATE OR DELETE ON "entity_aliases"
  FOR EACH ROW EXECUTE FUNCTION guard_content_pack_owned_record('aliases', 'id', 'entities:entity_id');
CREATE TRIGGER "content_pack_read_only" BEFORE INSERT OR UPDATE OR DELETE ON "entity_keywords"
  FOR EACH ROW EXECUTE FUNCTION guard_content_pack_owned_record('entity-keywords', 'entity_id,keyword_id', 'entities:entity_id');
CREATE TRIGGER "content_pack_read_only" BEFORE INSERT OR UPDATE OR DELETE ON "entity_version_keywords"
  FOR EACH ROW EXECUTE FUNCTION guard_content_pack_owned_record('entity-version-keywords', 'entity_version_id,keyword_id', 'entity-versions:entity_version_id');
CREATE TRIGGER "content_pack_read_only" BEFORE INSERT OR UPDATE OR DELETE ON "entity_relationships"
  FOR EACH ROW EXECUTE FUNCTION guard_content_pack_owned_record('relationships', 'id', 'entities:source_entity_id', 'entities:target_entity_id');
CREATE TRIGGER "content_pack_read_only" BEFORE INSERT OR UPDATE OR DELETE ON "source_documents"
  FOR EACH ROW EXECUTE FUNCTION guard_content_pack_owned_record('source-documents', 'id');
CREATE TRIGGER "content_pack_read_only" BEFORE INSERT OR UPDATE OR DELETE ON "source_references"
  FOR EACH ROW EXECUTE FUNCTION guard_content_pack_owned_record('source-references', 'id', 'entity-versions:entity_version_id');
CREATE TRIGGER "content_pack_read_only" BEFORE INSERT OR UPDATE OR DELETE ON "ruleset_manifests"
  FOR EACH ROW EXECUTE FUNCTION guard_content_pack_owned_record('manifests', 'id', 'rulesets:ruleset_id');
CREATE TRIGGER "content_pack_read_only" BEFORE INSERT OR UPDATE OR DELETE ON "ruleset_manifest_entries"
  FOR EACH ROW EXECUTE FUNCTION guard_content_pack_owned_record('manifest-entries', 'id', 'manifests:manifest_id');
CREATE TRIGGER "content_pack_read_only" BEFORE INSERT OR UPDATE OR DELETE ON "canon_policies"
  FOR EACH ROW EXECUTE FUNCTION guard_content_pack_owned_record('canon-policies', 'id', 'rulesets:ruleset_id');
CREATE TRIGGER "content_pack_read_only" BEFORE INSERT OR UPDATE OR DELETE ON "source_authority_records"
  FOR EACH ROW EXECUTE FUNCTION guard_content_pack_owned_record('source-authorities', 'id', 'canon-policies:canon_policy_id');
CREATE TRIGGER "content_pack_read_only" BEFORE INSERT OR UPDATE OR DELETE ON "rule_conflicts"
  FOR EACH ROW EXECUTE FUNCTION guard_content_pack_owned_record('rule-conflicts', 'id', 'rulesets:ruleset_id', 'entities:entity_id');
CREATE TRIGGER "content_pack_read_only" BEFORE INSERT OR UPDATE OR DELETE ON "rule_conflict_candidates"
  FOR EACH ROW EXECUTE FUNCTION guard_content_pack_owned_record('rule-conflict-candidates', 'id', 'rule-conflicts:rule_conflict_id');
CREATE TRIGGER "content_pack_read_only" BEFORE INSERT OR UPDATE OR DELETE ON "canon_decisions"
  FOR EACH ROW EXECUTE FUNCTION guard_content_pack_owned_record('canon-decisions', 'id', 'rule-conflicts:rule_conflict_id');
CREATE TRIGGER "content_pack_read_only" BEFORE INSERT OR UPDATE OR DELETE ON "canon_decision_selections"
  FOR EACH ROW EXECUTE FUNCTION guard_content_pack_owned_record('canon-decision-selections', 'id', 'canon-decisions:canon_decision_id');
CREATE TRIGGER "content_pack_read_only" BEFORE INSERT OR UPDATE OR DELETE ON "change_sets"
  FOR EACH ROW EXECUTE FUNCTION guard_content_pack_owned_record('change-sets', 'id', 'rulesets:ruleset_id');
CREATE TRIGGER "content_pack_read_only" BEFORE INSERT OR UPDATE OR DELETE ON "change_set_operations"
  FOR EACH ROW EXECUTE FUNCTION guard_content_pack_owned_record('change-set-operations', 'id', 'change-sets:change_set_id');
CREATE TRIGGER "content_pack_read_only" BEFORE INSERT OR UPDATE OR DELETE ON "ruleset_releases"
  FOR EACH ROW EXECUTE FUNCTION guard_content_pack_owned_record('releases', 'id', 'rulesets:ruleset_id');
