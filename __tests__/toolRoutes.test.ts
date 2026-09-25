/**
 * toolRoutes.test.ts
 * - Regression for Images to PDF converting only the first picked image: the
 *   Tools tab dropped the other images because only merge/compare tools got
 *   `additionalFiles`, and tool-processor read them for the same short list.
 * - Params survive expo-router's extra decode (one net decodeURIComponent).
 */

import {
  ADDITIONAL_FILE_TOOLS,
  buildToolRoute,
} from "@/utils/toolRoutes";

const SAF_URI =
  "content://com.android.externalstorage.documents/document/primary%3ADocs%2Fa.pdf";

const file = (name: string, uri = `file:///cache/${name}`, mimeType = "application/pdf") => ({
  uri,
  name,
  mimeType,
});

/** What the screen's useLocalSearchParams returns for a pushed param. */
const received = (value: string) => decodeURIComponent(value);

describe("buildToolRoute", () => {
  it("passes every picked image to Images to PDF", () => {
    const images = ["1.jpg", "2.jpg", "3.png"].map((n) =>
      file(n, undefined, n.endsWith("png") ? "image/png" : "image/jpeg"),
    );
    const route = buildToolRoute("jpg-to-pdf", images);

    expect(route.pathname).toBe("/tool-processor");
    expect(received(route.params.file)).toBe("1.jpg");
    expect(JSON.parse(received(route.params.additionalFiles))).toEqual([
      { uri: "file:///cache/2.jpg", name: "2.jpg", mimeType: "image/jpeg" },
      { uri: "file:///cache/3.png", name: "3.png", mimeType: "image/png" },
    ]);
  });

  it("passes the second PDF to merge, keeping SAF URIs intact", () => {
    const route = buildToolRoute("merge", [file("a.pdf"), file("b.pdf", SAF_URI)]);

    expect(JSON.parse(received(route.params.additionalFiles))).toEqual([
      { uri: SAF_URI, name: "b.pdf", mimeType: "application/pdf" },
    ]);
  });

  it("sends single-file tools no additionalFiles", () => {
    const route = buildToolRoute("compress", [file("a.pdf", SAF_URI)]);

    expect(route).toEqual({
      pathname: "/tool-processor",
      params: expect.not.objectContaining({ additionalFiles: expect.anything() }),
    });
    expect(received(route.params.tool)).toBe("compress");
    expect(received(route.params.fileUri)).toBe(SAF_URI);
  });

  it("opens dedicated screens and signing directly", () => {
    expect(buildToolRoute("find-replace", [file("a.pdf")]).pathname).toBe(
      "/find-replace",
    );
    expect(buildToolRoute("sign", [file("a.pdf")]).pathname).toBe(
      "/sign-document",
    );
  });

  it("is what tool-processor reads extra files for", () => {
    for (const tool of ["merge", "compare", "diff", "merge-review", "jpg-to-pdf", "png-to-pdf"]) {
      expect(ADDITIONAL_FILE_TOOLS.has(tool)).toBe(true);
    }
    expect(ADDITIONAL_FILE_TOOLS.has("compress")).toBe(false);
  });
});
