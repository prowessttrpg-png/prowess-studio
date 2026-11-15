import { listInstalledContentPacks } from "@prowess/db";
import { contentPackError, contentPacksUnavailable, desktopContentPacksEnabled } from "../../../src/api/content-packs";

export async function GET(request: Request): Promise<Response> {
  if (!desktopContentPacksEnabled(request)) return contentPacksUnavailable();
  try {
    return Response.json(await listInstalledContentPacks());
  } catch (error) {
    return contentPackError(error);
  }
}
