// ─────────────────────────────────────────────────────────────────────────────
// Scheduled Tasks — Executor
// Runs a due task: calls the AI, stores result, builds return message,
// and spawns the next recurring instance if applicable.
// ─────────────────────────────────────────────────────────────────────────────

import { generateDocument, generateQuiz, sendChat } from '@/services/ai/ai.service';
import type { ScheduledTask } from './types';
import {
  buildGenerateDocumentMessage,
  buildQuizReadyMessage,
  buildWorkspaceAIMessage,
} from './messages';
import {
  addTask,
  newTaskId,
  nextRecurringTime,
  updateTask,
} from './store';

// ── Quiz ──────────────────────────────────────────────────────────────────────

async function executeQuizTask(task: ScheduledTask): Promise<ScheduledTask> {
  if (task.payload.type !== 'quiz') throw new Error('Wrong payload type');
  const { extractedText, questionType, length, difficulty, documentName } = task.payload.data;

  const response = await generateQuiz(
    extractedText,
    questionType,
    length,
    difficulty,
    documentName,
  );

  let questions: unknown[] = [];
  let questionsJson = '[]';
  try {
    const jsonMatch = response.content.match(/```json\s*([\s\S]*?)\s*```/) ||
      response.content.match(/(\[[\s\S]*\])/);
    const rawJson = jsonMatch ? jsonMatch[1] : response.content;
    questions = JSON.parse(rawJson);
    questionsJson = JSON.stringify(questions);
  } catch {
    questionsJson = '[]';
  }

  const questionCount = questions.length;
  const returnMessage = buildQuizReadyMessage(task, questionCount);

  const updated = await updateTask(task.id, {
    status: 'completed',
    completedAt: Date.now(),
    returnMessage,
    seen: false,
    result: {
      type: 'quiz',
      data: { questionsJson, questionCount, difficulty, documentName },
    },
  });

  return updated ?? task;
}

// ── Workspace AI ──────────────────────────────────────────────────────────────

async function executeWorkspaceAITask(task: ScheduledTask): Promise<ScheduledTask> {
  if (task.payload.type !== 'workspace_ai') throw new Error('Wrong payload type');
  const { prompt, contextSnapshot } = task.payload.data;

  const fullPrompt = contextSnapshot
    ? `Workspace context:\n${contextSnapshot}\n\n---\nMy question: ${prompt}`
    : prompt;

  const response = await sendChat(fullPrompt, []);
  const returnMessage = buildWorkspaceAIMessage(task);

  const updated = await updateTask(task.id, {
    status: 'completed',
    completedAt: Date.now(),
    returnMessage,
    seen: false,
    result: {
      type: 'workspace_ai',
      data: { response: response.content, prompt },
    },
  });

  return updated ?? task;
}

// ── Generate Document ─────────────────────────────────────────────────────────

async function executeGenerateDocumentTask(task: ScheduledTask): Promise<ScheduledTask> {
  if (task.payload.type !== 'generate_document') throw new Error('Wrong payload type');
  const { prompt, fileType, category, tone, wordCount, audience, title } = task.payload.data;

  const response = await generateDocument(prompt, fileType, category, tone, wordCount, audience);
  const actualWordCount = response.content.split(/\s+/).filter(Boolean).length;
  const returnMessage = buildGenerateDocumentMessage(task, actualWordCount);

  const updated = await updateTask(task.id, {
    status: 'completed',
    completedAt: Date.now(),
    returnMessage,
    seen: false,
    result: {
      type: 'generate_document',
      data: { content: response.content, title, fileType, category, wordCount: actualWordCount },
    },
  });

  // Spawn next recurring instance
  if (task.recurring) {
    const nextRun = nextRecurringTime(task.recurring.interval, Date.now());
    const nextTask: ScheduledTask = {
      ...task,
      id: newTaskId(),
      status: 'pending',
      createdAt: Date.now(),
      scheduledFor: nextRun,
      seen: false,
      result: undefined,
      error: undefined,
      completedAt: undefined,
      returnMessage: undefined,
      recurring: {
        interval: task.recurring.interval,
        runCount: (task.recurring.runCount ?? 1) + 1,
      },
    };
    await addTask(nextTask);
  }

  return updated ?? task;
}

// ── Main executor ─────────────────────────────────────────────────────────────

export async function executeTask(task: ScheduledTask): Promise<ScheduledTask> {
  // Mark as running first
  await updateTask(task.id, { status: 'running' });

  try {
    switch (task.type) {
      case 'quiz':
        return await executeQuizTask(task);
      case 'workspace_ai':
        return await executeWorkspaceAITask(task);
      case 'generate_document':
        return await executeGenerateDocumentTask(task);
      default:
        throw new Error(`Unknown task type: ${(task as ScheduledTask).type}`);
    }
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : 'Unknown error';
    const failed = await updateTask(task.id, { status: 'failed', error, seen: false });
    return failed ?? task;
  }
}

// Run all due tasks sequentially (avoid parallel AI calls hammering rate limits)
export async function executeDueTasks(
  dueTasks: ScheduledTask[],
  onTaskComplete?: (task: ScheduledTask) => void,
): Promise<ScheduledTask[]> {
  const results: ScheduledTask[] = [];
  for (const task of dueTasks) {
    const result = await executeTask(task);
    results.push(result);
    onTaskComplete?.(result);
  }
  return results;
}
