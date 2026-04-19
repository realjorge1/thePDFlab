// Offline-safe formula engine.
// - Custom tokenizer + Pratt parser for arithmetic (no eval / no Function constructor)
// - Built-in spreadsheet functions evaluated locally

import { Sheet } from '../types/spreadsheet';
import {
  a1RangeToRange,
  getCellsInRange,
  addressToA1,
} from './addressUtils';

function getCellValue(sheet: Sheet, a1: string): number | string | boolean | null {
  const cell = sheet.cells.get(a1.toUpperCase());
  if (!cell) return null;
  const v = cell.formula ? (cell.computed ?? cell.value) : cell.value;
  return v ?? null;
}

function getNumericValues(sheet: Sheet, rangeStr: string): number[] {
  try {
    const range = a1RangeToRange(rangeStr);
    return getCellsInRange(range)
      .map(addr => {
        const v = getCellValue(sheet, addressToA1(addr));
        const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
        return n;
      })
      .filter(n => !isNaN(n));
  } catch {
    return [];
  }
}

function resolveArg(arg: string, sheet: Sheet): number | string {
  const t = arg.trim();
  if (t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1);
  const num = parseFloat(t);
  if (!isNaN(num) && t !== '') return num;
  if (/^[A-Z]+\d+$/i.test(t)) {
    const v = getCellValue(sheet, t.toUpperCase());
    if (v === null) return 0;
    if (typeof v === 'boolean') return v ? 1 : 0;
    return v;
  }
  return evaluateExpression(t, sheet);
}

function tokenize(expr: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (' \t'.includes(ch)) { i++; continue; }
    if ('+-*/%()'.includes(ch)) { tokens.push(ch); i++; continue; }
    if ((ch >= '0' && ch <= '9') || ch === '.') {
      let num = '';
      while (i < expr.length && ((expr[i] >= '0' && expr[i] <= '9') || expr[i] === '.')) {
        num += expr[i++];
      }
      tokens.push(num);
      continue;
    }
    i++;
  }
  return tokens;
}

class Parser {
  private tokens: string[];
  private pos = 0;
  constructor(tokens: string[]) { this.tokens = tokens; }
  private peek(): string | undefined { return this.tokens[this.pos]; }
  private consume(): string { return this.tokens[this.pos++]; }

  parse(): number { return this.expr(); }

