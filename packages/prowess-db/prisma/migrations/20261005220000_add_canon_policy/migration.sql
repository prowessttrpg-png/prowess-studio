-- CreateTable
CREATE TABLE "canon_policies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ruleset_id" UUID NOT NULL,
    "policy_version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "canon_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_authority_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "canon_policy_id" UUID NOT NULL,
    "source_document_id" UUID NOT NULL,
    "scope_key" TEXT NOT NULL,
    "authority_status" "SourceAuthorityStatus" NOT NULL,
    "rationale" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_authority_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "canon_policies_ruleset_id_policy_version_key" ON "canon_policies"("ruleset_id", "policy_version");

-- CreateIndex
CREATE INDEX "source_authority_records_source_document_id_idx" ON "source_authority_records"("source_document_id");

-- CreateIndex
CREATE UNIQUE INDEX "source_authority_records_policy_source_scope_key" ON "source_authority_records"("canon_policy_id", "source_document_id", "scope_key");

-- AddForeignKey
ALTER TABLE "canon_policies" ADD CONSTRAINT "canon_policies_ruleset_id_fkey" FOREIGN KEY ("ruleset_id") REFERENCES "rulesets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_authority_records" ADD CONSTRAINT "source_authority_records_canon_policy_id_fkey" FOREIGN KEY ("canon_policy_id") REFERENCES "canon_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_authority_records" ADD CONSTRAINT "source_authority_records_source_document_id_fkey" FOREIGN KEY ("source_document_id") REFERENCES "source_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
