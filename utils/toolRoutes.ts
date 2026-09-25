/**
 * Routes into the PDF tool screens.
 * ─────────────────────────────────────────────────────────────────────
 * Shared by the Tools tab (which builds the route) and tool-processor
 * (which reads it back), so both agree on which tools take extra files.
 *
 * Usage:
 *   import { buildToolRoute } from "@/utils/toolRoutes";
 *   router.push(buildToolRoute(toolId, pickedFiles));
 * ─────────────────────────────────────────────────────────────────────
 */

export interface ToolFile {
  uri: string;
  name: string;
  mimeType: string;
}

/** Tools that take 2+ PDFs; the first is the main input. */
export const MULTI_FILE_TOOLS = new Set([
  "merge",
  "compare",
  "diff",
  "merge-review",
]);

/** Image converters: every picked image becomes a page. */
export const IMAGE_TO_PDF_TOOLS = new Set(["jpg-to-pdf", "png-to-pdf"]);

/** Tools that get the files after the first as `additionalFiles` (JSON). */
export const ADDITIONAL_FILE_TOOLS = new Set([
  ...MULTI_FILE_TOOLS,
  ...IMAGE_TO_PDF_TOOLS,
]);

/** Tools that have dedicated screens (not tool-processor). */
export const DEDICATED_SCREEN_TOOLS = {
  "extract-images": "/extract-images",
  "batch-compress": "/batch-compress",
  "find-replace": "/find-replace",
  "highlight-export": "/highlight-export",
  "citation-extractor": "/citation-extractor",
} as const;

type ToolPathname =
  | "/sign-document"
  | "/tool-processor"
  | (typeof DEDICATED_SCREEN_TOOLS)[keyof typeof DEDICATED_SCREEN_TOOLS];

/**
 * expo-router decodes params one extra time, which turns a SAF content://
 * URI's %3A/%2F into ':'/'/' and points it at the wrong document. Pre-encode
 * every value so screens receive exactly what we pass. Nullish values are
 * dropped, as the router would drop them anyway.
 */
export const encodeRouteParams = (
  params: Record<string, string | undefined>,
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(params)
      .filter((entry): entry is [string, string] => entry[1] != null)
      .map(([key, value]) => [key, encodeURIComponent(value)]),
  );

/**
 * The route that opens `toolId` on the picked files. The first file is the
 * main input; tools in ADDITIONAL_FILE_TOOLS get the rest as JSON.
 */
export function buildToolRoute(
  toolId: string,
  files: ToolFile[],
): { pathname: ToolPathname; params: Record<string, string> } {
  const [file, ...rest] = files;
  const fileParams = {
    file: file.name,
    fileUri: file.uri,
    fileMimeType: file.mimeType,
  };

  if (toolId === "sign") {
    return { pathname: "/sign-document", params: encodeRouteParams(fileParams) };
  }
  if (toolId in DEDICATED_SCREEN_TOOLS) {
    return {
      pathname:
        DEDICATED_SCREEN_TOOLS[toolId as keyof typeof DEDICATED_SCREEN_TOOLS],
      params: encodeRouteParams(fileParams),
    };
  }

  const additionalFiles =
    ADDITIONAL_FILE_TOOLS.has(toolId) && rest.length > 0
      ? JSON.stringify(
          rest.map((f) => ({ uri: f.uri, name: f.name, mimeType: f.mimeType })),
        )
      : undefined;
  return {
    pathname: "/tool-processor",
    params: encodeRouteParams({ tool: toolId, ...fileParams, additionalFiles }),
  };
}
