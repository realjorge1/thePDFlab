// Core data model for the spreadsheet feature.

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
  formula?: string;
  computed?: string | number;
  style?: CellStyle;
  type?: 'text' | 'number' | 'formula' | 'boolean';
};

export type Sheet = {
  id: string;
  name: string;
  cells: Map<string, Cell>;
  rowCount: number;
  colCount: number;
  rowHeights: Map<number, number>;
  colWidths: Map<number, number>;
  frozenRows?: number;
  frozenCols?: number;
};

export type CellAddress = {
  row: number;
  col: number;
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

export type HistoryEntry = {
  sheetId: string;
  changes: Map<string, { before: Cell | undefined; after: Cell | undefined }>;
};

export const DEFAULT_ROW_HEIGHT = 28;
export const DEFAULT_COL_WIDTH = 96;
export const DEFAULT_ROW_COUNT = 100;
export const DEFAULT_COL_COUNT = 26;
export const HEADER_HEIGHT = 26;
export const ROW_HEADER_WIDTH = 44;
