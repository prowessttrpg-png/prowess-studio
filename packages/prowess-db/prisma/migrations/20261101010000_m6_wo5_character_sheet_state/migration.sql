-- PAS-10 M6-WO5 — Digital Character Sheet state. Adds a Character's mutable play state (current resource values),
-- its player-written sheet text and its portrait (metadata + nondestructive framing, with the source bytes in their own
-- table). No existing table or row changes; maximums and every derived value stay unstored.

-- CreateTable
CREATE TABLE "character_play_states" (
    "character_id" UUID NOT NULL,
    "lock_version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "character_play_states_pkey" PRIMARY KEY ("character_id")
);

-- CreateTable
CREATE TABLE "character_resource_states" (
    "character_id" UUID NOT NULL,
    "resource_key" TEXT NOT NULL,
    "current" INTEGER NOT NULL,

    CONSTRAINT "character_resource_states_pkey" PRIMARY KEY ("character_id","resource_key")
);

-- CreateTable
CREATE TABLE "character_sheet_notes" (
    "character_id" UUID NOT NULL,
    "company_pac" TEXT,
    "action_notes" TEXT NOT NULL DEFAULT '',
    "character_notes" TEXT NOT NULL DEFAULT '',
    "possessions" JSONB NOT NULL DEFAULT '[]',
    "lock_version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "character_sheet_notes_pkey" PRIMARY KEY ("character_id")
);

-- CreateTable
CREATE TABLE "character_portraits" (
    "character_id" UUID NOT NULL,
    "mime_type" TEXT,
    "byte_size" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "content_hash" TEXT,
    "zoom" DOUBLE PRECISION NOT NULL,
    "offset_x" DOUBLE PRECISION NOT NULL,
    "offset_y" DOUBLE PRECISION NOT NULL,
    "lock_version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "character_portraits_pkey" PRIMARY KEY ("character_id")
);

-- CreateTable
CREATE TABLE "character_portrait_images" (
    "character_id" UUID NOT NULL,
    "bytes" BYTEA NOT NULL,

    CONSTRAINT "character_portrait_images_pkey" PRIMARY KEY ("character_id")
);

-- AddForeignKey
ALTER TABLE "character_play_states" ADD CONSTRAINT "character_play_states_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "character_resource_states" ADD CONSTRAINT "character_resource_states_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "character_play_states"("character_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "character_sheet_notes" ADD CONSTRAINT "character_sheet_notes_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "character_portraits" ADD CONSTRAINT "character_portraits_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "character_portrait_images" ADD CONSTRAINT "character_portrait_images_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "character_portraits"("character_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- CHECK constraints (not modelled by Prisma; invisible to schema.prisma and the drift check).
ALTER TABLE "character_play_states" ADD CONSTRAINT "character_play_states_lock_version_check" CHECK ("lock_version" >= 1);
ALTER TABLE "character_sheet_notes" ADD CONSTRAINT "character_sheet_notes_lock_version_check" CHECK ("lock_version" >= 1);
ALTER TABLE "character_sheet_notes" ADD CONSTRAINT "character_sheet_notes_possessions_array_check" CHECK (jsonb_typeof("possessions") = 'array');
ALTER TABLE "character_portraits" ADD CONSTRAINT "character_portraits_lock_version_check" CHECK ("lock_version" >= 1);
-- The framing is nondestructive and bounded: zoom ≥ 1 (1 = the whole frame covered), offsets are fractions of the pan
-- range on each axis.
ALTER TABLE "character_portraits" ADD CONSTRAINT "character_portraits_framing_check" CHECK ("zoom" >= 1 AND "zoom" <= 5 AND "offset_x" >= -1 AND "offset_x" <= 1 AND "offset_y" >= -1 AND "offset_y" <= 1);
-- Image metadata is all present or all absent (a removed image leaves the framing row), and only safe raster types.
ALTER TABLE "character_portraits" ADD CONSTRAINT "character_portraits_image_metadata_check" CHECK (
  ("mime_type" IS NULL AND "byte_size" IS NULL AND "width" IS NULL AND "height" IS NULL AND "content_hash" IS NULL)
  OR ("mime_type" IN ('image/png', 'image/jpeg', 'image/webp') AND "byte_size" > 0 AND "byte_size" <= 8388608 AND "width" > 0 AND "height" > 0 AND "content_hash" IS NOT NULL)
);
