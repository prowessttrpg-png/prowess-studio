import { previewContentPack } from "@prowess/db";
import { contentPackError, contentPacksUnavailable, desktopContentPacksEnabled, readContentPackUpload } from "../../../../src/api/content-packs";

export async function POST(request: Request): Promise<Response> {
  if (!desktopContentPacksEnabled(request)) return contentPacksUnavailable();
  try {
    return Response.json(await previewContentPack(await readContentPackUpload(request)));
  } catch (error) {
    return contentPackError(error);
  }
}
