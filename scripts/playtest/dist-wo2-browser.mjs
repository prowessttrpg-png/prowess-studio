import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createDesktopGateway } from "../distribution/desktop/gateway.mjs";
import { freePort } from "../distribution/desktop/storage.mjs";

const studio = path.resolve(import.meta.dirname, "../../apps/studio");
const requireStudio = createRequire(path.join(studio, "package.json"));
const { chromium, expect } = requireStudio("@playwright/test");
const wait = expect.configure({ timeout: 30_000 });

async function launch(database, desktop = true) {
  const backendToken = randomBytes(32).toString("hex");
  const port = await freePort();
  const controlToken = randomBytes(32).toString("hex");
  const gateway = await createDesktopGateway({
    controlToken, backendToken,
    status: () => ({ ready: true, firstRun: false, demo: false, message: "Ready" }),
  });
  const endpoint = "http://127.0.0.1:" + port;
  const server = spawn(process.execPath, [path.join(studio, "node_modules/next/dist/bin/next"), "start", "-p", String(port), "--hostname", "127.0.0.1"], {
    cwd: studio, stdio: "inherit",
    env: {
      ...process.env, NODE_ENV: "production", DATABASE_URL: database, APP_URL: gateway.origin,
      LOG_LEVEL: "warn", DEVELOPMENT_MODE: "false", PROWESS_DESKTOP_MODE: desktop ? "true" : "false",
      PROWESS_DESKTOP_BACKEND_TOKEN: backendToken, PROWESS_DESKTOP_WORKSPACE_ID: randomUUID(),
    },
  });
  const done = once(server, "exit");
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await gateway.close();
    if (server.exitCode === null && server.signalCode === null) server.kill();
    await done;
  };
  try {
    const deadline = Date.now() + 40_000;
    while (server.exitCode === null && Date.now() < deadline) {
      try {
        const result = await fetch(endpoint + "/api/characters", {
          headers: { "x-prowess-desktop-backend": backendToken }, signal: AbortSignal.timeout(1000),
        });
        await result.body?.cancel();
        if (result.ok) {
          gateway.setBackend(port);
          return { gateway, endpoint, backendToken, close };
        }
      } catch {
        // Wait for Next.js and the database to finish starting.
      }
      await delay(300);
    }
    throw new Error("Production Studio did not start");
  } catch (error) {
    await close();
    throw error;
  }
}

async function open(browser, workspace) {
  const context = await browser.newContext({ baseURL: workspace.gateway.origin, acceptDownloads: true });
  const page = await context.newPage();
  await page.goto(workspace.gateway.issueLaunch());
  await page.waitForURL(workspace.gateway.origin + "/", { timeout: 30_000 });
  return { page, close: () => context.close() };
}

const catalogPath = (release) => `/compendium/rulesets/${release.rulesetId}/releases/${release.releaseId}`;

async function transfer(source, receiver, release, directory, installedBefore) {
  await source.goto(catalogPath(release));
  const progress = source.waitForEvent("download");
  await source.getByRole("link", { name: "Export for Players" }).click();
  const archive = await progress;
  const output = path.join(directory, `browser-R${release.releaseNumber}.prowesspack`);
  await archive.saveAs(output);
  const bytes = await readFile(output);

  await receiver.goto("/compendium/content-packs");
  await receiver.getByLabel("Choose a .prowesspack file").setInputFiles(output);
  await receiver.getByRole("button", { name: "Preview pack" }).click();
  const preview = receiver.getByRole("region", { name: new RegExp(release.versionLabel) });
  await wait(preview.getByText("Ready", { exact: true })).toBeVisible();
  await wait(preview.getByText("Unverified source", { exact: true })).toBeVisible();
  const receipts = () => receiver.request.get("/api/content-packs").then((res) => res.json());
  assert.equal((await receipts()).length, installedBefore, "Preview must leave the receiver unchanged");
  await preview.getByRole("button", { name: "Install pack" }).click();
  await wait(receiver.getByRole("status").filter({ hasText: /^Installed$/ })).toBeVisible();
  const receipt = (await receipts()).find((pack) => pack.manifest.release.releaseId === release.releaseId);
  assert.equal(receipt?.manifest.release.manifestHash, release.manifestHash);
  await receiver.getByRole("button", { name: "Preview pack" }).click();
  await wait(preview.getByText("Already installed", { exact: true })).toBeVisible();
  return { archiveSha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length,
    contentDigest: receipt.manifest.contentDigest, releaseId: release.releaseId, manifestHash: release.manifestHash };
}

