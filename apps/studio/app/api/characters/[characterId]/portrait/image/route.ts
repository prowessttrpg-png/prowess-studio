import { getCharacterPortraitImage } from "@prowess/db";
import { parseUuidParam, toErrorResponse } from "../../../../../../src/api/index";
import { strictQuery } from "../../../../../../src/api/m2/index";

/**
 * GET /api/characters/:characterId/portrait/image?v=… — the stored portrait bytes, served by the application under the
 * Character's own access model (never a public file path, §89). Only the validated raster type is ever sent, with
 * `nosniff` and a sandboxing CSP; a request naming the current content hash may be cached as immutable.
 */
export async function GET(request: Request, { params }: { params: Promise<{ characterId: string }> }): Promise<Response> {
  try {
    const { characterId } = await params;
    const searchParams = new URL(request.url).searchParams;
    strictQuery(searchParams, ["v"]);
    const image = await getCharacterPortraitImage(parseUuidParam(characterId, "characterId"));
    const pinned = searchParams.get("v") !== null && image.contentHash.startsWith(searchParams.get("v") as string);
    return new Response(Buffer.from(image.bytes), {
      status: 200,
      headers: {
        "Content-Type": image.mimeType,
        "Content-Length": String(image.bytes.byteLength),
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Content-Disposition": "inline",
        "Cache-Control": pinned ? "private, max-age=31536000, immutable" : "private, no-cache",
        ETag: `"${image.contentHash}"`,
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
