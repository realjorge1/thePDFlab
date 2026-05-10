// ─────────────────────────────────────────────────────────────────────────────
// useScheduledTasks
// Checks for due tasks on mount / app foreground, executes them,
// and exposes unseen completed tasks so the UI can show return cards.
// ─────────────────────────────────────────────────────────────────────────────

import { AppState, AppStateStatus } from 'react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  executeDueTasks,
  getDueTasks,
  getUnseenCompletedTasks,
  loadAllTasks,
  markTaskSeen,
  pruneOldTasks,
} from '@/services/scheduledTasks';
import type { ScheduledTask } from '@/services/scheduledTasks';

interface UseScheduledTasksReturn {
  unseenTasks: ScheduledTask[];
  isExecuting: boolean;
  dismissTask: (id: string) => void;
  refresh: () => Promise<void>;
}

export function useScheduledTasks(): UseScheduledTasksReturn {
  const [unseenTasks, setUnseenTasks] = useState<ScheduledTask[]>([]);
  const [isExecuting, setIsExecuting] = useState(false);
  const isRunningRef = useRef(false);

  const runDueTasks = useCallback(async () => {
    if (isRunningRef.current) return;
    isRunningRef.current = true;
    setIsExecuting(true);

    try {
      const due = await getDueTasks();
      if (due.length > 0) {
        await executeDueTasks(due);
        await pruneOldTasks();
      }
      const unseen = await getUnseenCompletedTasks();
      // Surface cards unpredictably — 35% of opens show nothing,
      // otherwise show 1-2 tasks in random order so it never feels scripted.
      if (unseen.length > 0 && Math.random() > 0.35) {
        const shuffled = [...unseen].sort(() => Math.random() - 0.5);
        setUnseenTasks(shuffled.slice(0, 2));
      } else {
        setUnseenTasks([]);
      }
    } catch (e) {
      console.warn('[ScheduledTasks] execution error:', e);
    } finally {
      isRunningRef.current = false;
      setIsExecuting(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    await runDueTasks();
  }, [runDueTasks]);

  // Run on mount
  useEffect(() => {
    runDueTasks();
  }, [runDueTasks]);

  // Re-run when app comes to foreground
  useEffect(() => {
    let prev: AppStateStatus = AppState.currentState;
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (prev.match(/inactive|background/) && next === 'active') {
        runDueTasks();
      }
      prev = next;
    });
    return () => sub.remove();
  }, [runDueTasks]);

  const dismissTask = useCallback((id: string) => {
    markTaskSeen(id).catch(console.warn);
    setUnseenTasks(prev => prev.filter(t => t.id !== id));
  }, []);

  return { unseenTasks, isExecuting, dismissTask, refresh };
}
