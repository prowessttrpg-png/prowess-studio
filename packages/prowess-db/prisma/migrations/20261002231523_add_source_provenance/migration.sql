-- CreateEnum
CREATE TYPE "SourceDocumentType" AS ENUM ('DOCUMENT', 'WEB', 'OTHER');

-- CreateEnum
CREATE TYPE "SourceAuthorityStatus" AS ENUM ('GOVERNING', 'CURRENT_PRIMARY', 'CURRENT_SUPPLEMENTAL', 'PLAYTEST_REFERENCE', 'HISTORICAL', 'SUPERSEDED', 'REFERENCE_ONLY', 'UNRESOLVED');

-- CreateTable
CREATE TABLE "source_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" TEXT NOT NULL,
    "source_type" "SourceDocumentType" NOT NULL,
    "version_label" TEXT,
    "authority_status" "SourceAuthorityStatus",
    "file_reference" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_references" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source_document_id" UUID NOT NULL,
    "entity_version_id" UUID NOT NULL,
    "section_label" TEXT,
    "page_reference" TEXT,
    "source_excerpt_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_references_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "source_references_source_document_id_idx" ON "source_references"("source_document_id");

-- CreateIndex
CREATE INDEX "source_references_entity_version_id_idx" ON "source_references"("entity_version_id");

-- AddForeignKey
ALTER TABLE "source_references" ADD CONSTRAINT "source_references_source_document_id_fkey" FOREIGN KEY ("source_document_id") REFERENCES "source_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_references" ADD CONSTRAINT "source_references_entity_version_id_fkey" FOREIGN KEY ("entity_version_id") REFERENCES "entity_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
