-- M3-WO1: Source Document & Source Structure Foundation.
-- Additive only: four enums, eight insert-only tables, four NULLABLE locator columns on source_references.
-- No existing column, constraint or row is altered or removed: every M1/M2 row stays valid as-is.

-- CreateEnum
CREATE TYPE "SourceBlockType" AS ENUM ('HEADING', 'PARAGRAPH', 'LIST_ITEM', 'CAPTION', 'PREFORMATTED', 'OTHER');

-- CreateEnum
CREATE TYPE "SourceContentNodeType" AS ENUM ('BLOCK', 'TABLE', 'ASSET_PLACEMENT');

-- CreateEnum
CREATE TYPE "SourceAssetType" AS ENUM ('IMAGE', 'EMBEDDED_OBJECT', 'OTHER');

-- CreateEnum
CREATE TYPE "SourcePageLocationBasis" AS ENUM ('SOURCE_NATIVE', 'UNAVAILABLE');

-- AlterTable
ALTER TABLE "source_references" ADD COLUMN     "source_block_id" UUID,
ADD COLUMN     "source_section_id" UUID,
ADD COLUMN     "source_snapshot_id" UUID,
ADD COLUMN     "source_table_id" UUID;

-- CreateTable
CREATE TABLE "source_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source_document_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "original_filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "page_count" INTEGER,
    "declared_version" TEXT,
    "declared_draft_state" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_snapshot_ingestions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source_snapshot_id" UUID NOT NULL,
    "parser_name" TEXT NOT NULL,
    "parser_version" TEXT NOT NULL,
    "structure_hash" TEXT NOT NULL,
    "section_count" INTEGER NOT NULL,
    "node_count" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_snapshot_ingestions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_sections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source_snapshot_id" UUID NOT NULL,
    "parent_section_id" UUID,
    "title" TEXT NOT NULL,
    "heading_level" INTEGER NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "start_page" INTEGER,
    "end_page" INTEGER,
    "page_location_basis" "SourcePageLocationBasis" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_blocks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source_snapshot_id" UUID NOT NULL,
    "source_section_id" UUID,
    "block_type" "SourceBlockType" NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "raw_text" TEXT NOT NULL,
    "normalized_text" TEXT,
    "source_style" TEXT,
    "list_level" INTEGER,
    "list_ordered" BOOLEAN,
    "page_start" INTEGER,
    "page_end" INTEGER,
    "page_location_basis" "SourcePageLocationBasis" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_tables" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source_snapshot_id" UUID NOT NULL,
    "source_section_id" UUID,
    "ordinal" INTEGER NOT NULL,
    "caption" TEXT,
    "page_start" INTEGER,
    "page_end" INTEGER,
    "page_location_basis" "SourcePageLocationBasis" NOT NULL,
    "structure_json" JSONB NOT NULL,
    "raw_text" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_assets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source_snapshot_id" UUID NOT NULL,
    "asset_type" "SourceAssetType" NOT NULL,
    "mime_type" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "source_filename" TEXT,
    "caption" TEXT,
    "alt_text_from_source" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_asset_placements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source_snapshot_id" UUID NOT NULL,
    "source_asset_id" UUID NOT NULL,
    "source_section_id" UUID,
    "ordinal" INTEGER NOT NULL,
    "page_number" INTEGER,
    "page_location_basis" "SourcePageLocationBasis" NOT NULL,
    "alt_text_from_source" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_asset_placements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_content_nodes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source_snapshot_id" UUID NOT NULL,
    "source_section_id" UUID,
    "ordinal" INTEGER NOT NULL,
    "node_type" "SourceContentNodeType" NOT NULL,
    "block_id" UUID,
    "table_id" UUID,
    "asset_placement_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_content_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "source_snapshots_document_content_hash_key" ON "source_snapshots"("source_document_id", "content_hash");

-- CreateIndex
CREATE UNIQUE INDEX "source_snapshots_id_document_key" ON "source_snapshots"("id", "source_document_id");

-- CreateIndex
CREATE UNIQUE INDEX "source_snapshot_ingestions_snapshot_key" ON "source_snapshot_ingestions"("source_snapshot_id");

-- CreateIndex
CREATE INDEX "source_sections_parent_section_id_idx" ON "source_sections"("parent_section_id");

-- CreateIndex
CREATE UNIQUE INDEX "source_sections_id_snapshot_key" ON "source_sections"("id", "source_snapshot_id");

-- CreateIndex
CREATE UNIQUE INDEX "source_sections_snapshot_ordinal_key" ON "source_sections"("source_snapshot_id", "ordinal");

-- CreateIndex
CREATE INDEX "source_blocks_source_section_id_idx" ON "source_blocks"("source_section_id");

-- CreateIndex
CREATE UNIQUE INDEX "source_blocks_id_snapshot_key" ON "source_blocks"("id", "source_snapshot_id");

