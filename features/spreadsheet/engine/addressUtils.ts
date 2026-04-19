import { CellAddress, CellRange } from '../types/spreadsheet';

export function colIndexToLetter(col: number): string {
  let letter = '';
  let c = col;
  while (c >= 0) {
    letter = String.fromCharCode((c % 26) + 65) + letter;
    c = Math.floor(c / 26) - 1;
  }
  return letter;
}

export function colLetterToIndex(letters: string): number {
  let result = 0;
  for (let i = 0; i < letters.length; i++) {
    result = result * 26 + (letters.charCodeAt(i) - 64);
  }
  return result - 1;
}

export function addressToA1({ row, col }: CellAddress): string {
  return `${colIndexToLetter(col)}${row + 1}`;
}

export function a1ToAddress(a1: string): CellAddress {
  const match = a1.toUpperCase().match(/^([A-Z]+)(\d+)$/);
  if (!match) throw new Error(`Invalid A1 address: ${a1}`);
  return {
    col: colLetterToIndex(match[1]),
    row: parseInt(match[2], 10) - 1,
  };
}

export function a1RangeToRange(rangeStr: string): CellRange {
  const [startStr, endStr] = rangeStr.split(':');
  return {
    start: a1ToAddress(startStr),
    end: a1ToAddress(endStr),
  };
}

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

export function getColumnLabel(col: number): string {
  return colIndexToLetter(col);
}

export function getRowLabel(row: number): string {
  return String(row + 1);
}

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
