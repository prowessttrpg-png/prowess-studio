-- CreateTable
CREATE TABLE "ruleset_manifests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ruleset_id" UUID NOT NULL,
    "manifest_version" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ruleset_manifests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ruleset_manifest_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "manifest_id" UUID NOT NULL,
    "entity_id" UUID NOT NULL,
    "entity_version_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ruleset_manifest_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "entity_versions_id_entity_id_key" ON "entity_versions"("id", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "ruleset_manifests_ruleset_id_manifest_version_key" ON "ruleset_manifests"("ruleset_id", "manifest_version");

-- CreateIndex
CREATE INDEX "ruleset_manifest_entries_entity_version_id_idx" ON "ruleset_manifest_entries"("entity_version_id");

-- CreateIndex
CREATE INDEX "ruleset_manifest_entries_entity_id_idx" ON "ruleset_manifest_entries"("entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "ruleset_manifest_entries_manifest_id_entity_id_key" ON "ruleset_manifest_entries"("manifest_id", "entity_id");

-- AddForeignKey
ALTER TABLE "ruleset_manifests" ADD CONSTRAINT "ruleset_manifests_ruleset_id_fkey" FOREIGN KEY ("ruleset_id") REFERENCES "rulesets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ruleset_manifest_entries" ADD CONSTRAINT "ruleset_manifest_entries_manifest_id_fkey" FOREIGN KEY ("manifest_id") REFERENCES "ruleset_manifests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ruleset_manifest_entries" ADD CONSTRAINT "ruleset_manifest_entries_entity_version_id_entity_id_fkey" FOREIGN KEY ("entity_version_id", "entity_id") REFERENCES "entity_versions"("id", "entity_id") ON DELETE RESTRICT ON UPDATE CASCADE;
