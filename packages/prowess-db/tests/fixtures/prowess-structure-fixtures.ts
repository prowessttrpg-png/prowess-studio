import { buildDocx, makePng, type FxDocument } from "./docx-builder";

/**
 * Synthetic, deterministic stand-ins for the STRUCTURAL cases found in the real "Prowess Core Playtest Packet V0.1"
 * (~898 pages, not committed). Each fixture isolates one shape; `PLAYTEST_PACKET_MINIATURE` combines them all. The
 * wording is invented for tests and imitates Prowess prose only so tests can prove that prose — including
 * formulas written in prose and skill tiers — is preserved VERBATIM and never classified.
 */

export const IMG_A = makePng(3, 2, 1);
export const IMG_B = makePng(5, 4, 2);
export const IMG_C = makePng(2, 7, 3);

/** Prose-heavy introductory / core-rule material, with nested chapters. */
export const CORE_RULES: FxDocument = {
  title: "Core Rules Fixture",
  pages: 12,
  blocks: [
    { kind: "p", text: "Prowess Core Playtest Packet", style: "Title" },
    { kind: "p", text: "This packet is an evolving playtest document." },
    { kind: "heading", level: 1, text: "Chapter 1: Introduction" },
    { kind: "p", text: "Welcome to the game.  Read this chapter first." },
    { kind: "heading", level: 2, text: "What You Need" },
    { kind: "p", text: "Dice, pencils and\tfriends." },
    { kind: "heading", level: 2, text: "Core Concepts" },
    { kind: "heading", level: 3, text: "Action Points" },
    { kind: "p", text: "A character spends Action Points to act." },
    { kind: "heading", level: 1, text: "Chapter 2: Characters" },
    { kind: "p", text: "Characters are built from attributes." },
  ],
};

/** Bullets and numbered procedures, including nested levels. */
export const PROCEDURES: FxDocument = {
  blocks: [
    { kind: "heading", level: 1, text: "Making a Check" },
    { kind: "numbered", text: "Choose the attribute." },
    { kind: "numbered", text: "Roll the dice." },
    { kind: "numbered", text: "Apply any modifier.", level: 1 },
    { kind: "numbered", text: "Compare to the target." },
    { kind: "bullet", text: "Critical results are noted." },
    { kind: "bullet", text: "Ties favour the defender.", level: 1 },
  ],
};

/** Formulas expressed in prose — must survive byte-for-byte as prose. */
export const FORMULAS_IN_PROSE: FxDocument = {
  blocks: [
    { kind: "heading", level: 1, text: "Direct Damage" },
    { kind: "p", text: "Damage equals (Power × 2) + Tier − Resistance, minimum 1." },
    { kind: "p", text: "MP cost = 3 + (2 × Range Step); halve it (round up) when Focused." },
    { kind: "p", text: "", runs: ["A spell's AP cost is ", "1 per Action", " plus ", "the casting modifier."] },
  ],
};

/** Simple and complex tables: header rows, row spans, column spans, a nested table, a caption. */
export const TABLES: FxDocument = {
  blocks: [
    { kind: "heading", level: 1, text: "Tables" },
    { kind: "caption", text: "Table 1: Range Steps" },
    { kind: "table", headerRows: 1, rows: [["Step", "Distance"], ["1", "Touch"], ["2", "Near"]] },
    {
      kind: "table",
      headerRows: 2,
      caption: "Weapon Groups",
      rows: [
        [{ text: "Group", vMerge: "restart" }, { text: "Damage", colSpan: 2 }],
        [{ text: "", vMerge: "continue" }, "Light", "Heavy"],
        [{ text: "Blades", vMerge: "restart" }, "d6", "d8"],
        [{ text: "", vMerge: "continue" }, "d4", { text: "see below", nested: { kind: "table", rows: [["Edge", "+1"], ["Point", "+2"]] } }],
        [{ text: "Notes span the table", colSpan: 3 }],
      ],
    },
  ],
};

