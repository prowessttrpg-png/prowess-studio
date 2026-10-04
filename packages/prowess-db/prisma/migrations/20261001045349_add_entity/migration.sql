-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('GENERIC_RULE', 'SYSTEM', 'RESOURCE', 'SPELL_EFFECT', 'SPELL_TRAIT', 'TARGETING', 'KEYWORD');

-- CreateTable
CREATE TABLE "entities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entity_type" "EntityType" NOT NULL,
    "canonical_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "entities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "entities_canonical_key_key" ON "entities"("canonical_key");
