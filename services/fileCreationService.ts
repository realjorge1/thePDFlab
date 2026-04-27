import { createBlankDocx } from "@/utils/docx-utils";
import { saveDocxFromHtml } from "@/utils/docxGenerator";
import {
    generateFileName,
    MIME_TYPES,
    saveDocxToDevice,
    savePdfToDevice,
    shareFile as shareFileUtil,
    UTI_TYPES,
} from "@/utils/file-save-utils";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";

// Dynamic import helper for expo-print to avoid native module errors
const getPrintModule = async () => {
  const Print = await import("expo-print");
  return Print;
};

// Max pixel width for embedded images — balances quality vs. file size/speed.
const MAX_IMAGE_WIDTH = 1080;

export type FileType = "pdf" | "docx";
export type CreationMethod = "blank" | "image" | "camera";

export interface CreateFileResult {
  success: boolean;
  uri?: string;
  fileName?: string;
  error?: string;
}

export interface PickImagesResult {
  success: boolean;
  uris?: string[];
  error?: string;
  cancelled?: boolean;
}

/**
 * Launch gallery picker and return selected image URIs.
 * Callers should then navigate to a preview screen.
 */
export async function pickImagesFromLibrary(): Promise<PickImagesResult> {
  try {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      return {
        success: false,
        error: "Photo library access is required to pick images",
      };
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      quality: 1,
      selectionLimit: 0,
    });

    if (result.canceled) {
      return { success: false, cancelled: true };
    }

    const uris = result.assets.map((a) => a.uri);
    if (uris.length === 0) {
      return { success: false, error: "No images selected" };
    }
    return { success: true, uris };
  } catch (error) {
    return {
      success: false,
      error: `Failed to pick images: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Launch camera and return the captured image URI.
 */
export async function pickImageFromCamera(): Promise<PickImagesResult> {
  try {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      return {
        success: false,
        error: "Camera access is required to capture images",
      };
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      allowsEditing: false,
      quality: 1,
    });

    if (result.canceled) {
      return { success: false, cancelled: true };
    }

    const uris = result.assets.map((a) => a.uri);
    if (uris.length === 0) {
      return { success: false, error: "No image captured" };
    }
    return { success: true, uris };
  } catch (error) {
    return {
      success: false,
      error: `Failed to capture image: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Resize an image to MAX_IMAGE_WIDTH (if larger) then return a
 * base64 data URI encoded as JPEG.  Falls back to reading the
 * original file when the native manipulator module is unavailable
 * (e.g. Expo Go, web, or simulator without the native module linked).
 */
async function resizeAndEncode(uri: string): Promise<string> {
  try {
    const mod = await import("expo-image-manipulator");
    // SaveFormat may be a named export or on the default depending on version
    const SaveFormat: { JPEG: string } =
      (mod as any).SaveFormat ?? (mod as any).default?.SaveFormat;
    if (!SaveFormat?.JPEG) throw new Error("SaveFormat unavailable");

    const manipulateAsync: Function =
      (mod as any).manipulateAsync ?? (mod as any).default?.manipulateAsync;
    const manipResult = await manipulateAsync(
      uri,
      [{ resize: { width: MAX_IMAGE_WIDTH } }],
      { compress: 0.82, format: SaveFormat.JPEG },
    );
    const base64 = await FileSystem.readAsStringAsync(manipResult.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return `data:image/jpeg;base64,${base64}`;
  } catch {
    // Native module unavailable — embed the original image without resizing.
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const ext = uri.split(".").pop()?.toLowerCase() ?? "jpeg";
    const mime = ext === "png" ? "image/png" : "image/jpeg";
    return `data:${mime};base64,${base64}`;
  }
}

/**
 * Create a PDF from blank with heading and content
 */
export async function createPdfFromBlank(
  heading: string,
  content: string,
): Promise<CreateFileResult> {
  try {
    if (!heading && !content) {
      return {
        success: false,
        error: "Please enter a heading or content to create your PDF",
      };
    }

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
            }
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              padding: 60px 50px;
              line-height: 1.8;
              color: #1a1a1a;
            }
            h1 {
              font-size: 32px;
              font-weight: 700;
              color: #000;
              margin-bottom: 30px;
              letter-spacing: -0.5px;
            }
            p {
              font-size: 16px;
              line-height: 1.8;
              color: #333;
              white-space: pre-wrap;
              word-wrap: break-word;
            }
          </style>
        </head>
        <body>
          ${heading ? `<h1>${heading}</h1>` : ""}
          ${content ? `<p>${content}</p>` : ""}
        </body>
      </html>
    `;

    const Print = await getPrintModule();
    const { uri } = await Print.printToFileAsync({
      html,
      base64: false,
    });

    const fileName = generateFileName(heading, "pdf");
    console.log("PDF created at:", uri);

    return {
      success: true,
      uri,
      fileName,
    };
  } catch (error) {
    console.error("PDF creation error:", error);
    return {
      success: false,
      error: `Failed to create PDF: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Create a PDF from a list of image URIs with a user-supplied title.
 */
export async function createPdfFromImageUris(
  uris: string[],
  title: string,
): Promise<CreateFileResult> {
  try {
    if (!uris || uris.length === 0) {
      return { success: false, error: "No images provided" };
    }

    const dataUris = await Promise.all(uris.map(resizeAndEncode));
    const imagesHtml = dataUris
      .map(
        (src, idx) => `
      <div style="page-break-after: ${idx === dataUris.length - 1 ? "auto" : "always"}; text-align: center;">
        <img src="${src}" style="max-width: 100%; max-height: 100vh; object-fit: contain;" />
      </div>`,
      )
      .join("");

    const safeTitle = (title ?? "").trim();
    const titleHtml = safeTitle
      ? `<h1 style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 28px; font-weight: 700; margin: 0 0 24px 0; padding: 60px 50px 0 50px;">${safeTitle.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</h1>`
      : "";

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
            @media print { body { margin: 0; } }
          </style>
        </head>
        <body>
          ${titleHtml}
          ${imagesHtml}
        </body>
      </html>
    `;

    const Print = await getPrintModule();
    const { uri } = await Print.printToFileAsync({ html, base64: false });

    const fileName = generateFileName(safeTitle || "Images_PDF", "pdf");
    console.log("PDF from images created at:", uri);

    return { success: true, uri, fileName };
  } catch (error) {
    console.error("PDF from images error:", error);
    return {
      success: false,
      error: `Failed to create PDF from images: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Create a DOCX from blank with heading and content
 */
export async function createDocxFromBlank(
  heading: string,
  content: string,
): Promise<CreateFileResult> {
  try {
    if (!heading && !content) {
      return {
        success: false,
        error: "Please enter a heading or content to create your document",
      };
    }

    // Generate a unique filename based on heading and timestamp
    const baseFileName = heading.trim() || "Untitled";
    const timestamp = Date.now();
    const uniqueFileName = `${baseFileName}_${timestamp}`;

    // Pass the unique filename to createBlankDocx so the file has a unique path
    const uri = await createBlankDocx(heading, content, uniqueFileName);
    const fileName = generateFileName(heading, "docx");
    console.log("DOCX created at:", uri);

    return {
      success: true,
      uri,
      fileName,
    };
  } catch (error) {
    console.error("DOCX creation error:", error);
    return {
      success: false,
      error: `Failed to create DOCX: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Create a DOCX from a list of image URIs with a user-supplied title.
 */
export async function createDocxFromImageUris(
  uris: string[],
  title: string,
): Promise<CreateFileResult> {
  try {
    if (!uris || uris.length === 0) {
      return { success: false, error: "No images provided" };
    }

    const dataUris = await Promise.all(uris.map(resizeAndEncode));
    const imgTags = dataUris.map((src) => `<p><img src="${src}" /></p>`).join("");
    const safeTitle = (title ?? "").trim() || "Images Document";

    // Do NOT include <h1> here — generateDocxFromHtml always adds its own
    // title heading, so putting one in the HTML would duplicate the title.
    const html = imgTags;
    const timestamp = Date.now();
    const saved = await saveDocxFromHtml({
      html,
      title: safeTitle,
      fileName: `${safeTitle.replace(/[^a-zA-Z0-9_-]/g, "_")}_${timestamp}`,
    });

    if (!saved.success || !saved.uri) {
      return { success: false, error: saved.error ?? "Failed to create DOCX" };
    }

    const fileName = generateFileName(safeTitle, "docx");
    console.log("DOCX from images created at:", saved.uri);

    return { success: true, uri: saved.uri, fileName };
  } catch (error) {
    console.error("DOCX from images error:", error);
    return {
      success: false,
      error: `Failed to create DOCX from images: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Save a file (PDF or DOCX) to device storage
 */
export async function saveFile(
  fileType: FileType,
  uri: string,
  fileName?: string,
): Promise<boolean> {
  const finalFileName = generateFileName(
    fileName,
    fileType === "pdf" ? "pdf" : "docx",
  );

  if (fileType === "pdf") {
    return await savePdfToDevice(uri, finalFileName);
  } else {
    return await saveDocxToDevice(uri, finalFileName);
  }
}

/**
 * Share a file (PDF or DOCX) via system share sheet
 */
export async function shareFile(
  fileType: FileType,
  uri: string,
  fileName?: string,
): Promise<boolean> {
  const finalFileName = generateFileName(
    fileName,
    fileType === "pdf" ? "pdf" : "docx",
  );
  const mimeType = fileType === "pdf" ? MIME_TYPES.PDF : MIME_TYPES.DOCX;
  const uti = fileType === "pdf" ? UTI_TYPES.PDF : UTI_TYPES.DOCX;

  return await shareFileUtil({
    sourceUri: uri,
    fileName: finalFileName,
    mimeType,
    uti,
    dialogTitle: `Share ${fileType === "pdf" ? "PDF" : "Document"}`,
  });
}
