// Zustand store for the spreadsheet feature.
// Every mutation auto-saves to device via scheduleAutoSave.

import { create } from 'zustand';
import {
  Sheet,
  Cell,
  CellAddress,
  CellRange,
  CellStyle,
  Selection,
  EditingState,
  HistoryEntry,
  DEFAULT_ROW_COUNT,
  DEFAULT_COL_COUNT,
} from '../types/spreadsheet';
import { addressToA1, a1ToAddress, getCellsInRange } from '../engine/addressUtils';
import { evaluateFormula, recalculateSheet } from '../engine/formulaEngine';
import { scheduleAutoSave, loadFromDevice, clearSavedData } from '../services/persistence';

interface SpreadsheetStore {
  sheets: Sheet[];
  activeSheetIndex: number;
  selection: Selection | null;
  editing: EditingState | null;
  clipboard: { cells: Map<string, Cell>; range: CellRange } | null;
  history: HistoryEntry[];
  historyIndex: number;
  fileName: string;
  isDirty: boolean;
  isLoading: boolean;
  lastSavedAt: string | null;

  activeSheet: () => Sheet;
  getCell: (address: CellAddress) => Cell | undefined;
  getCellDisplayValue: (address: CellAddress) => string;

  loadSavedState: () => Promise<boolean>;
  newSpreadsheet: () => Promise<void>;

  setSheets: (sheets: Sheet[], fileName?: string) => void;
  addSheet: (name?: string) => void;
  removeSheet: (index: number) => void;
  renameSheet: (index: number, name: string) => void;
  setActiveSheet: (index: number) => void;

  setCell: (address: CellAddress, cell: Partial<Cell>, skipHistory?: boolean) => void;
  setCells: (changes: Map<string, Partial<Cell>>) => void;
  clearCells: (addresses: CellAddress[]) => void;
  setCellStyle: (address: CellAddress, style: Partial<CellStyle>) => void;
  setRangeStyle: (range: CellRange, style: Partial<CellStyle>) => void;

  setSelection: (selection: Selection | null) => void;
  extendSelection: (to: CellAddress) => void;
  selectAll: () => void;

  startEditing: (address: CellAddress, initialValue?: string) => void;
  updateEditingValue: (value: string) => void;
  commitEdit: () => void;
  cancelEdit: () => void;

  copy: () => void;
  cut: () => void;
  paste: (target: CellAddress) => void;

  insertRow: (rowIndex: number) => void;
  deleteRow: (rowIndex: number) => void;
  insertCol: (colIndex: number) => void;
  deleteCol: (colIndex: number) => void;
  setRowHeight: (row: number, height: number) => void;
  setColWidth: (col: number, width: number) => void;

  undo: () => void;
  redo: () => void;

  setFileName: (name: string) => void;
  markClean: () => void;
}

function createEmptySheet(id: string, name: string): Sheet {
  return {
    id,
    name,
    cells: new Map(),
    rowCount: DEFAULT_ROW_COUNT,
    colCount: DEFAULT_COL_COUNT,
    rowHeights: new Map(),
    colWidths: new Map(),
  };
}

function updateSheetCell(sheet: Sheet, address: CellAddress, updates: Partial<Cell>): Sheet {
  const key = addressToA1(address).toUpperCase();
  const existing = sheet.cells.get(key) ?? { value: null };
  const newCell: Cell = { ...existing, ...updates };

  if (newCell.formula) {
    newCell.computed = evaluateFormula(newCell.formula, sheet);
    newCell.type = 'formula';
  } else if (
    newCell.value !== null &&
    newCell.value !== '' &&
    !isNaN(Number(newCell.value))
  ) {
    newCell.type = 'number';
    newCell.value = Number(newCell.value);
  } else {
    newCell.type = 'text';
  }

  const newCells = new Map(sheet.cells);
  newCells.set(key, newCell);
  return { ...sheet, cells: newCells };
}

function triggerAutoSave(get: () => SpreadsheetStore) {
  const { sheets, activeSheetIndex, fileName } = get();
  scheduleAutoSave({ sheets, activeSheetIndex, fileName });
}