-- CreateIndex
CREATE UNIQUE INDEX "source_blocks_snapshot_ordinal_key" ON "source_blocks"("source_snapshot_id", "ordinal");

-- CreateIndex
CREATE INDEX "source_tables_source_section_id_idx" ON "source_tables"("source_section_id");

-- CreateIndex
CREATE UNIQUE INDEX "source_tables_id_snapshot_key" ON "source_tables"("id", "source_snapshot_id");

-- CreateIndex
CREATE UNIQUE INDEX "source_tables_snapshot_ordinal_key" ON "source_tables"("source_snapshot_id", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "source_assets_id_snapshot_key" ON "source_assets"("id", "source_snapshot_id");

-- CreateIndex
CREATE UNIQUE INDEX "source_assets_snapshot_content_hash_key" ON "source_assets"("source_snapshot_id", "content_hash");

-- CreateIndex
CREATE INDEX "source_asset_placements_source_asset_id_idx" ON "source_asset_placements"("source_asset_id");

-- CreateIndex
CREATE INDEX "source_asset_placements_source_section_id_idx" ON "source_asset_placements"("source_section_id");

-- CreateIndex
CREATE UNIQUE INDEX "source_asset_placements_id_snapshot_key" ON "source_asset_placements"("id", "source_snapshot_id");

-- CreateIndex
CREATE UNIQUE INDEX "source_asset_placements_snapshot_ordinal_key" ON "source_asset_placements"("source_snapshot_id", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "source_content_nodes_block_key" ON "source_content_nodes"("block_id");

-- CreateIndex
CREATE UNIQUE INDEX "source_content_nodes_table_key" ON "source_content_nodes"("table_id");

-- CreateIndex
CREATE UNIQUE INDEX "source_content_nodes_asset_placement_key" ON "source_content_nodes"("asset_placement_id");

-- CreateIndex
CREATE INDEX "source_content_nodes_source_section_id_idx" ON "source_content_nodes"("source_section_id");

-- CreateIndex
CREATE UNIQUE INDEX "source_content_nodes_snapshot_ordinal_key" ON "source_content_nodes"("source_snapshot_id", "ordinal");

-- CreateIndex
CREATE INDEX "source_references_source_snapshot_id_idx" ON "source_references"("source_snapshot_id");

-- CreateIndex
CREATE INDEX "source_references_source_section_id_idx" ON "source_references"("source_section_id");

-- CreateIndex
CREATE INDEX "source_references_source_block_id_idx" ON "source_references"("source_block_id");

-- CreateIndex
CREATE INDEX "source_references_source_table_id_idx" ON "source_references"("source_table_id");

-- AddForeignKey
ALTER TABLE "source_references" ADD CONSTRAINT "source_references_snapshot_fkey" FOREIGN KEY ("source_snapshot_id", "source_document_id") REFERENCES "source_snapshots"("id", "source_document_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_references" ADD CONSTRAINT "source_references_section_fkey" FOREIGN KEY ("source_section_id", "source_snapshot_id") REFERENCES "source_sections"("id", "source_snapshot_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_references" ADD CONSTRAINT "source_references_block_fkey" FOREIGN KEY ("source_block_id", "source_snapshot_id") REFERENCES "source_blocks"("id", "source_snapshot_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_references" ADD CONSTRAINT "source_references_table_fkey" FOREIGN KEY ("source_table_id", "source_snapshot_id") REFERENCES "source_tables"("id", "source_snapshot_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_snapshots" ADD CONSTRAINT "source_snapshots_document_fkey" FOREIGN KEY ("source_document_id") REFERENCES "source_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_snapshot_ingestions" ADD CONSTRAINT "source_snapshot_ingestions_snapshot_fkey" FOREIGN KEY ("source_snapshot_id") REFERENCES "source_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_sections" ADD CONSTRAINT "source_sections_snapshot_fkey" FOREIGN KEY ("source_snapshot_id") REFERENCES "source_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_sections" ADD CONSTRAINT "source_sections_parent_fkey" FOREIGN KEY ("parent_section_id", "source_snapshot_id") REFERENCES "source_sections"("id", "source_snapshot_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_blocks" ADD CONSTRAINT "source_blocks_snapshot_fkey" FOREIGN KEY ("source_snapshot_id") REFERENCES "source_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_blocks" ADD CONSTRAINT "source_blocks_section_fkey" FOREIGN KEY ("source_section_id", "source_snapshot_id") REFERENCES "source_sections"("id", "source_snapshot_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_tables" ADD CONSTRAINT "source_tables_snapshot_fkey" FOREIGN KEY ("source_snapshot_id") REFERENCES "source_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_tables" ADD CONSTRAINT "source_tables_section_fkey" FOREIGN KEY ("source_section_id", "source_snapshot_id") REFERENCES "source_sections"("id", "source_snapshot_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_assets" ADD CONSTRAINT "source_assets_snapshot_fkey" FOREIGN KEY ("source_snapshot_id") REFERENCES "source_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_asset_placements" ADD CONSTRAINT "source_asset_placements_snapshot_fkey" FOREIGN KEY ("source_snapshot_id") REFERENCES "source_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_asset_placements" ADD CONSTRAINT "source_asset_placements_asset_fkey" FOREIGN KEY ("source_asset_id", "source_snapshot_id") REFERENCES "source_assets"("id", "source_snapshot_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_asset_placements" ADD CONSTRAINT "source_asset_placements_section_fkey" FOREIGN KEY ("source_section_id", "source_snapshot_id") REFERENCES "source_sections"("id", "source_snapshot_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_content_nodes" ADD CONSTRAINT "source_content_nodes_snapshot_fkey" FOREIGN KEY ("source_snapshot_id") REFERENCES "source_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_content_nodes" ADD CONSTRAINT "source_content_nodes_section_fkey" FOREIGN KEY ("source_section_id", "source_snapshot_id") REFERENCES "source_sections"("id", "source_snapshot_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_content_nodes" ADD CONSTRAINT "source_content_nodes_block_fkey" FOREIGN KEY ("block_id", "source_snapshot_id") REFERENCES "source_blocks"("id", "source_snapshot_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_content_nodes" ADD CONSTRAINT "source_content_nodes_table_fkey" FOREIGN KEY ("table_id", "source_snapshot_id") REFERENCES "source_tables"("id", "source_snapshot_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_content_nodes" ADD CONSTRAINT "source_content_nodes_asset_placement_fkey" FOREIGN KEY ("asset_placement_id", "source_snapshot_id") REFERENCES "source_asset_placements"("id", "source_snapshot_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK constraints (Prisma does not model CHECK constraints, so they are invisible to schema.prisma and to the
-- drift check by design, and they are pinned instead by the M3 static audit). They make the remaining invariants
-- database-enforced rather than service-only:

-- A content node targets EXACTLY one thing, and it is the thing its node_type names.
ALTER TABLE "source_content_nodes" ADD CONSTRAINT "source_content_nodes_exactly_one_target_check" CHECK (
    ("node_type" = 'BLOCK'           AND "block_id" IS NOT NULL AND "table_id" IS NULL     AND "asset_placement_id" IS NULL)
 OR ("node_type" = 'TABLE'           AND "block_id" IS NULL     AND "table_id" IS NOT NULL AND "asset_placement_id" IS NULL)
 OR ("node_type" = 'ASSET_PLACEMENT' AND "block_id" IS NULL     AND "table_id" IS NULL     AND "asset_placement_id" IS NOT NULL)
);

-- A finer structural locator on a SourceReference requires its Snapshot, so the composite (MATCH SIMPLE) keys
-- above can never be skipped by leaving source_snapshot_id NULL.
ALTER TABLE "source_references" ADD CONSTRAINT "source_references_locator_requires_snapshot_check" CHECK (
    "source_snapshot_id" IS NOT NULL
 OR ("source_section_id" IS NULL AND "source_block_id" IS NULL AND "source_table_id" IS NULL)
);

-- Ordinals are derived structural order: non-negative.
ALTER TABLE "source_sections" ADD CONSTRAINT "source_sections_ordinal_check" CHECK ("ordinal" >= 0 AND "heading_level" >= 1);
ALTER TABLE "source_blocks" ADD CONSTRAINT "source_blocks_ordinal_check" CHECK ("ordinal" >= 0);
ALTER TABLE "source_tables" ADD CONSTRAINT "source_tables_ordinal_check" CHECK ("ordinal" >= 0);
ALTER TABLE "source_asset_placements" ADD CONSTRAINT "source_asset_placements_ordinal_check" CHECK ("ordinal" >= 0);
ALTER TABLE "source_content_nodes" ADD CONSTRAINT "source_content_nodes_ordinal_check" CHECK ("ordinal" >= 0);

-- Page numbers are never invented: UNAVAILABLE means every page field is NULL.
ALTER TABLE "source_sections" ADD CONSTRAINT "source_sections_page_location_check" CHECK ("page_location_basis" = 'SOURCE_NATIVE' OR ("start_page" IS NULL AND "end_page" IS NULL));
ALTER TABLE "source_blocks" ADD CONSTRAINT "source_blocks_page_location_check" CHECK ("page_location_basis" = 'SOURCE_NATIVE' OR ("page_start" IS NULL AND "page_end" IS NULL));
ALTER TABLE "source_tables" ADD CONSTRAINT "source_tables_page_location_check" CHECK ("page_location_basis" = 'SOURCE_NATIVE' OR ("page_start" IS NULL AND "page_end" IS NULL));
ALTER TABLE "source_asset_placements" ADD CONSTRAINT "source_asset_placements_page_location_check" CHECK ("page_location_basis" = 'SOURCE_NATIVE' OR "page_number" IS NULL);
