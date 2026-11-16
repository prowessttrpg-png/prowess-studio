import { getRuleset, getRulesetRelease } from "@prowess/db";
import { exportContentPack } from "@prowess/db/content-packs";
import { contentPackError, contentPacksUnavailable, desktopContentPacksEnabled } from "../../../../../src/api/content-packs";
import { parseUuidParam } from "../../../../../src/api/index";

export async function GET(request: Request, { params }: { params: Promise<{ releaseId: string }> }): Promise<Response> {
  const producerId = process.env.PROWESS_DESKTOP_WORKSPACE_ID;
  if (!desktopContentPacksEnabled(request) || !producerId) return contentPacksUnavailable();
  try {
    const releaseId = parseUuidParam((await params).releaseId, "releaseId");
    const release = await getRulesetRelease(releaseId);
    const ruleset = await getRuleset(release.rulesetId);
    const bytes = await exportContentPack(releaseId, {
      producerId,
      label: `${ruleset.name} — ${release.versionLabel}`.slice(0, 200).trim(),
      provenance: { claimedCreator: ruleset.name.slice(0, 200).trim(), category: "community" },
    });
    return new Response(Uint8Array.from(bytes), { headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="Prowess-Release-${release.releaseNumber}-${releaseId}.prowesspack"`,
      "Cache-Control": "no-store",
    } });
  } catch (error) {
    return contentPackError(error);
  }
}
