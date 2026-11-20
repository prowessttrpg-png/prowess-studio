import { lookupSourceSections } from "@prowess/db";
import { ApiError, apiSuccess, serializeForApi, toErrorResponse } from "../../../../src/api/index";

/**
 * GET /api/compendium-rules/source-sections?q=&locators=s1,s2&snapshotId= — RULES-WO1 readable source picker: section
 * titles of an imported rulebook snapshot matching `q`, and the titles of the given section keys. Read-only.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const params = new URL(request.url).searchParams;
    const unknown = [...params.keys()].filter((k) => !["q", "locators", "snapshotId"].includes(k));
    if (unknown.length > 0) throw new ApiError("API.INVALID_QUERY", `Unknown parameter(s): ${unknown.join(", ")}`, 400);
    const locators = (params.get("locators") ?? "").split(",").map((x) => x.trim()).filter((x) => x !== "");
    return apiSuccess(serializeForApi(await lookupSourceSections({ q: params.get("q") ?? "", locators, snapshotId: params.get("snapshotId") ?? undefined })));
  } catch (error) {
    return toErrorResponse(error);
  }
}
