import { expect, test } from "@playwright/test";
import { maneuverUiApi, builderUrl, builderStep, saveManeuverUi } from "./m6-wo8-ui-api";

test.describe("WO8 real-browser UI with approved isolated Release/API fixtures", () => {
  test("1 creates an Action-first draft, reorders exact Actions and saves authored choices", async ({ page }) => {
    const api = await maneuverUiApi(page);
    await page.goto("/characters/character/maneuvers/new");
    await page.getByLabel("Maneuver name").fill("Ordered Maneuver"); await page.getByRole("button", { name: "Start building" }).click();
    await builderStep(page, "Action Selection");
    await page.getByRole("button", { name: /^Add / }).first().click(); await page.getByRole("button", { name: /^Add / }).first().click();
    await builderStep(page, "Action Sequence");
    await page.getByRole("button", { name: "Move action2 up" }).click(); await saveManeuverUi(page);
    expect(api.draft().actions.map(a => a.componentKey)).toEqual(["action2", "action1"]);
    expect(api.draft().actions[0]!.source).toEqual(api.draft().actions[1]!.source);
  });
  test("2 configures multiple blocks with independently scoped Effects and Traits", async ({ page }) => {
    const api = await maneuverUiApi(page, "scoped"); await page.goto(builderUrl);
    await builderStep(page, "Effects"); await page.getByLabel("Attach effect to").selectOption("block"); await saveManeuverUi(page);
    expect(api.draft().effectAttachments).toEqual([{ effectKey: "effect", actionKeys: ["block"] }]);
    await builderStep(page, "Traits"); await expect(page.getByText("Scope: Action Specific; target: block")).toBeVisible();
    await builderStep(page, "Action Sequence"); await expect(page.getByTestId("maneuver-action-row")).toHaveCount(3);
  });
  test("3 configures Powerful Blow with exact Attack identity and server costs", async ({ page }) => {
    const api = await maneuverUiApi(page, "powerful"); const before = structuredClone(api.draft().actions); api.draft().powerfulBlow = null;
    await page.goto(builderUrl); await builderStep(page, "Action Sequence");
    await page.getByRole("checkbox", { name: "attack1", exact: true }).check(); await page.getByRole("checkbox", { name: "attack2", exact: true }).check();
    await page.getByRole("button", { name: "Set Powerful Blow" }).click(); await saveManeuverUi(page);
    await builderStep(page, "Effects"); await page.getByLabel("Attach effect1 to").selectOption("powerful-blow"); await saveManeuverUi(page);
    expect(api.draft().actions).toEqual(before); expect(api.draft().effectAttachments[0]!.actionKeys).toEqual(["attack1", "attack2"]);
    await builderStep(page, "Review"); await expect(page.getByTestId("maneuver-cost-inspector")).toContainText("Protected Action AP subtotal");
  });
  test("4 displays Performance's actual rank and separate preparation, and fails closed on missing content/untrained rank", async ({ page }) => {
    const api = await maneuverUiApi(page, "performance"); await page.goto(builderUrl); await builderStep(page, "Conditions");
    await expect(page.getByRole("row", { name: "Master 6 0", exact: true })).toBeVisible();
    await builderStep(page, "Review"); await expect(page.getByTestId("maneuver-performance-preparation")).toContainText("separate preparation 0 AP");
    api.untrain(); await page.reload(); await builderStep(page, "Finalize"); await expect(page.getByRole("button", { name: "Finalize Maneuver", exact: true })).toBeDisabled();
    api.noPerformance(); await page.reload(); await builderStep(page, "Conditions"); await expect(page.getByText("This Release lacks the approved Performance Condition.")).toBeVisible();
  });
  test("5 retains local choices after HTTP 409 without overwriting the saved draft", async ({ page }) => {
    const api = await maneuverUiApi(page, "basic"), original = structuredClone(api.draft()); api.setConflict(true);
    await page.goto(builderUrl); await page.getByRole("textbox", { name: "Name", exact: true }).fill("Conflicting local edit");
    await expect(page.getByTestId("maneuver-save-state")).toHaveAttribute("data-save", "conflict");
    expect(api.draft()).toEqual(original); await expect(page.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Conflicting local edit");
    await builderStep(page, "Finalize"); await expect(page.getByRole("button", { name: "Finalize Maneuver", exact: true })).toBeDisabled();
  });
  test("6 finalizes, rebuilds, preserves current history on invalid draft, retires and presents the current sheet row", async ({ page }) => {
    const api = await maneuverUiApi(page, "basic", true); await page.goto(builderUrl); await builderStep(page, "Finalize");
    await page.getByRole("button", { name: "Finalize Maneuver", exact: true }).click(); await expect(page.getByTestId("maneuver-detail")).toBeVisible();
    await expect(page.getByTestId("maneuver-history-revision")).toContainText("Revision 1 (current)");
    await page.getByRole("button", { name: "Rebuild Maneuver" }).click(); await page.getByRole("textbox", { name: "Name", exact: true }).fill("Rebuilt Maneuver"); await saveManeuverUi(page);
    await page.goto("/characters/character/maneuvers/maneuver");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Maneuver fixture");
    await expect(page.getByTestId("maneuver-history-revision")).toContainText("Revision 1 (current)");
    await page.getByRole("link", { name: "Continue draft" }).click();
    await builderStep(page, "Effects"); await page.getByRole("button", { name: "Remove effect1", exact: true }).click(); await saveManeuverUi(page);
    await builderStep(page, "Finalize"); await expect(page.getByRole("button", { name: "Finalize Maneuver", exact: true })).toBeDisabled();
    const rejected = await page.evaluate(async expectedVersion => {
      const response = await fetch("/api/characters/character/maneuvers/maneuver/finalize", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedVersion }) });
      return response.status;
    }, api.version());
    expect(rejected).toBe(422);
    await page.goto("/characters/character/maneuvers/maneuver"); await expect(page.getByTestId("maneuver-history-revision")).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Maneuver fixture");
    await expect(page.getByTestId("maneuver-history-revision")).toContainText("Revision 1 (current)");
    await page.getByRole("link", { name: "Continue draft" }).click(); await builderStep(page, "Effects");
    await page.getByRole("button", { name: "Select push", exact: true }).click();
    await page.getByLabel("Attach effects1 to").selectOption("attack1"); await saveManeuverUi(page);
    await builderStep(page, "Finalize"); await page.getByRole("button", { name: "Finalize Maneuver", exact: true }).click();
    await expect(page.getByTestId("maneuver-history-revision")).toHaveCount(2);
    await expect(page.getByTestId("maneuver-history-revision").nth(0)).toContainText("Revision 1 ·");
    await expect(page.getByTestId("maneuver-history-revision").nth(1)).toContainText("Revision 2 (current)");
    await page.goto("/characters/character/abilities"); await expect(page.getByTestId("abilities-maneuvers")).toContainText("Rebuilt Maneuver"); await expect(page.getByTestId("abilities-signature-slots")).toContainText(/used: 2 \/ /); await expect(page.getByTestId("abilities-spell-row")).toHaveCount(1);
    await page.goto("/characters/character"); await expect(page.getByTestId("character-sheet")).toBeVisible(); await expect(page.getByTestId("sheet-maneuver-row")).toHaveCount(1);
    await expect(page.getByTestId("sheet-maneuver-row")).toContainText("Rebuilt Maneuver · r2");
    await page.goto("/characters/character/maneuvers/maneuver"); page.once("dialog", dialog => dialog.accept()); await page.getByRole("button", { name: "Retire Maneuver", exact: true }).click();
    await expect(page.getByTestId("maneuver-detail")).toContainText("RETIRED"); await expect(page.getByTestId("maneuver-history-revision")).toHaveCount(2);
    await expect(page.getByTestId("maneuver-history-revision").nth(0)).toContainText("Revision 1 ·");
    await expect(page.getByTestId("maneuver-history-revision").nth(1)).toContainText("Revision 2 (current)");
    await page.goto("/characters/character"); await expect(page.getByTestId("character-sheet")).toBeVisible(); await expect(page.getByTestId("sheet-maneuver-row")).toHaveCount(0); expect(api.writes.length).toBeGreaterThan(0);
    await page.goto("/characters/character/abilities"); await expect(page.getByTestId("abilities-signature-slots")).toContainText(/used: 1 \/ /);
  });
});
