// ============================================================
// types/spreadsheet.ts
// Core data model for the spreadsheet engine
// ============================================================

export type CellStyle = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  fontSize?: number;
  fontColor?: string;
  backgroundColor?: string;
  align?: 'left' | 'center' | 'right';
  wrap?: boolean;
};

export type Cell = {
  value: string | number | boolean | null;
  formula?: string;          // raw formula: "=SUM(A1:A5)"
  computed?: string | number; // evaluated result
  style?: CellStyle;
  type?: 'text' | 'number' | 'formula' | 'boolean';
};

export type Sheet = {
  id: string;
  name: string;
  cells: Map<string, Cell>;  // key = "A1", "B2", etc.
  rowCount: number;
  colCount: number;
  rowHeights: Map<number, number>;   // custom row heights
  colWidths: Map<number, number>;    // custom col widths
  frozenRows?: number;
  frozenCols?: number;
};

export type CellAddress = {
  row: number;  // 0-indexed
  col: number;  // 0-indexed
};

export type CellRange = {
  start: CellAddress;
  end: CellAddress;
};

export type Selection = {
  cell: CellAddress;
  range?: CellRange;
};

export type EditingState = {
  address: CellAddress;
  value: string;
  isFormulaMode: boolean;
};

export type SpreadsheetState = {
  sheets: Sheet[];
  activeSheetIndex: number;
  selection: Selection | null;
  editing: EditingState | null;
  clipboard: { cells: Map<string, Cell>; range: CellRange } | null;
  history: HistoryEntry[];
  historyIndex: number;
};

export type HistoryEntry = {
  sheetId: string;
  changes: Map<string, { before: Cell | undefined; after: Cell | undefined }>;
};

// Default constants
export const DEFAULT_ROW_HEIGHT = 24;
export const DEFAULT_COL_WIDTH = 80;
export const DEFAULT_ROW_COUNT = 100;
export const DEFAULT_COL_COUNT = 26;
export const HEADER_HEIGHT = 24;
export const ROW_HEADER_WIDTH = 40;
