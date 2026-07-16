/**
 * Small formatting/parsing helpers shared by the QC calculator screens.
 * Pure functions only — safe to unit test without rendering.
 */
import { tryEval } from "@/components/qc/qcMath";

/** Format a number for display: fixed decimals, "—" for NaN/undefined. */
export function fmt(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (!Number.isFinite(value)) return "—";
  return value.toFixed(decimals);
}

/**
 * Parse a decimal-number string from a text field. Accepts an optional
 * leading minus and both "." and "," as the decimal separator.
 * Returns null when the text is not a single valid number.
 */
export function parseDecimal(text: string): number | null {
  const cleaned = text.trim().replace(",", ".");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
  if (/^-?\d*\.?\d+$/.test(cleaned)) {
    const value = Number(cleaned);
    return Number.isFinite(value) ? value : null;
  }
  // Not a bare number — it may be a number-pad expression (√2, 10/1.5, 2π…).
  // Fall back to the safe arithmetic evaluator; unparseable text stays null.
  return tryEval(text.trim());
}

/**
 * Parse a free-form list of numbers (comma / semicolon / whitespace /
 * newline separated). Returns the parsed values plus any tokens that
 * could not be read, so the UI can point at exactly what's wrong.
 */
export function parseNumberList(text: string): {
  values: number[];
  invalid: string[];
} {
  const tokens = text
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  const values: number[] = [];
  const invalid: string[] = [];
  for (const token of tokens) {
    const value = parseDecimal(token);
    if (value === null) {
      invalid.push(token);
    } else {
      values.push(value);
    }
  }
  return { values, invalid };
}
