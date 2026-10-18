import ts from "typescript";

/**
 * M5-WO3 static audit helpers (PAS-10 M5-WO3 §195). Two kinds of check:
 *
 *   auditWo3Source   — TypeScript AST rules over @prowess/game / @prowess/rules production source (comments never trip a rule);
 *   auditWo3Content  — structural rules over the canonical core + runtime content documents.
 *
 * Both return sorted, de-duplicated finding names so negative controls can assert the exact rule that fires.
 */
export type Wo3Layer = "game" | "rules";

const ACTION_KEYS = new Set(["MOVE", "SPRINT", "LIGHT_ATTACK", "BALANCED_ATTACK", "HEAVY_ATTACK", "BLOCK", "DODGE_ACTION", "RELOAD", "INTERACT", "GRAPPLE", "CAST_SPELL", "USE_SKILL_ACTION", "COUNTER_REACTION"]);
const RESOURCE_KEYS = new Set(["HP", "MP", "ME", "AP", "COUNTER_ACTION", "MOVEMENT_ALLOWANCE"]);
const SIZE_KEYS = new Set(["SMALL", "MEDIUM", "LARGE", "HUGE", "MASSIVE"]);
const STACKED_MODES = /^(DOUBLE|TRIPLE|SUPER|GREATER|STACKED)_(DIS)?ADVANTAGE$|^(DIS)?ADVANTAGE_[0-9X]+$/;
const RANDOM_CALLEE = /^(Math\.random|crypto\.\w+|globalThis\.crypto\.\w+|randomInt|randomUUID|getRandomValues|Date\.now|performance\.now)$|\.(randomInt|randomUUID|getRandomValues|randomBytes)$/;
const PERSIST = /^(persist\w*|save\w*|commit\w*|store\w*State|writeResource\w*|upsert\w*|evaluateAndSave|spendAndPersist|commitTurn|applyToCharacter|prisma)$/i;
const LATEST = /getLatest|^latest|latest[A-Z]|newest|mostRecent|getCurrent|^current(Version|Effect|Definition|Ruleset|Die|Rules|Action|Resource)|^active(Ruleset|Definition)/i;
const ME_DISCOUNT = /^(listedMpAfterMe|mpAfterMe|effectiveMp|discountedMp|mpAfterDiscount|costAfterMe|discountedCost|effectiveCost|netCost)$/i;
const PROWESS_IN_M4 = /(^|[^a-z])(counter_?action|mana_?efficiency|movement_?allowance|sprint|initiative|surprised?|difficult_?terrain|creature_?size)([^a-z]|$)/i;

const literalText = (node: ts.Node): string | null => (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : null);

