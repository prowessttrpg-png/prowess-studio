import { installContentPack } from "@prowess/db";
import { contentPackError, contentPacksUnavailable, desktopContentPacksEnabled, readContentPackUpload } from "../../../../src/api/content-packs";

export async function POST(request: Request): Promise<Response> {
  if (!desktopContentPacksEnabled(request)) return contentPacksUnavailable();
  const fingerprint = request.headers.get("x-prowess-pack-preview");
  if (!fingerprint || !/^[a-f0-9]{64}$/.test(fingerprint)) return Response.json({ error: "Preview the file before installing." }, { status: 400 });
  try {
    return Response.json(await installContentPack(await readContentPackUpload(request), fingerprint));
  } catch (error) {
    return contentPackError(error);
  }
}