/** Skill sections with Trained / Expert / Master subdivisions — just headings to the parser. */
export const SKILL_TIERS: FxDocument = {
  blocks: [
    { kind: "heading", level: 1, text: "Skills" },
    { kind: "heading", level: 2, text: "Athletics" },
    { kind: "heading", level: 3, text: "Trained" },
    { kind: "p", text: "You may climb at half speed." },
    { kind: "heading", level: 3, text: "Expert" },
    { kind: "p", text: "You may climb at full speed." },
    { kind: "heading", level: 3, text: "Master" },
    { kind: "p", text: "You may climb while carrying an ally." },
    { kind: "heading", level: 2, text: "Lore" },
    { kind: "heading", level: 3, text: "Trained" },
    { kind: "p", text: "Recall common knowledge." },
  ],
};

/** Spellcasting with modular mechanical sections, plus Summoning and Maneuvers. */
export const SPELL_MODULES: FxDocument = {
  blocks: [
    { kind: "heading", level: 1, text: "Spellcasting" },
    { kind: "heading", level: 2, text: "Spell Modules" },
    { kind: "heading", level: 3, text: "Effect: Direct Damage" },
    { kind: "p", text: "Deal damage to one target in range." },
    { kind: "heading", level: 3, text: "Modifier: Area" },
    { kind: "p", text: "Affects every creature in a burst." },
    { kind: "heading", level: 1, text: "Summoning" },
    { kind: "p", text: "A summoned ally acts on your turn." },
    { kind: "heading", level: 1, text: "Maneuvers" },
    { kind: "bullet", text: "Shove: push a target one step." },
    { kind: "bullet", text: "Feint: the next attack gains an edge." },
  ],
};

/** Mission generator tables (d6 / d66 shape). */
export const MISSION_TABLES: FxDocument = {
  blocks: [
    { kind: "heading", level: 1, text: "Mission Generator" },
    { kind: "p", text: "Roll on each table in order." },
    { kind: "table", headerRows: 1, rows: [["d6", "Patron"], ["1–2", "A guild"], ["3–4", "A noble"], ["5–6", "A stranger"]] },
    { kind: "table", headerRows: 1, rows: [["d66", "Complication"], ["11–16", "Weather"], ["21–26", "Rivals"]] },
  ],
};

/** An image-only page and a heavily illustrated page (one image used twice, images with and without text). */
export const ILLUSTRATED: FxDocument = {
  media: { "image1.png": IMG_A, "image2.png": IMG_B, "image3.png": IMG_C, "image4.png": IMG_A },
  blocks: [
    { kind: "heading", level: 1, text: "Bestiary" },
    { kind: "pageBreak" },
    { kind: "image", media: "image1.png", alt: "A full-page illustration" },
    { kind: "pageBreak" },
    { kind: "p", text: "The wolf hunts in packs." },
    { kind: "image", media: "image2.png", alt: "A wolf" },
    { kind: "image", media: "image3.png", withText: "Figure: tracks " },
    { kind: "image", media: "image4.png", alt: "The same illustration again" },
    { kind: "table", rows: [["Portrait", "Notes"]], cellImages: ["image2.png"] },
  ],
};

/** Everything together, in one ordered document. */
export const PLAYTEST_PACKET_MINIATURE: FxDocument = {
  title: "Prowess Core Playtest Packet (synthetic miniature)",
  pages: 40,
  media: ILLUSTRATED.media,
  blocks: [
    ...CORE_RULES.blocks,
    ...PROCEDURES.blocks,
    ...FORMULAS_IN_PROSE.blocks,
    ...TABLES.blocks,
    ...SKILL_TIERS.blocks,
    ...SPELL_MODULES.blocks,
    ...MISSION_TABLES.blocks,
    ...ILLUSTRATED.blocks,
    { kind: "empty" },
  ],
};

export const docx = (doc: FxDocument) => buildDocx(doc);
