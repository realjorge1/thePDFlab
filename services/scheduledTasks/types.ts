// ─────────────────────────────────────────────────────────────────────────────
// Scheduled Tasks — Type Definitions
// ─────────────────────────────────────────────────────────────────────────────

export type ScheduledTaskType = 'quiz' | 'workspace_ai' | 'generate_document';
export type ScheduledTaskStatus = 'pending' | 'running' | 'completed' | 'failed';
export type RecurringInterval = 'daily' | 'weekly' | 'biweekly' | 'monthly';

// ── Payloads ──────────────────────────────────────────────────────────────────

export interface QuizTaskPayload {
  documentUri: string;
  documentName: string;
  documentMimeType: string;
  questionType: 'mcq' | 'true_false' | 'short' | 'mixed';
  length: 'quick' | 'standard' | 'deep';
  difficulty: 'easy' | 'medium' | 'hard' | 'adaptive';
  extractedText: string; // stored at schedule-time so URI expiry doesn't matter
}

export interface WorkspaceAITaskPayload {
  prompt: string;
  contextSnapshot: string; // block context captured at schedule time
}

export interface GenerateDocumentTaskPayload {
  prompt: string;
  title: string;
  fileType: 'docx' | 'pdf' | 'ppt';
  category: string;
  tone: string;
  wordCount: number;
  audience: string;
}

// ── Results ───────────────────────────────────────────────────────────────────

export interface QuizTaskResult {
  questionsJson: string;   // raw JSON array of QuizQuestion[]
  questionCount: number;
  difficulty: string;
  documentName: string;
}

export interface WorkspaceAITaskResult {
  response: string;
  prompt: string;
}

export interface GenerateDocumentTaskResult {
  content: string;
  title: string;
  fileType: string;
  category: string;
  wordCount: number;
}

// ── Discriminated unions ───────────────────────────────────────────────────────

export type ScheduledTaskPayload =
  | { type: 'quiz'; data: QuizTaskPayload }
  | { type: 'workspace_ai'; data: WorkspaceAITaskPayload }
  | { type: 'generate_document'; data: GenerateDocumentTaskPayload };

export type ScheduledTaskResult =
  | { type: 'quiz'; data: QuizTaskResult }
  | { type: 'workspace_ai'; data: WorkspaceAITaskResult }
  | { type: 'generate_document'; data: GenerateDocumentTaskResult };

// ── Main Task ─────────────────────────────────────────────────────────────────

export interface RecurringConfig {
  interval: RecurringInterval;
  runCount: number; // how many times this recurring task has fired
}

export interface ScheduledTask {
  id: string;
  type: ScheduledTaskType;
  title: string;
  description?: string;
  createdAt: number;     // unix ms
  scheduledFor: number;  // unix ms — when to execute
  recurring?: RecurringConfig;
  status: ScheduledTaskStatus;
  payload: ScheduledTaskPayload;
  result?: ScheduledTaskResult;
  error?: string;
  completedAt?: number;
  returnMessage?: string; // the human-like message, generated at completion time
  seen: boolean;          // has the user dismissed the return card?
}
