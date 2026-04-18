// ============================================================
// utils/addressUtils.ts
// Converts between A1 notation and {row, col} coordinates
// ============================================================

import { CellAddress, CellRange } from '../types/spreadsheet';

/**
 * Converts column index (0-based) to letter(s)
 * 0 → "A", 25 → "Z", 26 → "AA"
 */
export function colIndexToLetter(col: number): string {
  let letter = '';
  let c = col;
  while (c >= 0) {
    letter = String.fromCharCode((c % 26) + 65) + letter;
    c = Math.floor(c / 26) - 1;
  }
  return letter;
}

/**
 * Converts column letter(s) to 0-based index
 * "A" → 0, "Z" → 25, "AA" → 26
 */
export function colLetterToIndex(letters: string): number {
  let result = 0;
  for (let i = 0; i < letters.length; i++) {
    result = result * 26 + (letters.charCodeAt(i) - 64);
  }
  return result - 1;
}

/**
 * Converts {row, col} (0-based) to A1 notation
 * {row: 0, col: 0} → "A1"
 */
export function addressToA1({ row, col }: CellAddress): string {
  return `${colIndexToLetter(col)}${row + 1}`;
}

/**
 * Parses A1 notation into {row, col} (0-based)
 * "A1" → {row: 0, col: 0}
 * "B10" → {row: 9, col: 1}
 */
export function a1ToAddress(a1: string): CellAddress {
  const match = a1.toUpperCase().match(/^([A-Z]+)(\d+)$/);
  if (!match) throw new Error(`Invalid A1 address: ${a1}`);
  return {
    col: colLetterToIndex(match[1]),
    row: parseInt(match[2], 10) - 1,
  };
}

/**
 * Parses a range like "A1:C10" into a CellRange
 */
export function a1RangeToRange(rangeStr: string): CellRange {
  const [startStr, endStr] = rangeStr.split(':');
  return {
    start: a1ToAddress(startStr),
    end: a1ToAddress(endStr),
  };
}

/**
 * Returns all cell addresses within a given range
 */
export function getCellsInRange(range: CellRange): CellAddress[] {
  const cells: CellAddress[] = [];
  const minRow = Math.min(range.start.row, range.end.row);
  const maxRow = Math.max(range.start.row, range.end.row);
  const minCol = Math.min(range.start.col, range.end.col);
  const maxCol = Math.max(range.start.col, range.end.col);

  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      cells.push({ row, col });
    }
  }
  return cells;
}

/**
 * Generates column header label for display
 */
export function getColumnLabel(col: number): string {
  return colIndexToLetter(col);
}

/**
 * Generates row header label for display
 */
export function getRowLabel(row: number): string {
  return String(row + 1);
}

/**
 * Check if a cell address is within a range
 */
export function isInRange(addr: CellAddress, range: CellRange): boolean {
  const minRow = Math.min(range.start.row, range.end.row);
  const maxRow = Math.max(range.start.row, range.end.row);
  const minCol = Math.min(range.start.col, range.end.col);
  const maxCol = Math.max(range.start.col, range.end.col);
  return (
    addr.row >= minRow &&
    addr.row <= maxRow &&
    addr.col >= minCol &&
    addr.col <= maxCol
  );
}

/**
 * Normalize a range so start <= end
 */
export function normalizeRange(range: CellRange): CellRange {
  return {
    start: {
      row: Math.min(range.start.row, range.end.row),
      col: Math.min(range.start.col, range.end.col),
    },
    end: {
      row: Math.max(range.start.row, range.end.row),
      col: Math.max(range.start.col, range.end.col),
    },
  };
}
