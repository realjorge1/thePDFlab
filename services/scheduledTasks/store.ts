// ─────────────────────────────────────────────────────────────────────────────
// Scheduled Tasks — AsyncStorage persistence
// ─────────────────────────────────────────────────────────────────────────────

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ScheduledTask, ScheduledTaskStatus } from './types';

const STORAGE_KEY = '@inscribed/scheduled_tasks_v1';
const MAX_COMPLETED = 50; // keep last 50 completed tasks for history

// ── Read / Write ──────────────────────────────────────────────────────────────

export async function loadAllTasks(): Promise<ScheduledTask[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveAllTasks(tasks: ScheduledTask[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export async function addTask(task: ScheduledTask): Promise<void> {
  const tasks = await loadAllTasks();
  tasks.unshift(task);
  await saveAllTasks(tasks);
}

export async function updateTask(
  id: string,
  patch: Partial<ScheduledTask>,
): Promise<ScheduledTask | null> {
  const tasks = await loadAllTasks();
  const idx = tasks.findIndex(t => t.id === id);
  if (idx < 0) return null;
  const updated = { ...tasks[idx], ...patch };
  tasks[idx] = updated;
  await saveAllTasks(tasks);
  return updated;
}

export async function deleteTask(id: string): Promise<void> {
  const tasks = await loadAllTasks();
  await saveAllTasks(tasks.filter(t => t.id !== id));
}

export async function markTaskSeen(id: string): Promise<void> {
  await updateTask(id, { seen: true });
}

// ── Queries ───────────────────────────────────────────────────────────────────

export async function getPendingTasks(): Promise<ScheduledTask[]> {
  const tasks = await loadAllTasks();
  return tasks.filter(t => t.status === 'pending');
}

export async function getDueTasks(now: number = Date.now()): Promise<ScheduledTask[]> {
  const tasks = await loadAllTasks();
  return tasks.filter(t => t.status === 'pending' && t.scheduledFor <= now);
}

export async function getUnseenCompletedTasks(): Promise<ScheduledTask[]> {
  const tasks = await loadAllTasks();
  return tasks.filter(t => t.status === 'completed' && !t.seen);
}

export async function getCompletedTasks(): Promise<ScheduledTask[]> {
  const tasks = await loadAllTasks();
  return tasks.filter(t => t.status === 'completed').sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
}

// Prune old completed tasks so storage doesn't balloon
export async function pruneOldTasks(): Promise<void> {
  const tasks = await loadAllTasks();
  const completed = tasks.filter(t => t.status === 'completed').sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
  const pending = tasks.filter(t => t.status !== 'completed');
  const trimmed = [...pending, ...completed.slice(0, MAX_COMPLETED)];
  await saveAllTasks(trimmed);
}

// ── ID helpers ────────────────────────────────────────────────────────────────

export function newTaskId(): string {
  return `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── Interval calculation ──────────────────────────────────────────────────────

export function nextRecurringTime(interval: string, from: number): number {
  const ms: Record<string, number> = {
    daily: 24 * 60 * 60 * 1000,
    weekly: 7 * 24 * 60 * 60 * 1000,
    biweekly: 14 * 24 * 60 * 60 * 1000,
    monthly: 30 * 24 * 60 * 60 * 1000,
  };
  return from + (ms[interval] ?? ms.weekly);
}
