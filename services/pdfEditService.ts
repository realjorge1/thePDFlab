/**
 * PDF Edit Service
 * Backs the in-place PDF editor in the viewer (3-dot menu → Edit).
 *
 * Flow:
 *   1. Enter edit mode  →  fetchPdfAsHtml()      — backend converts PDF → HTML
 *   2. Wrap in editor   →  generatePdfEditorHtml() — contentEditable template
 *   3. User edits inline in a WebView (cursor, typing, native keyboard)
 *   4. Save             →  savePdfFromHtml()     — backend converts HTML → PDF
 *
 * Mirrors the DOCX edit pattern in services/docxService.ts.
 *
 * Trade-off: round-tripping through HTML loses some layout fidelity (multi-
 * column layouts, embedded fonts, complex tables). Plain text edits and
 * basic formatting survive cleanly.
 */

import { API_BASE_URL } from "@/config/api";
import * as FileSystem from "expo-file-system/legacy";

/**
 * Convert the PDF at `fileUri` to HTML via the backend.
 * Returns the raw HTML body the editor will host.
 *
 * Accepts an optional AbortSignal so the host UI can cancel a slow conversion.
 */
export async function fetchPdfAsHtml(
  fileUri: string,
  fileName: string,
  signal?: AbortSignal,
): Promise<string> {
  const form = new FormData();
  form.append("pdf", {
    uri: fileUri,
    name: fileName || "document.pdf",
    type: "application/pdf",
  } as any);

  const resp = await fetch(`${API_BASE_URL}/convert/pdf-to-html`, {
    method: "POST",
    body: form,
    signal,
  });

  if (!resp.ok) {
    let message = "Could not convert PDF to editable form.";
    try {
      const err = await resp.json();
      if (err?.error) message = err.error;
    } catch {
      /* binary response body */
    }
    throw new Error(message);
  }

  return await resp.text();
}

/**
 * Wrap raw HTML in a self-contained contentEditable editor template.
 * The WebView posts its current innerHTML back via window.getEditorContent()
 * when the host injects a save-trigger script.
 */
export function generatePdfEditorHtml(htmlContent: string): string {
  // Strip any outer <html>/<head>/<body> tags from the backend's HTML so we
  // can host the body content in our editor.
  const bodyMatch = htmlContent.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const innerHtml = bodyMatch ? bodyMatch[1] : htmlContent;

  return `
<!DOCTYPE html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <style>
      * { box-sizing: border-box; }
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        padding: 0;
        margin: 0;
        background-color: #ffffff;
      }
      #editor {
        min-height: 100vh;
        padding: 16px;
        outline: none;
        line-height: 1.6;
        font-size: 16px;
        color: #1a1a1a;
        -webkit-font-smoothing: antialiased;
        caret-color: #2563eb;
      }
      #editor:focus { outline: none; }
      #editor img {
        max-width: 100%;
        height: auto;
        display: block;
        margin: 8px 0;
      }
      #editor table {
        border-collapse: collapse;
        width: 100%;
        margin: 12px 0;
      }
      #editor table td, #editor table th {
        border: 1px solid #ccc;
        padding: 6px 10px;
        vertical-align: top;
        word-break: break-word;
      }
      #editor h1, #editor h2, #editor h3, #editor h4, #editor h5, #editor h6 {
        margin-top: 24px;
        margin-bottom: 12px;
        font-weight: 600;
      }
      #editor p { margin: 12px 0; }
      #editor div { min-height: 1em; }
    </style>
  </head>
  <body>
    <div id="editor" contenteditable="true">${innerHtml}</div>
    <script>
      // Host calls this via injectJavaScript to extract current content.
      window.getEditorContent = function() {
        var ed = document.getElementById('editor');
        return ed ? ed.innerHTML : '';
      };

      // Notify host that the editor is mounted and ready for input.
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'editor-loaded',
          success: true
        }));
      }

      // Auto-focus so the cursor is ready for the user to start typing.
      setTimeout(function() {
        var ed = document.getElementById('editor');
        if (ed) ed.focus();
      }, 100);
    </script>
  </body>
</html>
`;
}

/**
 * Send the editor's HTML to the backend for conversion to PDF, then write
 * the returned PDF bytes to the cache directory and return its file URI.
 */
export async function savePdfFromHtml(
  htmlContent: string,
  originalFileName: string,
): Promise<string> {
  // Wrap the editor's body innerHTML in a complete document so the backend's
  // HTML-to-PDF renderer (e.g. puppeteer) gets a proper page to render.
  const fullHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      padding: 24px;
      line-height: 1.6;
      color: #1a1a1a;
    }
    img { max-width: 100%; height: auto; }
    table { border-collapse: collapse; width: 100%; }
    table td, table th { border: 1px solid #ccc; padding: 6px 10px; }
    h1, h2, h3, h4, h5, h6 { margin-top: 18pt; margin-bottom: 8pt; font-weight: 600; }
    p { margin: 8pt 0; }
  </style>
</head>
<body>${htmlContent}</body>
</html>`;

  const resp = await fetch(`${API_BASE_URL}/convert/html-to-pdf`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ html: fullHtml }),
  });

  if (!resp.ok) {
    let message = "Could not save PDF.";
    try {
      const err = await resp.json();
      if (err?.error) message = err.error;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(message);
  }

  const blob = await resp.blob();
  const base64 = await blobToBase64(blob);

  const baseName = (originalFileName || "document.pdf").replace(/\.[^/.]+$/, "");
  const newName = `${baseName}_edited.pdf`;
  const newUri = `${FileSystem.cacheDirectory}${newName}`;

  await FileSystem.writeAsStringAsync(newUri, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });

  return newUri;
}

// arrayBuffer() + chunked btoa avoids FileReader's data-URL prefix overhead
// and reduces peak memory vs the legacy FileReader path.
async function blobToBase64(blob: Blob): Promise<string> {
  if (typeof (blob as any).arrayBuffer === "function") {
    try {
      const arrayBuf = await blob.arrayBuffer();
      const uint8 = new Uint8Array(arrayBuf);
      const CHUNK = 8192;
      let binary = "";
      for (let i = 0; i < uint8.length; i += CHUNK) {
        binary += String.fromCharCode(...uint8.subarray(i, i + CHUNK));
      }
      return btoa(binary);
    } catch {
      /* fall through */
    }
  }
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
