// ============================================================
// utils/persistence.ts  [NEW — OFFLINE PERSISTENCE]
//
// Auto-saves spreadsheet state to the device's local filesystem.
// No network. No cloud. No internet required — ever.
//
// Strategy:
//   • Primary store : RNFS local JSON file (survives app restarts)
//   • Format        : JSON with Map serialized as [key,value][] arrays
//   • Auto-save     : debounced 1.5s after last change
//   • File location : <DocumentDirectory>/spreadsheet_autosave.json
// ============================================================

import RNFS from 'react-native-fs';
import { Sheet, Cell, CellStyle } from '../types/spreadsheet';

// ─────────────────────────────────────────────────────────────
// Paths — all local, no network
// ─────────────────────────────────────────────────────────────

const SAVE_DIR  = RNFS.DocumentDirectoryPath;  // Always writable, private to app
const SAVE_FILE = `${SAVE_DIR}/spreadsheet_autosave.json`;
const BACKUP_FILE = `${SAVE_DIR}/spreadsheet_backup.json`;

// ─────────────────────────────────────────────────────────────
// Serialization helpers
// Maps cannot be JSON.stringified directly
// ─────────────────────────────────────────────────────────────

type SerializedSheet = {
  id: string;
  name: string;
  cells: [string, Cell][];
  rowCount: number;
  colCount: number;
  rowHeights: [number, number][];
  colWidths: [number, number][];
  frozenRows?: number;
  frozenCols?: number;
};

type SaveFile = {
  version: number;
  savedAt: string;
  fileName: string;
  activeSheetIndex: number;
  sheets: SerializedSheet[];
};

function serializeSheet(sheet: Sheet): SerializedSheet {
  return {
    id:             sheet.id,
    name:           sheet.name,
    cells:          Array.from(sheet.cells.entries()),
    rowCount:       sheet.rowCount,
    colCount:       sheet.colCount,
    rowHeights:     Array.from(sheet.rowHeights.entries()),
    colWidths:      Array.from(sheet.colWidths.entries()),
    frozenRows:     sheet.frozenRows,
    frozenCols:     sheet.frozenCols,
  };
}

function deserializeSheet(raw: SerializedSheet): Sheet {
  return {
    id:         raw.id,
    name:       raw.name,
    cells:      new Map(raw.cells),
    rowCount:   raw.rowCount,
    colCount:   raw.colCount,
    rowHeights: new Map(raw.rowHeights),
    colWidths:  new Map(raw.colWidths),
    frozenRows: raw.frozenRows,
    frozenCols: raw.frozenCols,
  };
}

// ─────────────────────────────────────────────────────────────
// Core save / load
// ─────────────────────────────────────────────────────────────

export type SavePayload = {
  sheets: Sheet[];
  activeSheetIndex: number;
  fileName: string;
};

/**
 * Writes current state to the device's local filesystem.
 * Completely offline — uses RNFS DocumentDirectory.
 */
export async function saveToDevice(payload: SavePayload): Promise<void> {
  try {
    // Rotate backup before overwriting
    const exists = await RNFS.exists(SAVE_FILE);
    if (exists) {
      await RNFS.copyFile(SAVE_FILE, BACKUP_FILE);
    }

    const saveData: SaveFile = {
      version:           2,
      savedAt:           new Date().toISOString(),
      fileName:          payload.fileName,
      activeSheetIndex:  payload.activeSheetIndex,
      sheets:            payload.sheets.map(serializeSheet),
    };

    await RNFS.writeFile(SAVE_FILE, JSON.stringify(saveData), 'utf8');
  } catch (err) {
    console.warn('[Persistence] Save failed:', err);
  }
}

/**
 * Loads previously saved state from device local storage.
 * Returns null if nothing saved yet or on any read error.
 */
export async function loadFromDevice(): Promise<SavePayload | null> {
  try {
    const exists = await RNFS.exists(SAVE_FILE);
    if (!exists) return null;

    const raw = await RNFS.readFile(SAVE_FILE, 'utf8');
    const data: SaveFile = JSON.parse(raw);

    if (!data?.sheets?.length) return null;

    return {
      sheets:            data.sheets.map(deserializeSheet),
      activeSheetIndex:  data.activeSheetIndex ?? 0,
      fileName:          data.fileName ?? 'autosave.xlsx',
    };
  } catch (err) {
    console.warn('[Persistence] Load failed, trying backup:', err);
    return loadFromBackup();
  }
}

/**
 * Falls back to the backup file if primary is corrupt.
 */
async function loadFromBackup(): Promise<SavePayload | null> {
  try {
    const exists = await RNFS.exists(BACKUP_FILE);
    if (!exists) return null;

    const raw = await RNFS.readFile(BACKUP_FILE, 'utf8');
    const data: SaveFile = JSON.parse(raw);

    if (!data?.sheets?.length) return null;

    return {
      sheets:            data.sheets.map(deserializeSheet),
      activeSheetIndex:  data.activeSheetIndex ?? 0,
      fileName:          data.fileName ?? 'backup.xlsx',
    };
  } catch {
    return null;
  }
}

/**
 * Wipes both save files (used for "New Spreadsheet" flow).
 */
export async function clearSavedData(): Promise<void> {
  try {
    if (await RNFS.exists(SAVE_FILE))   await RNFS.unlink(SAVE_FILE);
    if (await RNFS.exists(BACKUP_FILE)) await RNFS.unlink(BACKUP_FILE);
  } catch {
    // Ignore
  }
}

/**
 * Returns metadata about the current save file without loading all data.
 */
export async function getSaveInfo(): Promise<{ savedAt: string; fileName: string } | null> {
  try {
    const exists = await RNFS.exists(SAVE_FILE);
    if (!exists) return null;
    const raw  = await RNFS.readFile(SAVE_FILE, 'utf8');
    const data = JSON.parse(raw) as Partial<SaveFile>;
    return { savedAt: data.savedAt ?? '', fileName: data.fileName ?? '' };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// Debounced auto-save
// ─────────────────────────────────────────────────────────────

let _debounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Call this on every store change. Debounces 1.5s to avoid
 * writing on every keystroke.
 */
export function scheduleAutoSave(payload: SavePayload): void {
  if (_debounceTimer) clearTimeout(_debounceTimer);
  _debounceTimer = setTimeout(() => {
    saveToDevice(payload);
    _debounceTimer = null;
  }, 1500);
}

/**
 * Flush any pending auto-save immediately.
 * Call this before the app goes to background.
 */
export async function flushAutoSave(payload: SavePayload): Promise<void> {
  if (_debounceTimer) {
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
  }
  await saveToDevice(payload);
}
