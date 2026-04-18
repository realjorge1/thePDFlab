// ============================================================
// utils/fileHandler.ts
// Handles importing and exporting .xlsx files via SheetJS
// Requires: npm install xlsx react-native-fs react-native-document-picker
// ============================================================

import * as XLSX from 'xlsx';
import RNFS from 'react-native-fs';
import DocumentPicker from 'react-native-document-picker';
import { Platform, Alert } from 'react-native';
import {
  Sheet,
  Cell,
  CellStyle,
  DEFAULT_ROW_COUNT,
  DEFAULT_COL_COUNT,
} from '../types/spreadsheet';
import { a1ToAddress, addressToA1, colIndexToLetter } from './addressUtils';
import { recalculateSheet } from './formulaEngine';

// ── Types ─────────────────────────────────────────────────

export type ImportResult = {
  success: boolean;
  sheets?: Sheet[];
  fileName?: string;
  error?: string;
};

export type ExportResult = {
  success: boolean;
  filePath?: string;
  error?: string;
};

// ── Helpers ───────────────────────────────────────────────

function xlsxStyleToLocal(xfId: unknown): CellStyle | undefined {
  // Minimal style mapping — extend as needed
  return undefined;
}

/**
 * Determines cell type from SheetJS cell object
 */
function inferCellType(xlCell: XLSX.CellObject): Cell['type'] {
  if (!xlCell) return 'text';
  if (xlCell.t === 'n') return 'number';
  if (xlCell.t === 'b') return 'boolean';
  if (xlCell.f) return 'formula';
  return 'text';
}

// ── Import ────────────────────────────────────────────────

/**
 * Converts a SheetJS worksheet into our internal Sheet model
 */
function xlsxSheetToLocal(
  xlSheet: XLSX.WorkSheet,
  sheetName: string,
  sheetId: string,
): Sheet {
  const cells = new Map<string, Cell>();

  const ref = xlSheet['!ref'];
  const range = ref ? XLSX.utils.decode_range(ref) : { s: { r: 0, c: 0 }, e: { r: 50, c: 10 } };

  const rowCount = Math.max(range.e.r + 1, DEFAULT_ROW_COUNT);
  const colCount = Math.max(range.e.c + 1, DEFAULT_COL_COUNT);

  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const a1 = XLSX.utils.encode_cell({ r, c });
      const xlCell = xlSheet[a1] as XLSX.CellObject | undefined;
      if (!xlCell) continue;

      const cell: Cell = {
        value: xlCell.v !== undefined ? xlCell.v as string | number | boolean : null,
        type: inferCellType(xlCell),
      };

      if (xlCell.f) {
        cell.formula = `=${xlCell.f}`;
        cell.computed = xlCell.v as string | number;
      }

      cells.set(a1.toUpperCase(), cell);
    }
  }

  const sheet: Sheet = {
    id: sheetId,
    name: sheetName,
    cells,
    rowCount,
    colCount,
    rowHeights: new Map(),
    colWidths: new Map(),
  };

  // Handle column widths from xlsx
  const colInfo = xlSheet['!cols'];
  if (colInfo) {
    colInfo.forEach((col, i) => {
      if (col?.wpx) sheet.colWidths.set(i, col.wpx);
    });
  }

  // Handle row heights from xlsx
  const rowInfo = xlSheet['!rows'];
  if (rowInfo) {
    rowInfo.forEach((row, i) => {
      if (row?.hpx) sheet.rowHeights.set(i, row.hpx);
    });
  }

  return recalculateSheet(sheet);
}

/**
 * Let the user pick a .xlsx file and import it
 */
export async function importXlsx(): Promise<ImportResult> {
  try {
    const result = await DocumentPicker.pickSingle({
      type: [DocumentPicker.types.xls, DocumentPicker.types.xlsx],
    });

    const fileUri = result.uri;
    const fileName = result.name ?? 'spreadsheet.xlsx';

    // Read file as base64
    const base64 = await RNFS.readFile(fileUri, 'base64');

    // Parse with SheetJS
    const workbook = XLSX.read(base64, { type: 'base64', cellFormula: true, cellStyles: true });

    const sheets: Sheet[] = workbook.SheetNames.map((name, idx) =>
      xlsxSheetToLocal(workbook.Sheets[name], name, `sheet_${idx}`),
    );

    return { success: true, sheets, fileName };
  } catch (err: any) {
    if (DocumentPicker.isCancel(err)) {
      return { success: false, error: 'User cancelled' };
    }
    return { success: false, error: String(err?.message ?? err) };
  }
}

// ── Export ────────────────────────────────────────────────

/**
 * Converts our internal Sheet model to a SheetJS worksheet
 */
function localSheetToXlsx(sheet: Sheet): XLSX.WorkSheet {
  const xlSheet: XLSX.WorkSheet = {};
  let maxRow = 0;
  let maxCol = 0;

  for (const [key, cell] of sheet.cells.entries()) {
    try {
      const { row, col } = a1ToAddress(key);
      const xlAddr = XLSX.utils.encode_cell({ r: row, c: col });

      const xlCell: XLSX.CellObject = {
        t: cell.type === 'number' ? 'n' : cell.type === 'boolean' ? 'b' : 's',
        v: cell.formula ? (cell.computed ?? cell.value) : (cell.value ?? ''),
      };

      if (cell.formula) {
        xlCell.f = cell.formula.startsWith('=') ? cell.formula.slice(1) : cell.formula;
      }

      if (cell.type === 'number' || typeof cell.value === 'number') {
        xlCell.t = 'n';
        xlCell.v = Number(xlCell.v);
      }

      xlSheet[xlAddr] = xlCell;

      if (row > maxRow) maxRow = row;
      if (col > maxCol) maxCol = col;
    } catch {
      // Skip invalid cell keys
    }
  }

  // Set the cell range reference
  xlSheet['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxRow, c: maxCol } });

  // Column widths
  if (sheet.colWidths.size > 0) {
    const cols: XLSX.ColInfo[] = [];
    sheet.colWidths.forEach((width, col) => {
      cols[col] = { wpx: width };
    });
    xlSheet['!cols'] = cols;
  }

  return xlSheet;
}

/**
 * Exports the current sheets to a .xlsx file on device
 * Returns the file path on success
 */
export async function exportXlsx(
  sheets: Sheet[],
  fileName: string = 'spreadsheet.xlsx',
): Promise<ExportResult> {
  try {
    const workbook = XLSX.utils.book_new();

    sheets.forEach(sheet => {
      const xlSheet = localSheetToXlsx(sheet);
      XLSX.utils.book_append_sheet(workbook, xlSheet, sheet.name);
    });

    const base64 = XLSX.write(workbook, { type: 'base64', bookType: 'xlsx' });

    // Determine output path
    const dir =
      Platform.OS === 'android'
        ? RNFS.DownloadDirectoryPath
        : RNFS.DocumentDirectoryPath;

    const filePath = `${dir}/${fileName}`;
    await RNFS.writeFile(filePath, base64, 'base64');

    return { success: true, filePath };
  } catch (err: any) {
    return { success: false, error: String(err?.message ?? err) };
  }
}

/**
 * Creates a blank workbook with one empty sheet
 */
export function createBlankSheets(): Sheet[] {
  return [
    {
      id: 'sheet_0',
      name: 'Sheet1',
      cells: new Map(),
      rowCount: DEFAULT_ROW_COUNT,
      colCount: DEFAULT_COL_COUNT,
      rowHeights: new Map(),
      colWidths: new Map(),
    },
  ];
}
