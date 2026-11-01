-- PAS-10 M6-WO6 — Character Weapon loadout. Adds the Character's Main-hand / Off-hand Weapon CHOICE: exact Weapon
-- Entity + EntityVersion pairs and the explicit grip of a Versatile Main-hand Weapon. No existing table or row changes;
-- nothing derived (Attacks, damage, Power, shield bonuses), no ammunition, ownership or inventory is stored.

-- CreateTable
CREATE TABLE "character_weapon_loadouts" (
    "character_id" UUID NOT NULL,
    "main_hand_entity_id" UUID,
    "main_hand_entity_version_id" UUID,
    "main_hand_grip" TEXT,
    "off_hand_entity_id" UUID,
    "off_hand_entity_version_id" UUID,
    "lock_version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "character_weapon_loadouts_pkey" PRIMARY KEY ("character_id")
);

-- CreateIndex
CREATE INDEX "character_weapon_loadouts_main_hand_entity_version_id_idx" ON "character_weapon_loadouts"("main_hand_entity_version_id");

-- CreateIndex
CREATE INDEX "character_weapon_loadouts_off_hand_entity_version_id_idx" ON "character_weapon_loadouts"("off_hand_entity_version_id");

-- AddForeignKey
ALTER TABLE "character_weapon_loadouts" ADD CONSTRAINT "character_weapon_loadouts_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "character_weapon_loadouts" ADD CONSTRAINT "character_weapon_loadouts_main_hand_fkey" FOREIGN KEY ("main_hand_entity_version_id", "main_hand_entity_id") REFERENCES "entity_versions"("id", "entity_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "character_weapon_loadouts" ADD CONSTRAINT "character_weapon_loadouts_off_hand_fkey" FOREIGN KEY ("off_hand_entity_version_id", "off_hand_entity_id") REFERENCES "entity_versions"("id", "entity_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Integrity (hand-written; Prisma does not model CHECK constraints): a hand is empty or an exact pair; only a held
-- Main-hand Weapon may carry a grip, and only the two grips exist; the lock version starts at 1.
ALTER TABLE "character_weapon_loadouts" ADD CONSTRAINT "character_weapon_loadouts_main_hand_pair_check" CHECK (("main_hand_entity_id" IS NULL) = ("main_hand_entity_version_id" IS NULL));
ALTER TABLE "character_weapon_loadouts" ADD CONSTRAINT "character_weapon_loadouts_off_hand_pair_check" CHECK (("off_hand_entity_id" IS NULL) = ("off_hand_entity_version_id" IS NULL));
ALTER TABLE "character_weapon_loadouts" ADD CONSTRAINT "character_weapon_loadouts_grip_check" CHECK ("main_hand_grip" IS NULL OR ("main_hand_grip" IN ('ONE_HANDED', 'TWO_HANDED') AND "main_hand_entity_version_id" IS NOT NULL));
ALTER TABLE "character_weapon_loadouts" ADD CONSTRAINT "character_weapon_loadouts_lock_version_check" CHECK ("lock_version" >= 1);