export function auditWo3Source(source: string, file: string, layer: Wo3Layer): string[] {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const findings = new Set<string>();
  const add = (f: string) => findings.add(f);
  const vocabulary = /vocabulary\/(terminology|core|runtime)\.ts$/.test(file);
  const combat = /runtime\/combat\.ts$/.test(file);
  const dice = /core\/dice\.ts$/.test(file);

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const name = node.moduleSpecifier.text;
      if (layer === "game" && /^(@prowess\/db|@prisma\/|pg$|prisma|node:|fs$|path$|next|react)/.test(name)) add("persistence");
      if (layer === "rules" && /@prowess\/game/.test(name)) add("prowess-in-m4");
    }

    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const callee = node.expression.getText(ast);
      if (RANDOM_CALLEE.test(callee)) add("randomness");
      if (layer === "game" && /^Math\.(floor|ceil|round|trunc)$/.test(callee)) add("hidden-rounding");
      // The side phase never orders its creatures: no sort of members / players / creatures (M5-I101).
      if (layer === "game" && /\.sort$/.test(callee) && /member|player|creature|character/i.test(node.expression.getText(ast))) add("player-initiative-order");
    }

    if (ts.isIdentifier(node) && layer === "game") {
      const parent = node.parent;
      const declares = parent !== undefined && (ts.isVariableDeclaration(parent) || ts.isFunctionDeclaration(parent) || ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent) || ts.isParameter(parent) || ts.isPropertySignature(parent)) && (parent as { name?: ts.Node }).name === node;
      if (declares && PERSIST.test(node.text)) add("persistence");
      if (LATEST.test(node.text)) add("latest-or-current");
      if (ME_DISCOUNT.test(node.text)) add("me-discount");
      if (declares && /^(initiativeSlot|playerInitiative|individualInitiative|turnOrder|playerOrder)s?$/i.test(node.text)) add("player-initiative-order");
      if (declares && /^(actionsRemaining|actionSlots?|bonusAction|movementAction)$/i.test(node.text)) add("ap-as-slots");
      if (declares && /^(sizeMovement|movementBySize|sizeSpeed|speedBySize|occupiedSpeed)$/i.test(node.text)) add("size-speed-inference");
    }

    const text = literalText(node);
    if (text !== null) {
      if (layer === "rules" && PROWESS_IN_M4.test(text)) add("prowess-in-m4");
      if (layer === "game" && STACKED_MODES.test(text)) add("advantage-stacking");
      if (layer === "game" && /\b10 \* agi\b|\bagi \* 10\b/i.test(text)) add("movement-not-canonical");
      if (layer === "game" && /\/payment\/listedAmount/.test(text)) add("listed-cost-feedback");
    }
    if (ts.isIdentifier(node) && layer === "rules" && PROWESS_IN_M4.test(node.text.replace(/([a-z])([A-Z])/g, "$1_$2"))) add("prowess-in-m4");

    if (ts.isBinaryExpression(node) && layer === "game") {
      const op = node.operatorToken.kind;
      const sides = [node.left, node.right];
      const lits = sides.map(literalText);
      const texts = sides.map((s) => s.getText(ast));
      const equality = [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken].includes(op);
      // No branch on an action or Resource NAME: costs and behaviour come from Definitions (M5-I097).
      if (equality && lits.some((l) => l !== null && ACTION_KEYS.has(l))) add("action-cost-switch");
      if (equality && !vocabulary && lits.some((l) => l !== null && RESOURCE_KEYS.has(l))) add("resource-name-branch");
      if (equality && lits.some((l) => l !== null && SIZE_KEYS.has(l))) add("size-speed-inference");
      // Count-netting of roll signals: comparing or subtracting the two signal counts (M5-I078).
      const counts = [ts.SyntaxKind.MinusToken, ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.LessThanToken, ts.SyntaxKind.GreaterThanEqualsToken, ts.SyntaxKind.LessThanEqualsToken, ts.SyntaxKind.PlusToken].includes(op);
      if (counts && /disadvantage/i.test(texts.join(" ")) && texts.some((t) => /(^|[^s])advantage/i.test(t) && !/disadvantage/i.test(t)) && texts.some((t) => /disadvantage/i.test(t))) add("net-advantage");
      if (dice && counts && texts.some((t) => /advantage/i.test(t)) && texts.some((t) => /^[2-9]$/.test(t))) add("advantage-stacking");
    }

    if (ts.isCaseClause(node) && layer === "game") {
      const lit = literalText(node.expression);
      if (lit !== null && ACTION_KEYS.has(lit)) add("action-cost-switch");
      if (lit !== null && RESOURCE_KEYS.has(lit) && !vocabulary) add("resource-name-branch");
      if (lit !== null && SIZE_KEYS.has(lit)) add("size-speed-inference");
    }

    if (ts.isPropertyAssignment(node) && layer === "game") {
      const name = node.name.getText(ast).replace(/["']/g, "");
      if (ACTION_KEYS.has(name) && ts.isNumericLiteral(node.initializer)) add("action-cost-switch");
      if (SIZE_KEYS.has(name) && ts.isNumericLiteral(node.initializer)) add("size-speed-inference");
      if (combat && /^(members|players|order)$/.test(name) && /\.sort\(/.test(node.initializer.getText(ast))) add("player-initiative-order");
    }
    node.forEachChild(visit);
  };
  visit(ast);
  return [...findings].sort();
}

// ---- content ---------------------------------------------------------------------------------------------------------

interface ContentDefinition {
  canonicalKey: string;
  definitionKind: string;
  payload: Record<string, unknown>;
}
interface Formula {
  expression: string;
  rounding?: string;
  variables: { variable: string; source: { kind: string; stat?: string; statistic?: string } }[];
}
const kind = (defs: ContentDefinition[], k: string) => defs.filter((d) => d.definitionKind === k);
const resourceOf = (defs: ContentDefinition[], key: string) => kind(defs, "RESOURCE").find((d) => d.payload.resourceKey === key)?.payload as Record<string, unknown> | undefined;
const actionOf = (defs: ContentDefinition[], key: string) => kind(defs, "ACTION").find((d) => d.payload.actionKey === key)?.payload as Record<string, unknown> | undefined;
const statistic = (defs: ContentDefinition[], s: string) => kind(defs, "DERIVED_STAT").filter((d) => d.payload.statistic === s);
const has = (list: unknown, predicate: (x: Record<string, unknown>) => boolean) => Array.isArray(list) && list.some((x) => predicate(x as Record<string, unknown>));

/** Structural rules over the canonical core + runtime content (designer rulings M5-SC-006 / 032 and M5-WO3 §19–§75). */
export function auditWo3Content(core: { definitions: ContentDefinition[] }, runtime: { definitions: ContentDefinition[]; deferred?: unknown[] }): string[] {
  const defs = [...core.definitions, ...runtime.definitions];
  const findings = new Set<string>();
  const add = (f: string) => findings.add(f);
  const text = JSON.stringify(defs);

  // Movement (M5-SC-006). Amended by the post-WO3 designer clarification applied in M5-WO4 (M5-I111 supersedes M5-I075):
  // Base Movement is the authored creature value (5 ft standard) and Movement = Base Movement × AGI (+ explicit bonuses).
  // 10 × AGI is never canonical; no Size term ever enters Movement (M5-SC-033).
  const base = statistic(defs, "BASE_MOVEMENT");
  const baseFormula = base[0]?.payload.formula as Formula | undefined;
  if (base.length !== 1 || baseFormula?.expression !== "5" || baseFormula.rounding !== "NONE" || baseFormula.variables.length !== 0) add("movement-not-canonical");
  if (/10 \* agi|agi \* 10/i.test(text)) add("movement-not-canonical");
  const movement = statistic(defs, "MOVEMENT")[0]?.payload.formula as Formula | undefined;
  if (movement === undefined || movement.expression !== "base_movement * agi + bonuses") add("movement-not-canonical");
  if (movement === undefined || movement.variables.some((v) => !(v.source.kind === "EXPLICIT_BONUSES" || (v.source.kind === "STAT" && v.source.stat === "AGI") || (v.source.kind === "DERIVED" && v.source.statistic === "BASE_MOVEMENT")))) add("size-speed-inference");

  // Size: occupied space only; never a Base Movement value (M5-I076, M5-I108, M5-I113, M5-SC-033).
  for (const d of kind(defs, "CREATURE_SIZE")) if (d.payload.baseMovement !== null || Object.keys(d.payload).some((k) => /speed|movement(?!$)/i.test(k) && k !== "baseMovement")) add("size-speed-inference");
  if (kind(defs, "CREATURE_SIZE").length !== 5) add("size-speed-inference");

  // Distinct Resources with separate maxima; current never authored (M5-I080, M5-I081).
  for (const key of ["HP", "MP", "ME", "AP", "COUNTER_ACTION", "MOVEMENT_ALLOWANCE"]) if (kind(defs, "RESOURCE").filter((d) => d.payload.resourceKey === key).length !== 1) add("resource-identity");
  if (kind(defs, "RESOURCE").some((d) => "current" in d.payload)) add("resource-identity");

  // HP / MP never refresh or expire on their own (M5-I082, M5-I083).
  for (const key of ["HP", "MP"]) {
    const r = resourceOf(defs, key);
    if ((r?.refresh as unknown[] | undefined)?.length !== 0 || (r?.expiry as unknown[] | undefined)?.length !== 0) add("hp-mp-auto-refresh");
  }

  // AP: refresh to Capacity at start of turn, expire at end of turn (M5-I084, M5-I085).
  const ap = resourceOf(defs, "AP");
  if (!has(ap?.refresh, (x) => x.timing === "START_OF_TURN" && String(x.target).endsWith("MAXIMUM")) || !has(ap?.expiry, (x) => x.timing === "END_OF_TURN" && x.setTo === "MINIMUM") || ap?.restoration !== null) add("ap-banking");
  if ((ap?.maximum as { statistic?: string } | undefined)?.statistic !== "BASE_AP_CAPACITY") add("ap-banking");

  // Counter Action: refresh to Capacity at start of Round; never restorable (no banking) (M5-I086, M5-I087).
  const counter = resourceOf(defs, "COUNTER_ACTION");
  if (!has(counter?.refresh, (x) => x.timing === "START_OF_ROUND" && String(x.target).endsWith("MAXIMUM")) || counter?.restoration !== null || (counter?.maximum as { statistic?: string } | undefined)?.statistic !== "COUNTER_ACTION_CAPACITY") add("counter-banking");
  if (!has(counter?.usageRestrictions, (x) => x.restrictionKey === "SURPRISED" && x.throughRound === 1)) add("surprise-rule");
  // Counter Action and AP are separate payments (M5-I088).
  if (has(ap?.payment, (x) => x.policy === "COUNTER_ACTION_COST") || has(counter?.payment, (x) => x.policy === "ACTION_POINT_COST")) add("counter-ap-interchange");

  // ME = PRO, refreshes at start of Round; pays eligible magical costs before MP; MP never pays first (M5-I089, M5-I090).
  const me = resourceOf(defs, "ME");
  const mp = resourceOf(defs, "MP");
  if (!has(me?.refresh, (x) => x.timing === "START_OF_ROUND") || (me?.maximum as { statistic?: string } | undefined)?.statistic !== "BASE_MANA_EFFICIENCY") add("me-refresh");
  const order = (r: Record<string, unknown> | undefined, policy: string) => ((r?.payment as { policy: string; order: number }[] | undefined) ?? []).find((x) => x.policy === policy)?.order;
  const meOrder = order(me, "ME_ELIGIBLE_MAGICAL_COST");
  const mpOrder = order(mp, "ME_ELIGIBLE_MAGICAL_COST");
  if (meOrder === undefined || mpOrder === undefined || !(meOrder < mpOrder)) add("mp-before-me");
  if (order(me, "MAGICAL_COST") !== undefined) add("me-eligibility-assumed");
  // Only MP reserves capacity (Mana Lock boundary) (M5-I093, M5-I094).
  if (mp?.supportsReservation !== true || kind(defs, "RESOURCE").some((d) => d.payload.resourceKey !== "MP" && d.payload.supportsReservation === true)) add("reservation-boundary");

  // Action costs are content (s44, s432) (M5-I097).
  const expected: Record<string, unknown> = {
    MOVE: { model: "FIXED", amount: 1 },
    SPRINT: { model: "FIXED", amount: 3 },
    LIGHT_ATTACK: { model: "FIXED", amount: 1 },
    BALANCED_ATTACK: { model: "FIXED", amount: 2 },
    HEAVY_ATTACK: { model: "FIXED", amount: 3 },
    BLOCK: { model: "FIXED", amount: 2 },
    DODGE_ACTION: { model: "FIXED", amount: 3 },
    RELOAD: { model: "FIXED", amount: 1 },
    INTERACT: { model: "MINIMUM", minimum: 1 },
    GRAPPLE: { model: "RANGE", minimum: 1, maximum: 2 },
    CAST_SPELL: { model: "VARIABLE", determinedBy: "SPELL" },
    USE_SKILL_ACTION: { model: "VARIABLE", determinedBy: "SKILL_ACTION" },
  };
  for (const [key, cost] of Object.entries(expected)) if (JSON.stringify(actionOf(defs, key)?.actionPointCost) !== JSON.stringify(cost)) add("action-cost");
  if (kind(defs, "ACTION").some((d) => d.payload.costOverridableByExplicitRule !== true)) add("action-cost");
  if (kind(defs, "ACTION").some((d) => d.canonicalKey === "core.derived.dodge") || actionOf(defs, "DODGE_ACTION") === undefined) add("dodge-identity");

  // Move / Sprint grant allowance from Movement (never a change to Movement; Sprint never compounds) (M5-I098, M5-I109;
  // M5-SC-034 RESOLVED_BY_DESIGNER in M5-WO4: Sprint Allowance = Movement × 4, M5-I112).
  const grant = (key: string) => (actionOf(defs, key)?.movementGrant as { formula: Formula } | null | undefined)?.formula;
  if (grant("MOVE")?.expression !== "movement" || grant("SPRINT")?.expression !== "movement * 4") add("movement-grant");
  for (const key of ["MOVE", "SPRINT"]) if (grant(key)?.variables.some((v) => v.source.kind !== "DERIVED" || v.source.statistic !== "MOVEMENT")) add("movement-grant");

  // Difficult Terrain costs double (M5-I100).
  const terrain = (key: string) => (kind(defs, "TERRAIN").find((d) => d.payload.terrainKey === key)?.payload.allowanceCost as Formula | undefined)?.expression;
  if (terrain("NORMAL") !== "distance" || terrain("DIFFICULT") !== "distance * 2") add("difficult-terrain");

  // Initiative = natural + PER / 2 + AGI / 2 + bonuses, no rounding; tie-break PER → AGI → reroll (M5-I102, M5-I103).
  const initiative = kind(defs, "CORE_RESOLUTION").find((d) => d.payload.procedure === "INITIATIVE")?.payload;
  const total = initiative?.total as Formula | undefined;
  if (total?.expression !== "natural + per / 2 + agi / 2 + bonuses" || total.rounding !== "NONE" || /floor|ceil|round/.test(total.expression)) add("initiative-rounding");
  if (JSON.stringify(initiative?.tiebreak) !== JSON.stringify([{ kind: "HIGHEST_STAT", stat: "PER" }, { kind: "HIGHEST_STAT", stat: "AGI" }, { kind: "REROLL" }])) add("initiative-tiebreak");

  // No stacked roll modes anywhere in content (M5-I077).
  if (/"(DOUBLE|TRIPLE)_(DIS)?ADVANTAGE"/.test(text)) add("advantage-stacking");

  // Surprise invents no AP penalty (M5-I104).
  if (has(ap?.usageRestrictions, (x) => x.restrictionKey === "SURPRISED")) add("surprise-ap-penalty");

  // M5-SC-033 remains deferred in content.
  if (!has(runtime.deferred, (x) => x.conflictKey === "M5-SC-033")) add("size-speed-inference");
  return [...findings].sort();
}
