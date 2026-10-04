-- CreateEnum
CREATE TYPE "KeywordAssignmentSource" AS ENUM ('AUTHORED', 'INHERITED', 'CALCULATED');

-- CreateTable
CREATE TABLE "keyword_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "canonical_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "keyword_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "keyword_definitions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "canonical_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category_id" UUID,
    "description" TEXT,
    "deprecated" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "keyword_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity_keywords" (
    "entity_id" UUID NOT NULL,
    "keyword_id" UUID NOT NULL,
    "source_type" "KeywordAssignmentSource" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entity_keywords_pkey" PRIMARY KEY ("entity_id","keyword_id")
);

-- CreateTable
CREATE TABLE "entity_version_keywords" (
    "entity_version_id" UUID NOT NULL,
    "keyword_id" UUID NOT NULL,
    "source_type" "KeywordAssignmentSource" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entity_version_keywords_pkey" PRIMARY KEY ("entity_version_id","keyword_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "keyword_categories_canonical_key_key" ON "keyword_categories"("canonical_key");

-- CreateIndex
CREATE UNIQUE INDEX "keyword_definitions_canonical_key_key" ON "keyword_definitions"("canonical_key");

-- CreateIndex
CREATE INDEX "keyword_definitions_category_id_idx" ON "keyword_definitions"("category_id");

-- CreateIndex
CREATE INDEX "entity_keywords_keyword_id_idx" ON "entity_keywords"("keyword_id");

-- CreateIndex
CREATE INDEX "entity_version_keywords_keyword_id_idx" ON "entity_version_keywords"("keyword_id");

-- AddForeignKey
ALTER TABLE "keyword_definitions" ADD CONSTRAINT "keyword_definitions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "keyword_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_keywords" ADD CONSTRAINT "entity_keywords_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_keywords" ADD CONSTRAINT "entity_keywords_keyword_id_fkey" FOREIGN KEY ("keyword_id") REFERENCES "keyword_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_version_keywords" ADD CONSTRAINT "entity_version_keywords_entity_version_id_fkey" FOREIGN KEY ("entity_version_id") REFERENCES "entity_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_version_keywords" ADD CONSTRAINT "entity_version_keywords_keyword_id_fkey" FOREIGN KEY ("keyword_id") REFERENCES "keyword_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