async function createCharacter(page, release) {
  await page.goto("/characters/new");
  await page.getByRole("combobox", { name: "Ruleset", exact: true }).selectOption(release.rulesetId);
  await page.getByRole("combobox", { name: "Release", exact: true }).selectOption(release.releaseId);
  await wait(page.getByTestId("capability-ready")).toBeVisible();
  await page.getByLabel("Name (required)").fill(`Pack browser Character R${release.releaseNumber}`);
  await page.getByRole("button", { name: "Create Character Draft" }).click();
  await page.waitForURL(/\/characters\/[0-9a-f-]+\/create$/);
  await wait(page.getByTestId("wizard-release")).toContainText(`Release ${release.releaseNumber}`);
  const id = page.url().split("/").at(-2);
  const save = () => page.getByRole("button", { name: "Save & Continue" }).click();
  await page.getByRole("button", { name: "2. Race / Ancestry" }).click();
  await page.getByTestId("ancestry-card").filter({ hasText: "Orcani (test)" }).getByRole("radio").check();
  await page.getByLabel("Stat choice 1 of 2").selectOption("AGI");
  await page.getByLabel("Stat choice 2 of 2").selectOption("PRO");
  await save();
  for (const [stat, points] of [["STR", 3], ["AGI", 3], ["CON", 3], ["PER", 2], ["RES", 2], ["PRO", 2]]) {
    for (let spent = 0; spent < points; spent += 1) await page.getByRole("button", { name: `Add a point to ${stat}` }).click();
  }
  await save();
  await page.getByLabel("Race Skill 1").selectOption({ label: "Athletics (test)" });
  await page.getByLabel("Free Skill 1").selectOption({ label: "skill.martial" });
  await page.getByLabel("Free Skill 2").selectOption({ label: "skill.arcana" });
  await save();
  await page.getByTestId("affinity-card").filter({ hasText: "Evocation (test)" }).getByRole("radio").check();
  await save();
  await wait(page.getByTestId("check-ready")).toBeVisible();
  await page.getByRole("button", { name: "Complete Core Creation" }).click();
  await page.waitForURL(`**/characters/${id}`);

  await page.getByRole("tab", { name: "Advancement" }).click();
  await page.getByRole("link", { name: "Advance Character" }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Add a point to PER" }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await wait(page.getByTestId("advance-ready")).toBeVisible();
  await page.getByRole("button", { name: "Advance Character" }).click();
  await page.getByRole("tab", { name: "Advancement" }).click();
  await wait(page.getByTestId("profile-level")).toHaveText("2 of 10");

  await page.goto(`/characters/${id}`);
  await page.getByTestId("sheet-loadout-edit").click();
  await page.getByTestId("sheet-loadout-main").selectOption({ label: "Long Blade" });
  await page.getByTestId("sheet-loadout-grip").selectOption({ label: "One-handed" });
  await page.getByTestId("sheet-loadout-save").click();
  await wait(page.getByTestId("sheet-loadout-form")).toHaveCount(0);
  return id;
}

async function characterData(page, id, suffix = "") {
  const res = await page.request.get(`/api/characters/${id}${suffix}`);
  assert(res.ok(), `Saved Character could not be read (${res.status()})`);
  return (await res.json()).data;
}

async function buildWard(page, id, release, price) {
  const step = async (key) => {
    await page.getByTestId(`spell-step-${key}`).click();
    await wait(page.getByTestId(`spell-panel-${key}`)).toBeVisible();
  };
  const option = (picker, label) => page.getByTestId(picker).getByTestId("spell-option").filter({ hasText: label });
  await page.goto(`/characters/${id}?view=abilities`);
  await page.getByTestId("abilities-new-spell").click();
  await page.getByTestId("spell-new-name").fill("Distribution Ward");
  await page.getByTestId("spell-new-start").click();
  await step("AUTHORITY");
  await page.getByTestId("spell-authority-ARCANE_AUTHORITY").check();
  await step("TARGETING");
  await option("spell-targeting-picker", "spell.targeting.self").getByRole("radio").check();
  await step("EFFECTS");
  const ward = release.releaseNumber === 1 ? "fixture.wo9.effect.maintenance" : "Steady Ward revision 2";
  await option("spell-effect-picker", ward).getByTestId("spell-option-add").click();
  await step("DURATION");
  await option("spell-duration-picker", "spell.duration.sustained").getByRole("radio").check();
  await wait(page.getByTestId("spell-save-state")).toHaveAttribute("data-save", "saved");
  await wait(page.getByTestId("spell-live").getByTestId("spell-final-mp")).toHaveText(`${price} MP`);
  await step("FINALIZE");
  await page.getByTestId("spell-finalize").click();
  await wait(page.getByTestId("spell-detail-status")).toHaveText("Active");
  await wait(page.getByTestId("spell-detail-revision")).toHaveText("Revision 1");
  await page.getByText("Inspect cost").first().click();
  const inspection = page.getByTestId("spell-cost-inspector").first();
  await wait(inspection.getByTestId("spell-component-link").filter({ hasText: ward })).toHaveAttribute("data-version", release.wardVersionId);
  await wait(inspection.getByRole("row").filter({ hasText: "Final MP (rounded once)" }).getByRole("cell")).toHaveText(`${price} MP`);
  return new URL(page.url()).pathname.split("/").at(-1);
}

async function buildManeuver(page, id) {
  await page.goto(`/characters/${id}/maneuvers/new`);
  await page.getByLabel("Maneuver name").fill("Distribution Strike");
  await page.getByRole("button", { name: "Start building" }).click();
  await page.getByRole("tab", { name: "Action Selection" }).click();
  await page.getByRole("button", { name: "Add Long Blade · Long Blade — Slash · slashing", exact: true }).click();
  await page.getByRole("tab", { name: "Effects", exact: true }).click();
  await page.getByRole("button", { name: "Select test.wo8.effect.enhancement", exact: true }).click();
  await page.getByLabel(/^Attach .* to$/).first().selectOption("action1");
  await page.getByRole("tab", { name: "Duration", exact: true }).click();
  await page.getByRole("button", { name: "Select maneuver.duration.instant", exact: true }).click();
  await page.getByRole("button", { name: "Save now" }).click();
  await page.getByRole("tab", { name: "Finalize", exact: true }).click();
  await page.getByRole("button", { name: "Finalize Maneuver", exact: true }).click();
  await wait(page.getByTestId("maneuver-history-revision")).toContainText("Revision 1 (current)");
  return new URL(page.url()).pathname.split("/").at(-1);
}

async function playWard(page, id) {
  await page.goto(`/characters/${id}/play`);
  const workspace = page.getByTestId("play-workspace");
  await wait(workspace).toBeVisible();
  for (const event of ["BEGIN_COMBAT", "START_ROUND", "START_TURN"]) {
    const before = await workspace.getAttribute("data-runtime-version");
    await page.getByTestId(`play-timing-${event}`).click();
    await wait(workspace).not.toHaveAttribute("data-runtime-version", before);
  }
  const mana = async () => {
    const resources = (await characterData(page, id, "/play")).workspace.resources;
    return resources.filter(({ resourceKey }) => ["ME", "MP"].includes(resourceKey)).reduce((sum, row) => sum + row.current, 0);
  };
  const beforeCast = await mana();
  await page.getByTestId("play-tab-spells").click();
  await page.getByTestId("play-spell").filter({ hasText: "Distribution Ward" }).getByTestId("play-ability-open").click();
  await page.getByTestId("play-commit").click();
  await wait(page.getByTestId("play-result").first()).toHaveAttribute("data-committed", "true");
  await page.getByTestId("play-tab-magic").click();
  await wait(page.getByTestId("play-effect")).toHaveAttribute("data-status", "ACTIVE");
  return beforeCast - await mana();
}

const snapshot = (page, { id, spell, maneuver }) => Promise.all([
  characterData(page, id), characterData(page, id, "/play"),
  characterData(page, id, `/spells/${spell}`), characterData(page, id, `/maneuvers/${maneuver}`),
]);

/** Independent workspaces, using the real production server and the same authenticated gateway as the launcher. */
export async function runPackBrowserProof({ source, receiver }, releases, directory) {
  const browser = await chromium.launch({
    executablePath: process.env.PROWESS_DIST_WO2_CHROMIUM || undefined,
    args: ["--disable-dev-shm-usage"],
  });
  let sourceServer, receiverServer;
  try {
    sourceServer = await launch(source);
    receiverServer = await launch(receiver);
    assert.equal((await fetch(receiverServer.endpoint + "/api/content-packs")).status, 403);
    assert.equal((await fetch(receiverServer.gateway.origin + "/api/content-packs")).status, 401);
    const hosted = await launch(receiver, false);
    try {
      const res = await fetch(hosted.endpoint + "/api/content-packs/install", {
        method: "POST", headers: { "x-prowess-desktop-backend": hosted.backendToken },
      });
      assert.equal(res.status, 403, "Hosted installation must stay unavailable");
    } finally {
      await hosted.close();
    }
    const s = await open(browser, sourceServer);
    let r = await open(browser, receiverServer);
    const packs = [], characters = [], states = [];
    for (const [index, release] of releases.entries()) {
      packs.push(await transfer(s.page, r.page, release, directory, index));
      const id = await createCharacter(r.page, release);
      const price = index === 0 ? 4 : 3;
      const spell = await buildWard(r.page, id, release, price);
      const maneuver = await buildManeuver(r.page, id);
      const paidMana = await playWard(r.page, id);
      assert.equal(paidMana, price);
      const entry = { id, releaseId: release.releaseId, spell, maneuver, wardVersionId: release.wardVersionId, paidMana };
      const state = await snapshot(r.page, entry);
      assert.equal(state[0].release.id, release.releaseId);
      const spellRevision = state[2].history.find((item) => item.current);
      const maneuverRevision = state[3].history.find((item) => item.current);
      assert.equal(spellRevision?.characterReleaseId, release.releaseId);
      assert.equal(maneuverRevision?.characterReleaseId, release.releaseId);
      characters.push({ ...entry, spellRevisionId: spellRevision.revisionId, maneuverRevisionId: maneuverRevision.revisionId,
        eventIds: state[1].recentEvents.map((event) => event.id) });
      states.push(state);
    }
    assert.deepEqual(await snapshot(r.page, characters[0]), states[0]);
    for (let restart = 0; restart < 2; restart += 1) {
      await r.close();
      await receiverServer.close();
      receiverServer = await launch(receiver);
      r = await open(browser, receiverServer);
      for (const [index, saved] of characters.entries()) {
        await r.page.goto(`/characters/${saved.id}/play`);
        await r.page.getByTestId("play-tab-magic").click();
        await wait(r.page.getByTestId("play-effect")).toHaveAttribute("data-status", "ACTIVE");
        assert.deepEqual(await snapshot(r.page, saved), states[index]);
      }
    }
    await r.close();
    await s.close();
    return { stage: "browser", journey: "DIST-WO2 file-only transfer, play, and safe Release update", packs, characters, restarts: 2, unchangedAfterRestart: true };
  } finally {
    await browser.close();
    await Promise.all([sourceServer?.close(), receiverServer?.close()]);
  }
}

/** HTTP-level verification for runners that cannot start a browser. The browser gate never falls back to it. */
export async function runPackHttpProof({ source, receiver }, releases, directory) {
  const sourceServer = await launch(source);
  let receiverServer;
  const session = async (workspace) => {
    const origin = workspace.gateway.origin;
    const launchKey = new URL(workspace.gateway.issueLaunch()).hash.slice(1);
    const response = await fetch(origin + "/__prowess_desktop/session", { method: "POST", headers: { Origin: origin }, body: launchKey });
    assert(response.ok);
    const cookie = response.headers.get("set-cookie").split(";")[0];
    await response.body?.cancel();
    return async (route, { headers = {}, ...options } = {}) => {
      const res = await fetch(origin + route, { ...options, headers: { Cookie: cookie, Origin: origin, ...headers } });
      assert(res.ok, `${route} returned ${res.status}: ${res.ok ? "" : await res.text()}`);
      return res;
    };
  };
  try {
    receiverServer = await launch(receiver);
    assert.equal((await fetch(receiverServer.endpoint + "/api/content-packs")).status, 403);
    assert.equal((await fetch(receiverServer.gateway.origin + "/api/content-packs")).status, 401);
    const hosted = await launch(receiver, false);
    try {
      assert.equal((await fetch(hosted.endpoint + "/api/content-packs/install", {
        method: "POST", headers: { "x-prowess-desktop-backend": hosted.backendToken },
      })).status, 403);
    } finally {
      await hosted.close();
    }
    const origin = await session(sourceServer);
    let destination = await session(receiverServer);
    const characters = [];
    const observed = [];
    for (const release of releases) {
      const downloaded = await origin(`/api/ruleset-releases/${release.releaseId}/content-pack`);
      assert.match(downloaded.headers.get("content-disposition"), /\.prowesspack"/);
      const bytes = Buffer.from(await downloaded.arrayBuffer());
      await writeFile(path.join(directory, `http-R${release.releaseNumber}.prowesspack`), bytes, { flag: "wx" });
      const upload = { method: "POST", body: bytes };
      const preview = await (await destination("/api/content-packs/preview", upload)).json();
      assert.equal(preview.state, "Ready");
      assert.equal((await (await destination("/api/content-packs")).json()).length, characters.length);
      const installed = await (await destination("/api/content-packs/install", {
        ...upload, headers: { "x-prowess-pack-preview": preview.previewFingerprint },
      })).json();
      assert.equal(installed.state, "Installed");
      assert.equal((await (await destination("/api/content-packs/preview", upload)).json()).state, "Already installed");
      const body = JSON.stringify({ name: `HTTP Character R${release.releaseNumber}`, rulesetReleaseId: release.releaseId });
      const saved = (await (await destination("/api/characters", { method: "POST", headers: { "content-type": "application/json" }, body })).json()).data;
      assert.equal(saved.release.id, release.releaseId);
      characters.push(saved);
      observed.push((await (await destination(`/api/characters/${saved.id}`)).json()).data);
    }
    await receiverServer.close();
    receiverServer = await launch(receiver);
    destination = await session(receiverServer);
    for (const [index, saved] of characters.entries()) {
      assert.deepEqual((await (await destination(`/api/characters/${saved.id}`)).json()).data, observed[index]);
    }
    return { stage: "production-http", unchangedAfterRestart: true, characters: characters.map((saved) => ({ id: saved.id, releaseId: saved.release.id })) };
  } finally {
    await Promise.all([sourceServer.close(), receiverServer?.close()]);
  }
}