export const useSpreadsheetStore = create<SpreadsheetStore>((set, get) => ({
  sheets: [createEmptySheet('sheet_0', 'Sheet1')],
  activeSheetIndex: 0,
  selection: null,
  editing: null,
  clipboard: null,
  history: [],
  historyIndex: -1,
  fileName: 'untitled.xlsx',
  isDirty: false,
  isLoading: false,
  lastSavedAt: null,

  activeSheet: () => get().sheets[get().activeSheetIndex],

  getCell: (address) => {
    const key = addressToA1(address).toUpperCase();
    return get().activeSheet().cells.get(key);
  },

  getCellDisplayValue: (address) => {
    const cell = get().getCell(address);
    if (!cell) return '';
    if (cell.formula) return String(cell.computed ?? '');
    return String(cell.value ?? '');
  },

  loadSavedState: async () => {
    set({ isLoading: true });
    const saved = await loadFromDevice();
    if (saved) {
      set({
        sheets: saved.sheets,
        activeSheetIndex: saved.activeSheetIndex,
        fileName: saved.fileName,
        isLoading: false,
        isDirty: false,
        history: [],
        historyIndex: -1,
      });
      return true;
    }
    set({ isLoading: false });
    return false;
  },

  newSpreadsheet: async () => {
    await clearSavedData();
    set({
      sheets: [createEmptySheet('sheet_0', 'Sheet1')],
      activeSheetIndex: 0,
      selection: null,
      editing: null,
      clipboard: null,
      history: [],
      historyIndex: -1,
      fileName: 'untitled.xlsx',
      isDirty: false,
    });
  },

  setSheets: (sheets, fileName) => {
    set({
      sheets,
      activeSheetIndex: 0,
      fileName: fileName ?? get().fileName,
      isDirty: false,
      history: [],
      historyIndex: -1,
    });
    triggerAutoSave(get);
  },

  addSheet: (name) => {
    const { sheets } = get();
    const newIndex = sheets.length;
    const newSheet = createEmptySheet(`sheet_${Date.now()}`, name ?? `Sheet${newIndex + 1}`);
    set({ sheets: [...sheets, newSheet], activeSheetIndex: newIndex, isDirty: true });
    triggerAutoSave(get);
  },

  removeSheet: (index) => {
    const { sheets, activeSheetIndex } = get();
    if (sheets.length === 1) return;
    const newSheets = sheets.filter((_, i) => i !== index);
    const newActive = Math.min(activeSheetIndex, newSheets.length - 1);
    set({ sheets: newSheets, activeSheetIndex: newActive, isDirty: true });
    triggerAutoSave(get);
  },

  renameSheet: (index, name) => {
    const { sheets } = get();
    const newSheets = sheets.map((s, i) => (i === index ? { ...s, name } : s));
    set({ sheets: newSheets, isDirty: true });
    triggerAutoSave(get);
  },

  setActiveSheet: (index) =>
    set({ activeSheetIndex: index, selection: null, editing: null }),

  setCell: (address, cellUpdates, skipHistory = false) => {
    const { sheets, activeSheetIndex, history, historyIndex } = get();
    const sheet = sheets[activeSheetIndex];
    const key = addressToA1(address).toUpperCase();

    if (!skipHistory) {
      const before = sheet.cells.get(key);
      const entry: HistoryEntry = {
        sheetId: sheet.id,
        changes: new Map([[key, { before, after: { ...before, ...cellUpdates } as Cell }]]),
      };
      const trimmedHistory = history.slice(0, historyIndex + 1);
      set({ history: [...trimmedHistory, entry], historyIndex: historyIndex + 1 });
    }

    const newSheet = updateSheetCell(sheet, address, cellUpdates);
    const recalculated = recalculateSheet(newSheet);
    const newSheets = sheets.map((s, i) => (i === activeSheetIndex ? recalculated : s));
    set({ sheets: newSheets, isDirty: true });
    triggerAutoSave(get);
  },

  setCells: (changes) => {
    const { sheets, activeSheetIndex } = get();
    let sheet = sheets[activeSheetIndex];
    changes.forEach((cellUpdates, key) => {
      try {
        const address = a1ToAddress(key);
        sheet = updateSheetCell(sheet, address, cellUpdates);
      } catch {}
    });
    const recalculated = recalculateSheet(sheet);
    const newSheets = sheets.map((s, i) => (i === activeSheetIndex ? recalculated : s));
    set({ sheets: newSheets, isDirty: true });
    triggerAutoSave(get);
  },

  clearCells: (addresses) => {
    const { sheets, activeSheetIndex } = get();
    const sheet = sheets[activeSheetIndex];
    const newCells = new Map(sheet.cells);
    addresses.forEach(addr => newCells.delete(addressToA1(addr).toUpperCase()));
    const newSheets = sheets.map((s, i) =>
      i === activeSheetIndex ? { ...s, cells: newCells } : s,
    );
    set({ sheets: newSheets, isDirty: true });
    triggerAutoSave(get);
  },

  setCellStyle: (address, style) => {
    const existing = get().getCell(address) ?? { value: null };
    get().setCell(address, { style: { ...existing.style, ...style } });
  },

  setRangeStyle: (range, style) => {
    const cells = getCellsInRange(range);
    const changes = new Map<string, Partial<Cell>>();
    cells.forEach(addr => {
      const existing = get().getCell(addr) ?? { value: null };
      changes.set(addressToA1(addr).toUpperCase(), { ...existing, style: { ...existing.style, ...style } });
    });
    get().setCells(changes);
  },

  setSelection: (selection) => {
    if (get().editing) get().commitEdit();
    set({ selection });
  },

  extendSelection: (to) => {
    const { selection } = get();
    if (!selection) return;
    set({ selection: { cell: selection.cell, range: { start: selection.cell, end: to } } });
  },

  selectAll: () => {
    const sheet = get().activeSheet();
    set({
      selection: {
        cell: { row: 0, col: 0 },
        range: { start: { row: 0, col: 0 }, end: { row: sheet.rowCount - 1, col: sheet.colCount - 1 } },
      },
    });
  },

  startEditing: (address, initialValue) => {
    const cell = get().getCell(address);
    const value = initialValue ?? (cell?.formula ?? String(cell?.value ?? ''));
    set({
      selection: { cell: address },
      editing: { address, value, isFormulaMode: value.startsWith('=') },
    });
  },

  updateEditingValue: (value) => {
    const { editing } = get();
    if (!editing) return;
    set({ editing: { ...editing, value, isFormulaMode: value.startsWith('=') } });
  },

  commitEdit: () => {
    const { editing } = get();
    if (!editing) return;
    const { address, value } = editing;
    const isFormula = value.startsWith('=');
    get().setCell(address, {
      formula: isFormula ? value : undefined,
      value: isFormula ? undefined : (isNaN(Number(value)) || value === '' ? value : Number(value)),
      computed: undefined,
    });
    set({ editing: null });
  },

  cancelEdit: () => set({ editing: null }),

  copy: () => {
    const { selection, activeSheet } = get();
    if (!selection) return;
    const range = selection.range ?? { start: selection.cell, end: selection.cell };
    const cells = getCellsInRange(range);
    const copiedCells = new Map<string, Cell>();
    cells.forEach(addr => {
      const key = addressToA1(addr).toUpperCase();
      const cell = activeSheet().cells.get(key);
      if (cell) copiedCells.set(key, { ...cell });
    });
    set({ clipboard: { cells: copiedCells, range } });
  },

  cut: () => {
    get().copy();
    const { selection } = get();
    if (!selection) return;
    const range = selection.range ?? { start: selection.cell, end: selection.cell };
    get().clearCells(getCellsInRange(range));
  },

  paste: (target) => {
    const { clipboard } = get();
    if (!clipboard) return;
    const sourceStart = clipboard.range.start;
    const changes = new Map<string, Partial<Cell>>();
    clipboard.cells.forEach((cell, key) => {
      try {
        const sourceAddr = a1ToAddress(key);
        const destAddr = {
          row: target.row + (sourceAddr.row - sourceStart.row),
          col: target.col + (sourceAddr.col - sourceStart.col),
        };
        changes.set(addressToA1(destAddr).toUpperCase(), { ...cell });
      } catch {}
    });
    get().setCells(changes);
  },

  insertRow: (rowIndex) => {
    const { sheets, activeSheetIndex } = get();
    const sheet = sheets[activeSheetIndex];
    const newCells = new Map<string, Cell>();
    sheet.cells.forEach((cell, key) => {
      try {
        const addr = a1ToAddress(key);
        const newKey = addr.row >= rowIndex
          ? addressToA1({ ...addr, row: addr.row + 1 }).toUpperCase()
          : key;
        newCells.set(newKey, cell);
      } catch { newCells.set(key, cell); }
    });
    const newSheet = { ...sheet, cells: newCells, rowCount: sheet.rowCount + 1 };
    const newSheets = sheets.map((s, i) => (i === activeSheetIndex ? newSheet : s));
    set({ sheets: newSheets, isDirty: true });
    triggerAutoSave(get);
  },

  deleteRow: (rowIndex) => {
    const { sheets, activeSheetIndex } = get();
    const sheet = sheets[activeSheetIndex];
    const newCells = new Map<string, Cell>();
    sheet.cells.forEach((cell, key) => {
      try {
        const addr = a1ToAddress(key);
        if (addr.row === rowIndex) return;
        const newKey = addr.row > rowIndex
          ? addressToA1({ ...addr, row: addr.row - 1 }).toUpperCase()
          : key;
        newCells.set(newKey, cell);
      } catch { newCells.set(key, cell); }
    });
    const newSheet = { ...sheet, cells: newCells, rowCount: Math.max(1, sheet.rowCount - 1) };
    const newSheets = sheets.map((s, i) => (i === activeSheetIndex ? newSheet : s));
    set({ sheets: newSheets, isDirty: true });
    triggerAutoSave(get);
  },

  insertCol: (colIndex) => {
    const { sheets, activeSheetIndex } = get();
    const sheet = sheets[activeSheetIndex];
    const newCells = new Map<string, Cell>();
    sheet.cells.forEach((cell, key) => {
      try {
        const addr = a1ToAddress(key);
        const newKey = addr.col >= colIndex
          ? addressToA1({ ...addr, col: addr.col + 1 }).toUpperCase()
          : key;
        newCells.set(newKey, cell);
      } catch { newCells.set(key, cell); }
    });
    const newSheet = { ...sheet, cells: newCells, colCount: sheet.colCount + 1 };
    const newSheets = sheets.map((s, i) => (i === activeSheetIndex ? newSheet : s));
    set({ sheets: newSheets, isDirty: true });
    triggerAutoSave(get);
  },

  deleteCol: (colIndex) => {
    const { sheets, activeSheetIndex } = get();
    const sheet = sheets[activeSheetIndex];
    const newCells = new Map<string, Cell>();
    sheet.cells.forEach((cell, key) => {
      try {
        const addr = a1ToAddress(key);
        if (addr.col === colIndex) return;
        const newKey = addr.col > colIndex
          ? addressToA1({ ...addr, col: addr.col - 1 }).toUpperCase()
          : key;
        newCells.set(newKey, cell);
      } catch { newCells.set(key, cell); }
    });
    const newSheet = { ...sheet, cells: newCells, colCount: Math.max(1, sheet.colCount - 1) };
    const newSheets = sheets.map((s, i) => (i === activeSheetIndex ? newSheet : s));
    set({ sheets: newSheets, isDirty: true });
    triggerAutoSave(get);
  },

  setRowHeight: (row, height) => {
    const { sheets, activeSheetIndex } = get();
    const sheet = sheets[activeSheetIndex];
    const newHeights = new Map(sheet.rowHeights);
    newHeights.set(row, height);
    const newSheets = sheets.map((s, i) =>
      i === activeSheetIndex ? { ...s, rowHeights: newHeights } : s,
    );
    set({ sheets: newSheets });
    triggerAutoSave(get);
  },

  setColWidth: (col, width) => {
    const { sheets, activeSheetIndex } = get();
    const sheet = sheets[activeSheetIndex];
    const newWidths = new Map(sheet.colWidths);
    newWidths.set(col, width);
    const newSheets = sheets.map((s, i) =>
      i === activeSheetIndex ? { ...s, colWidths: newWidths } : s,
    );
    set({ sheets: newSheets });
    triggerAutoSave(get);
  },

  undo: () => {
    const { history, historyIndex, sheets } = get();
    if (historyIndex < 0) return;
    const entry = history[historyIndex];
    const sheet = sheets.find(s => s.id === entry.sheetId);
    if (!sheet) return;
    const newCells = new Map(sheet.cells);
    entry.changes.forEach(({ before }, key) => {
      if (before === undefined) newCells.delete(key);
      else newCells.set(key, before);
    });
    const newSheets = sheets.map(s =>
      s.id === entry.sheetId ? recalculateSheet({ ...s, cells: newCells }) : s,
    );
    set({ sheets: newSheets, historyIndex: historyIndex - 1 });
    triggerAutoSave(get);
  },

  redo: () => {
    const { history, historyIndex, sheets } = get();
    if (historyIndex >= history.length - 1) return;
    const entry = history[historyIndex + 1];
    const sheet = sheets.find(s => s.id === entry.sheetId);
    if (!sheet) return;
    const newCells = new Map(sheet.cells);
    entry.changes.forEach(({ after }, key) => {
      if (after === undefined) newCells.delete(key);
      else newCells.set(key, after);
    });
    const newSheets = sheets.map(s =>
      s.id === entry.sheetId ? recalculateSheet({ ...s, cells: newCells }) : s,
    );
    set({ sheets: newSheets, historyIndex: historyIndex + 1 });
    triggerAutoSave(get);
  },

  setFileName: (name) => set({ fileName: name }),
  markClean: () => set({ isDirty: false, lastSavedAt: new Date().toISOString() }),
}));
