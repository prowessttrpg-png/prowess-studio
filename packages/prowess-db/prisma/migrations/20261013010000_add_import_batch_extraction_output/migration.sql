-- M3-WO3: Structural Segmentation & Automated Extraction.
-- Additive only: two NULLABLE extraction workflow columns on import_batches and three CHECK constraints.
-- No table is created, and no existing column, constraint or row is altered or removed.

-- AlterTable
ALTER TABLE "import_batches" ADD COLUMN     "extracted_at" TIMESTAMPTZ(6),
ADD COLUMN     "extraction_output_hash" TEXT;

-- CHECK constraints (Prisma does not model CHECK constraints, so they are pinned by the M3 static audit):

-- The output hash and the extraction timestamp are written together, exactly once.
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_extraction_output_pair_check" CHECK (
    ("extraction_output_hash" IS NULL AND "extracted_at" IS NULL)
 OR ("extraction_output_hash" IS NOT NULL AND "extracted_at" IS NOT NULL)
);

-- The output hash is a lowercase SHA-256 hex digest.
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_extraction_output_hash_format_check" CHECK (
    "extraction_output_hash" IS NULL OR "extraction_output_hash" ~ '^[0-9a-f]{64}$'
);

-- A Batch can never falsely appear extracted: no output before READY_FOR_REVIEW, always an output from it on.
-- FAILED and CANCELLED are left open (reserved for later Work Orders, which may reach them either way).
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_extraction_status_check" CHECK (
    ("status" IN ('CREATED', 'EXTRACTING') AND "extraction_output_hash" IS NULL)
 OR ("status" IN ('READY_FOR_REVIEW', 'REVIEWING', 'COMPLETED') AND "extraction_output_hash" IS NOT NULL)
 OR "status" IN ('FAILED', 'CANCELLED')
);
