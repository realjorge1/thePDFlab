// Auto-saves spreadsheet state to the device's local filesystem.
// No network. No cloud.

import RNFS from 'react-native-fs';
import { Sheet, Cell } from '../types/spreadsheet';

const SAVE_DIR = RNFS.DocumentDirectoryPath;
const SAVE_FILE = `${SAVE_DIR}/spreadsheet_autosave.json`;
const BACKUP_FILE = `${SAVE_DIR}/spreadsheet_backup.json`;

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
    id: sheet.id,
    name: sheet.name,
    cells: Array.from(sheet.cells.entries()),
    rowCount: sheet.rowCount,
    colCount: sheet.colCount,
    rowHeights: Array.from(sheet.rowHeights.entries()),
    colWidths: Array.from(sheet.colWidths.entries()),
    frozenRows: sheet.frozenRows,
    frozenCols: sheet.frozenCols,
  };
}

function deserializeSheet(raw: SerializedSheet): Sheet {
  return {
    id: raw.id,
    name: raw.name,
    cells: new Map(raw.cells),
    rowCount: raw.rowCount,
    colCount: raw.colCount,
    rowHeights: new Map(raw.rowHeights),
    colWidths: new Map(raw.colWidths),
    frozenRows: raw.frozenRows,
    frozenCols: raw.frozenCols,
  };
}

export type SavePayload = {
  sheets: Sheet[];
  activeSheetIndex: number;
  fileName: string;
};

export async function saveToDevice(payload: SavePayload): Promise<void> {
  try {
    const exists = await RNFS.exists(SAVE_FILE);
    if (exists) {
      try {
        // Best-effort backup rotation; ignore copy failures.
        await RNFS.copyFile(SAVE_FILE, BACKUP_FILE);
      } catch {}
    }

    const saveData: SaveFile = {
      version: 2,
      savedAt: new Date().toISOString(),
      fileName: payload.fileName,
      activeSheetIndex: payload.activeSheetIndex,
      sheets: payload.sheets.map(serializeSheet),
    };

    await RNFS.writeFile(SAVE_FILE, JSON.stringify(saveData), 'utf8');
  } catch (err) {
    console.warn('[Spreadsheet/Persistence] Save failed:', err);
  }
}

export async function loadFromDevice(): Promise<SavePayload | null> {
  try {
    const exists = await RNFS.exists(SAVE_FILE);
    if (!exists) return null;
    const raw = await RNFS.readFile(SAVE_FILE, 'utf8');
    const data: SaveFile = JSON.parse(raw);
    if (!data?.sheets?.length) return null;
    return {
      sheets: data.sheets.map(deserializeSheet),
      activeSheetIndex: data.activeSheetIndex ?? 0,
      fileName: data.fileName ?? 'autosave.xlsx',
    };
  } catch (err) {
    console.warn('[Spreadsheet/Persistence] Load failed, trying backup:', err);
    return loadFromBackup();
  }
}

async function loadFromBackup(): Promise<SavePayload | null> {
  try {
    const exists = await RNFS.exists(BACKUP_FILE);
    if (!exists) return null;
    const raw = await RNFS.readFile(BACKUP_FILE, 'utf8');
    const data: SaveFile = JSON.parse(raw);
    if (!data?.sheets?.length) return null;
    return {
      sheets: data.sheets.map(deserializeSheet),
      activeSheetIndex: data.activeSheetIndex ?? 0,
      fileName: data.fileName ?? 'backup.xlsx',
    };
  } catch {
    return null;
  }
}

export async function clearSavedData(): Promise<void> {
  try {
    if (await RNFS.exists(SAVE_FILE)) await RNFS.unlink(SAVE_FILE);
    if (await RNFS.exists(BACKUP_FILE)) await RNFS.unlink(BACKUP_FILE);
  } catch {}
}

let _debounceTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleAutoSave(payload: SavePayload): void {
  if (_debounceTimer) clearTimeout(_debounceTimer);
  _debounceTimer = setTimeout(() => {
    saveToDevice(payload);
    _debounceTimer = null;
  }, 1500);
}

export async function flushAutoSave(payload: SavePayload): Promise<void> {
  if (_debounceTimer) {
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
  }
  await saveToDevice(payload);
}
