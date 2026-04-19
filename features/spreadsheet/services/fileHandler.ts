// Import / export .xlsx files via SheetJS, using expo-document-picker (already
// in the project) instead of react-native-document-picker.

import * as XLSX from 'xlsx';
import RNFS from 'react-native-fs';
import * as DocumentPicker from 'expo-document-picker';
import { Platform } from 'react-native';
import {
  Sheet,
  Cell,
  DEFAULT_ROW_COUNT,
  DEFAULT_COL_COUNT,
} from '../types/spreadsheet';
import { a1ToAddress } from '../engine/addressUtils';
import { recalculateSheet } from '../engine/formulaEngine';

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

const XLSX_MIMES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
];

function inferCellType(xlCell: XLSX.CellObject): Cell['type'] {
  if (!xlCell) return 'text';
  if (xlCell.t === 'n') return 'number';
  if (xlCell.t === 'b') return 'boolean';
  if (xlCell.f) return 'formula';
  return 'text';
}

function xlsxSheetToLocal(
  xlSheet: XLSX.WorkSheet,
  sheetName: string,
  sheetId: string,
): Sheet {
  const cells = new Map<string, Cell>();

  const ref = xlSheet['!ref'];
  const range = ref
    ? XLSX.utils.decode_range(ref)
    : { s: { r: 0, c: 0 }, e: { r: 50, c: 10 } };

  const rowCount = Math.max(range.e.r + 1, DEFAULT_ROW_COUNT);
  const colCount = Math.max(range.e.c + 1, DEFAULT_COL_COUNT);

  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const a1 = XLSX.utils.encode_cell({ r, c });
      const xlCell = xlSheet[a1] as XLSX.CellObject | undefined;
      if (!xlCell) continue;

      const cell: Cell = {
        value: xlCell.v !== undefined ? (xlCell.v as string | number | boolean) : null,
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

  const colInfo = xlSheet['!cols'];
  if (colInfo) {
    colInfo.forEach((col, i) => {
      if (col?.wpx) sheet.colWidths.set(i, col.wpx);
    });
  }

  const rowInfo = xlSheet['!rows'];
  if (rowInfo) {
    rowInfo.forEach((row, i) => {
      if (row?.hpx) sheet.rowHeights.set(i, row.hpx);
    });
  }

  return recalculateSheet(sheet);
}

export async function importXlsx(): Promise<ImportResult> {
  try {
    const picked = await DocumentPicker.getDocumentAsync({
      type: XLSX_MIMES,
      multiple: false,
      copyToCacheDirectory: true,
    });

    if (picked.canceled) {
      return { success: false, error: 'User cancelled' };
    }

    const asset = picked.assets?.[0];
    if (!asset?.uri) {
      return { success: false, error: 'No file returned by picker' };
    }

    const fileName = asset.name ?? 'spreadsheet.xlsx';

    // RNFS can read content:// URIs on Android and file:// URIs on iOS.
    const base64 = await RNFS.readFile(asset.uri, 'base64');

    const workbook = XLSX.read(base64, {
      type: 'base64',
      cellFormula: true,
      cellStyles: true,
    });

    const sheets: Sheet[] = workbook.SheetNames.map((name, idx) =>
      xlsxSheetToLocal(workbook.Sheets[name], name, `sheet_${idx}`),
    );

    return { success: true, sheets, fileName };
  } catch (err: any) {
    return { success: false, error: String(err?.message ?? err) };
  }
}

function localSheetToXlsx(sheet: Sheet): XLSX.WorkSheet {
  const xlSheet: XLSX.WorkSheet = {};
  let maxRow = 0;
  let maxCol = 0;

  for (const [key, cell] of sheet.cells.entries()) {
    try {
      const { row, col } = a1ToAddress(key);
      const xlAddr = XLSX.utils.encode_cell({ r: row, c: col });

      const isNumber =
        cell.type === 'number' || typeof cell.value === 'number';

      const xlCell: XLSX.CellObject = {
        t: isNumber ? 'n' : cell.type === 'boolean' ? 'b' : 's',
        v: cell.formula ? (cell.computed ?? cell.value ?? '') : (cell.value ?? ''),
      };

      if (cell.formula) {
        xlCell.f = cell.formula.startsWith('=')
          ? cell.formula.slice(1)
          : cell.formula;
      }

      if (isNumber) {
        xlCell.t = 'n';
        const n = Number(xlCell.v);
        xlCell.v = isNaN(n) ? 0 : n;
      }

      xlSheet[xlAddr] = xlCell;

      if (row > maxRow) maxRow = row;
      if (col > maxCol) maxCol = col;
    } catch {
      // Skip invalid keys silently.
    }
  }

  xlSheet['!ref'] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: maxRow, c: maxCol },
  });

  if (sheet.colWidths.size > 0) {
    const cols: XLSX.ColInfo[] = [];
    sheet.colWidths.forEach((width, col) => {
      cols[col] = { wpx: width };
    });
    xlSheet['!cols'] = cols;
  }

  return xlSheet;
}

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

    const dir =
      Platform.OS === 'android'
        ? RNFS.DownloadDirectoryPath
        : RNFS.DocumentDirectoryPath;

    const safeName = fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`;
    const filePath = `${dir}/${safeName}`;
    await RNFS.writeFile(filePath, base64, 'base64');

    return { success: true, filePath };
  } catch (err: any) {
    return { success: false, error: String(err?.message ?? err) };
  }
}

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
