-- CreateTable
CREATE TABLE "ruleset_releases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ruleset_id" UUID NOT NULL,
    "release_number" INTEGER NOT NULL,
    "version_label" TEXT NOT NULL,
    "channel" "RulesetChannel" NOT NULL,
    "manifest_id" UUID NOT NULL,
    "canon_policy_id" UUID NOT NULL,
    "change_set_id" UUID,
    "manifest_hash" TEXT NOT NULL,
    "release_notes" TEXT,
    "published_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ruleset_releases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ruleset_releases_manifest_id_idx" ON "ruleset_releases"("manifest_id");

-- CreateIndex
CREATE INDEX "ruleset_releases_canon_policy_id_idx" ON "ruleset_releases"("canon_policy_id");

-- CreateIndex
CREATE UNIQUE INDEX "ruleset_releases_ruleset_id_release_number_key" ON "ruleset_releases"("ruleset_id", "release_number");

-- CreateIndex
CREATE UNIQUE INDEX "ruleset_releases_ruleset_id_version_label_key" ON "ruleset_releases"("ruleset_id", "version_label");

-- CreateIndex
CREATE UNIQUE INDEX "ruleset_releases_change_set_id_key" ON "ruleset_releases"("change_set_id");

-- AddForeignKey
ALTER TABLE "ruleset_releases" ADD CONSTRAINT "ruleset_releases_ruleset_id_fkey" FOREIGN KEY ("ruleset_id") REFERENCES "rulesets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ruleset_releases" ADD CONSTRAINT "ruleset_releases_manifest_fkey" FOREIGN KEY ("manifest_id", "ruleset_id") REFERENCES "ruleset_manifests"("id", "ruleset_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ruleset_releases" ADD CONSTRAINT "ruleset_releases_policy_fkey" FOREIGN KEY ("canon_policy_id", "ruleset_id") REFERENCES "canon_policies"("id", "ruleset_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ruleset_releases" ADD CONSTRAINT "ruleset_releases_change_set_fkey" FOREIGN KEY ("change_set_id", "ruleset_id") REFERENCES "change_sets"("id", "ruleset_id") ON DELETE RESTRICT ON UPDATE CASCADE;