  private expr(): number {
    let left = this.term();
    while (this.peek() === '+' || this.peek() === '-') {
      const op = this.consume();
      const right = this.term();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  private term(): number {
    let left = this.factor();
    while (this.peek() === '*' || this.peek() === '/' || this.peek() === '%') {
      const op = this.consume();
      const right = this.factor();
      if (op === '*') left *= right;
      else if (op === '/') left = right !== 0 ? left / right : 0;
      else left %= right;
    }
    return left;
  }

  private factor(): number {
    const tok = this.peek();
    if (tok === '-') { this.consume(); return -this.factor(); }
    if (tok === '+') { this.consume(); return this.factor(); }
    if (tok === '(') {
      this.consume();
      const val = this.expr();
      if (this.peek() === ')') this.consume();
      return val;
    }
    const num = parseFloat(this.consume() ?? '0');
    return isNaN(num) ? 0 : num;
  }
}

function safeArithmetic(expr: string): number | '#ERROR' {
  try {
    const tokens = tokenize(expr);
    if (tokens.length === 0) return 0;
    const parser = new Parser(tokens);
    const result = parser.parse();
    return isFinite(result) ? result : ('#ERROR' as const);
  } catch {
    return '#ERROR' as const;
  }
}

type FormulaFn = (args: string[], sheet: Sheet) => number | string;

const FUNCTIONS: Record<string, FormulaFn> = {
  SUM: (args, sheet) => {
    let total = 0;
    for (const arg of args) {
      const t = arg.trim();
      if (t.includes(':')) {
        total += getNumericValues(sheet, t).reduce((a, b) => a + b, 0);
      } else {
        const v = resolveArg(t, sheet);
        total += typeof v === 'number' ? v : (parseFloat(String(v)) || 0);
      }
    }
    return total;
  },

  AVERAGE: (args, sheet) => {
    const nums = args.flatMap(a =>
      a.trim().includes(':')
        ? getNumericValues(sheet, a.trim())
        : (() => { const v = parseFloat(String(resolveArg(a.trim(), sheet))); return isNaN(v) ? [] : [v]; })()
    );
    return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
  },

  AVG: (args, sheet) => FUNCTIONS.AVERAGE(args, sheet),

  MIN: (args, sheet) => {
    const nums = args.flatMap(a =>
      a.trim().includes(':')
        ? getNumericValues(sheet, a.trim())
        : (() => { const v = parseFloat(String(resolveArg(a.trim(), sheet))); return isNaN(v) ? [] : [v]; })()
    );
    return nums.length ? Math.min(...nums) : 0;
  },

  MAX: (args, sheet) => {
    const nums = args.flatMap(a =>
      a.trim().includes(':')
        ? getNumericValues(sheet, a.trim())
        : (() => { const v = parseFloat(String(resolveArg(a.trim(), sheet))); return isNaN(v) ? [] : [v]; })()
    );
    return nums.length ? Math.max(...nums) : 0;
  },

  COUNT: (args, sheet) => {
    let count = 0;
    for (const arg of args) {
      const t = arg.trim();
      if (t.includes(':')) {
        count += getNumericValues(sheet, t).length;
      } else {
        const v = resolveArg(t, sheet);
        if (typeof v === 'number' || !isNaN(parseFloat(String(v)))) count++;
      }
    }
    return count;
  },

  COUNTA: (args, sheet) => {
    let count = 0;
    for (const arg of args) {
      const t = arg.trim();
      if (t.includes(':')) {
        const range = a1RangeToRange(t);
        getCellsInRange(range).forEach(addr => {
          const v = getCellValue(sheet, addressToA1(addr));
          if (v !== null && v !== '') count++;
        });
      } else {
        const v = getCellValue(sheet, t);
        if (v !== null && v !== '') count++;
      }
    }
    return count;
  },

  ROUND: (args, sheet) => {
    const num = parseFloat(String(resolveArg(args[0]?.trim() ?? '0', sheet))) || 0;
    const digits = args[1] !== undefined ? parseInt(args[1].trim(), 10) : 0;
    const factor = Math.pow(10, digits);
    return Math.round(num * factor) / factor;
  },

  ABS: (args, sheet) => Math.abs(parseFloat(String(resolveArg(args[0]?.trim() ?? '0', sheet))) || 0),

  SQRT: (args, sheet) => {
    const v = parseFloat(String(resolveArg(args[0]?.trim() ?? '0', sheet))) || 0;
    return v >= 0 ? Math.sqrt(v) : '#NUM!';
  },

  POWER: (args, sheet) => {
    const base = parseFloat(String(resolveArg(args[0]?.trim() ?? '0', sheet))) || 0;
    const exp = parseFloat(String(resolveArg(args[1]?.trim() ?? '0', sheet))) || 0;
    return Math.pow(base, exp);
  },

  MOD: (args, sheet) => {
    const a = parseFloat(String(resolveArg(args[0]?.trim() ?? '0', sheet))) || 0;
    const b = parseFloat(String(resolveArg(args[1]?.trim() ?? '1', sheet))) || 1;
    return a % b;
  },

  IF: (args, sheet) => {
    const condition = evaluateExpression(args[0]?.trim() ?? '', sheet);
    const isTrue = condition !== 0 && condition !== '' && condition !== '0';
    const branch = isTrue ? (args[1] ?? '') : (args[2] ?? '');
    return evaluateExpression(branch.trim(), sheet);
  },

  AND: (args, sheet) => {
    return args.every(a => {
      const v = evaluateExpression(a.trim(), sheet);
      return v !== 0 && v !== '';
    }) ? 1 : 0;
  },

  OR: (args, sheet) => {
    return args.some(a => {
      const v = evaluateExpression(a.trim(), sheet);
      return v !== 0 && v !== '';
    }) ? 1 : 0;
  },

  NOT: (args, sheet) => {
    const v = evaluateExpression(args[0]?.trim() ?? '', sheet);
    return (v === 0 || v === '' || v === '0') ? 1 : 0;
  },

  CONCATENATE: (args, sheet) =>
    args.map(a => {
      const t = a.trim();
      if (t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1);
      return String(resolveArg(t, sheet));
    }).join(''),

  CONCAT: (args, sheet) => FUNCTIONS.CONCATENATE(args, sheet),

  LEN: (args, sheet) => String(resolveArg(args[0]?.trim() ?? '', sheet)).length,
  UPPER: (args, sheet) => String(resolveArg(args[0]?.trim() ?? '', sheet)).toUpperCase(),
  LOWER: (args, sheet) => String(resolveArg(args[0]?.trim() ?? '', sheet)).toLowerCase(),
  TRIM: (args, sheet) => String(resolveArg(args[0]?.trim() ?? '', sheet)).trim(),

  LEFT: (args, sheet) => {
    const str = String(resolveArg(args[0]?.trim() ?? '', sheet));
    const n = parseInt(args[1]?.trim() ?? '1', 10);
    return str.slice(0, n);
  },

  RIGHT: (args, sheet) => {
    const str = String(resolveArg(args[0]?.trim() ?? '', sheet));
    const n = parseInt(args[1]?.trim() ?? '1', 10);
    return str.slice(-n);
  },

  MID: (args, sheet) => {
    const str = String(resolveArg(args[0]?.trim() ?? '', sheet));
    const start = parseInt(args[1]?.trim() ?? '1', 10) - 1;
    const len = parseInt(args[2]?.trim() ?? '1', 10);
    return str.substr(start, len);
  },

  NOW: () => new Date().toLocaleString(),
  TODAY: () => new Date().toLocaleDateString(),
  TRUE: () => 1,
  FALSE: () => 0,
};

function substituteCellRefs(expr: string, sheet: Sheet): string {
  return expr.replace(/\b([A-Z]+\d+)\b/gi, (match) => {
    const v = getCellValue(sheet, match.toUpperCase());
    if (v === null || v === '') return '0';
    if (typeof v === 'number') return String(v);
    const n = parseFloat(String(v));
    return isNaN(n) ? '0' : String(n);
  });
}

function evaluateExpression(expr: string, sheet: Sheet): string | number {
  const t = expr.trim();
  if (!t) return '';

  if (t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1);
  if (t.toUpperCase() === 'TRUE') return 1;
  if (t.toUpperCase() === 'FALSE') return 0;

  const direct = parseFloat(t);
  if (!isNaN(direct) && String(direct) === t.replace(/^0+(\d)/, '$1')) return direct;

  if (/^[A-Z]+\d+$/i.test(t)) {
    const v = getCellValue(sheet, t.toUpperCase());
    if (v === null) return 0;
    if (typeof v === 'boolean') return v ? 1 : 0;
    return v;
  }

  const withValues = substituteCellRefs(t, sheet);
  const compMatch = withValues.match(/^(.+?)(>=|<=|<>|!=|>|<|={1,2})(.+)$/);
  if (compMatch) {
    const left = safeArithmetic(compMatch[1]);
    const right = safeArithmetic(compMatch[3]);
    const op = compMatch[2];
    if (typeof left === 'number' && typeof right === 'number') {
      switch (op) {
        case '=': case '==': return left === right ? 1 : 0;
        case '<>': case '!=': return left !== right ? 1 : 0;
        case '>': return left > right ? 1 : 0;
        case '<': return left < right ? 1 : 0;
        case '>=': return left >= right ? 1 : 0;
        case '<=': return left <= right ? 1 : 0;
      }
    }
  }

  const result = safeArithmetic(withValues);
  return result === '#ERROR' ? '#ERROR' : result;
}

function splitArgs(argsStr: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let inString = false;
  let current = '';
  for (const ch of argsStr) {
    if (ch === '"') inString = !inString;
    if (!inString) {
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      else if (ch === ',' && depth === 0) {
        args.push(current.trim());
        current = '';
        continue;
      }
    }
    current += ch;
  }
  if (current.trim()) args.push(current.trim());
  return args;
}

export function evaluateFormula(formula: string, sheet: Sheet): string | number {
  if (!formula || !formula.startsWith('=')) return formula ?? '';

  const expr = formula.slice(1).trim().toUpperCase();

  const funcMatch = expr.match(/^([A-Z]+)\((.*)\)\s*$/s);
  if (funcMatch) {
    const funcName = funcMatch[1];
    const rawArgs = funcMatch[2];
    const fn = FUNCTIONS[funcName];
    if (fn) {
      try {
        return fn(splitArgs(rawArgs), sheet);
      } catch {
        return '#ERROR';
      }
    }
    return '#NAME?';
  }

  try {
    return evaluateExpression(expr, sheet);
  } catch {
    return '#ERROR';
  }
}

export function recalculateSheet(sheet: Sheet): Sheet {
  const newCells = new Map(sheet.cells);
  for (const [key, cell] of newCells.entries()) {
    if (cell.formula) {
      const computed = evaluateFormula(cell.formula, { ...sheet, cells: newCells });
      newCells.set(key, { ...cell, computed });
    }
  }
  return { ...sheet, cells: newCells };
}
