-- CreateEnum
CREATE TYPE "RelationshipType" AS ENUM ('REQUIRES', 'MODIFIES', 'USES', 'COMPATIBLE_WITH', 'INCOMPATIBLE_WITH', 'PART_OF', 'BELONGS_TO', 'SEE_ALSO');

-- CreateTable
CREATE TABLE "entity_relationships" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source_entity_id" UUID NOT NULL,
    "target_entity_id" UUID NOT NULL,
    "relationship_type" "RelationshipType" NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entity_relationships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "entity_relationships_source_entity_id_idx" ON "entity_relationships"("source_entity_id");

-- CreateIndex
CREATE INDEX "entity_relationships_target_entity_id_idx" ON "entity_relationships"("target_entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "entity_relationships_source_target_type_key" ON "entity_relationships"("source_entity_id", "target_entity_id", "relationship_type");

-- AddForeignKey
ALTER TABLE "entity_relationships" ADD CONSTRAINT "entity_relationships_source_entity_id_fkey" FOREIGN KEY ("source_entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_relationships" ADD CONSTRAINT "entity_relationships_target_entity_id_fkey" FOREIGN KEY ("target_entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
