/**
 * QC Calculator History Service
 *
 * Persists saved calculator runs (inputs + results + timestamp + optional
 * label) in AsyncStorage so users can reopen past calculations offline.
 * Record shape is sync-friendly on purpose: stable UUIDs, ISO timestamps,
 * no device-specific fields.
 */

import type { QcToolId } from "@/constants/qcTools";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { v4 as uuid } from "uuid";

const RUNS_KEY = "@wordsinscribed_qc_calc_runs";

/** Keep the newest runs only, so storage stays bounded. */
const MAX_RUNS = 200;

export interface SavedQcRun {
  id: string;
  tool: QcToolId;
  /** Optional analyte/instrument label entered by the user. */
  label: string;
  /** ISO-8601 creation timestamp. */
  createdAt: string;
  /** The tool's raw input state (strings as typed), for exact restore. */
  inputs: Record<string, string>;
  /** One-line human summary shown in the saved-runs list. */
  summary: string;
}

async function readRuns(): Promise<SavedQcRun[]> {
  try {
    const raw = await AsyncStorage.getItem(RUNS_KEY);
    return raw ? (JSON.parse(raw) as SavedQcRun[]) : [];
  } catch {
    return [];
  }
}

async function writeRuns(runs: SavedQcRun[]): Promise<void> {
  await AsyncStorage.setItem(RUNS_KEY, JSON.stringify(runs.slice(0, MAX_RUNS)));
}

/** List saved runs for one tool (newest first). */
export async function getSavedRuns(tool: QcToolId): Promise<SavedQcRun[]> {
  const runs = await readRuns();
  return runs.filter((r) => r.tool === tool);
}

/** Save a new run. Returns the stored record. */
export async function saveRun(input: {
  tool: QcToolId;
  label: string;
  inputs: Record<string, string>;
  summary: string;
}): Promise<SavedQcRun> {
  const run: SavedQcRun = {
    id: uuid(),
    tool: input.tool,
    label: input.label.trim(),
    createdAt: new Date().toISOString(),
    inputs: input.inputs,
    summary: input.summary,
  };
  const runs = await readRuns();
  await writeRuns([run, ...runs]);
  return run;
}

/** Delete a saved run by id (no-op when missing). */
export async function deleteRun(id: string): Promise<void> {
  const runs = await readRuns();
  await writeRuns(runs.filter((r) => r.id !== id));
}
