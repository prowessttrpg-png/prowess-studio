-- AlterTable
ALTER TABLE "ruleset_manifests" ADD COLUMN     "parent_manifest_id" UUID;

-- CreateIndex
CREATE INDEX "ruleset_manifests_parent_manifest_id_idx" ON "ruleset_manifests"("parent_manifest_id");

-- AddForeignKey
ALTER TABLE "ruleset_manifests" ADD CONSTRAINT "ruleset_manifests_parent_manifest_id_fkey" FOREIGN KEY ("parent_manifest_id") REFERENCES "ruleset_manifests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
