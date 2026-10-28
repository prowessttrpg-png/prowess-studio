/**
 * Tier summary check (M5-CLOSEOUT-03 C9): fails unless every job in `needs` (passed as JSON in NEEDS) succeeded.
 * A skipped, cancelled or failed dependency fails the tier — a summary can never turn partial verification green.
 */
const needs = JSON.parse(process.env.NEEDS ?? "{}");
const entries = Object.entries(needs);
if (entries.length === 0) {
  console.log("::error::no jobs to summarize");
  process.exit(1);
}
const bad = entries.filter(([, v]) => v.result !== "success");
for (const [job, v] of bad) console.log(`::error::${job}: ${v.result}`);
for (const [job] of entries.filter(([, v]) => v.result === "success")) console.log(`${job}: success`);
process.exit(bad.length ? 1 : 0);
