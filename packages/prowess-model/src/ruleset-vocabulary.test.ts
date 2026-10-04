import { describe, expect, it } from "vitest";
import { ENTITY_VERSION_STATUSES } from "./status.js";
import { isRulesetChannel, RULESET_CHANNELS } from "./ruleset-channel.js";
import { isRulesetStatus, RULESET_STATUSES } from "./ruleset-status.js";

describe("RulesetStatus", () => {
  it("is exactly the six governance states, in lifecycle order", () => {
    expect([...RULESET_STATUSES]).toEqual(["DRAFT", "IN_REVIEW", "APPROVED", "PUBLISHED", "DEPRECATED", "ARCHIVED"]);
  });

  it.each(RULESET_STATUSES)("accepts %s", (value) => {
    expect(isRulesetStatus(value)).toBe(true);
  });

  it.each(["draft", "", "CANON", "PLAYTEST", "SUPERSEDED"])("rejects %j", (value) => {
    expect(isRulesetStatus(value)).toBe(false);
  });

  it("is its OWN vocabulary, not EntityVersionStatus — they overlap on exactly five labels and differ on the rest", () => {
    const ruleset = RULESET_STATUSES as readonly string[];
    const version = ENTITY_VERSION_STATUSES as readonly string[];
    // The overlap is documented, not accidental: same words, different lifecycles.
    expect(ruleset.filter((s) => version.includes(s)).sort()).toEqual(["APPROVED", "ARCHIVED", "DEPRECATED", "DRAFT", "IN_REVIEW"]);
    // PUBLISHED is Ruleset-only; PLAYTEST / CANON / SUPERSEDED are EntityVersion-only.
    expect(ruleset).toContain("PUBLISHED");
    expect(version).not.toContain("PUBLISHED");
    for (const only of ["PLAYTEST", "CANON", "SUPERSEDED"]) {
      expect(version).toContain(only);
      expect(ruleset).not.toContain(only);
    }
    expect([...ruleset].sort()).not.toEqual([...version].sort());
  });
});

describe("RulesetChannel", () => {
  it("is exactly the six PAS-08 channels", () => {
    expect([...RULESET_CHANNELS]).toEqual([
      "DEVELOPMENT",
      "INTERNAL_PLAYTEST",
      "CORE_PLAYTEST",
      "EXPERIMENTAL",
      "STABLE",
      "LEGACY",
    ]);
  });

  it.each(RULESET_CHANNELS)("accepts %s", (value) => {
    expect(isRulesetChannel(value)).toBe(true);
  });

  it.each(["core_playtest", "", "PUBLISHED", "BETA"])("rejects %j", (value) => {
    expect(isRulesetChannel(value)).toBe(false);
  });
});
