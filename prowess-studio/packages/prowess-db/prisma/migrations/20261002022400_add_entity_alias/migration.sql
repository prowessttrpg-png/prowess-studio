-- CreateTable
CREATE TABLE "entity_aliases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entity_id" UUID NOT NULL,
    "alias" TEXT NOT NULL,
    "normalized_alias" TEXT NOT NULL,
    "context" TEXT,
    "normalized_context" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entity_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "entity_aliases_normalized_alias_idx" ON "entity_aliases"("normalized_alias");

-- CreateIndex
CREATE UNIQUE INDEX "entity_aliases_entity_alias_context_key" ON "entity_aliases"("entity_id", "normalized_alias", "normalized_context");

-- AddForeignKey
ALTER TABLE "entity_aliases" ADD CONSTRAINT "entity_aliases_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
