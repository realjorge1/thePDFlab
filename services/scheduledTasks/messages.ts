// ─────────────────────────────────────────────────────────────────────────────
// Scheduled Tasks — Human-like Return Messages
// Lots of variety so users never see the same message twice.
// ─────────────────────────────────────────────────────────────────────────────

import type { ScheduledTask } from './types';

// ── Time description ──────────────────────────────────────────────────────────

export function formatTimeAgo(fromMs: number, toMs: number = Date.now()): string {
  const diff = toMs - fromMs;
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);

  if (hours < 1) return 'just a moment ago';
  if (hours < 2) return 'about an hour ago';
  if (hours < 24) return `${hours} hours ago`;
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days === 7) return 'a week ago';
  if (weeks < 4) return `${weeks} week${weeks > 1 ? 's' : ''} ago`;
  if (months === 1) return 'about a month ago';
  return `${months} months ago`;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── Quiz messages ─────────────────────────────────────────────────────────────

interface QuizMessageContext {
  timeAgo: string;
  docName: string;
  score: number;
  total: number;
  percentage: number;
  rank: string;
  difficulty: string;
  weakTopics: string;
}

const QUIZ_EXPERT: Array<(c: QuizMessageContext) => string> = [
  c => `You absolutely nailed it. ${c.timeAgo} you asked me to quiz you on "${c.docName}" — and honestly? You've got this material down cold. ${c.score}/${c.total}, ${c.rank} status.${c.weakTopics ? ` One minor thing to keep sharp: ${c.weakTopics}.` : ' Near-perfect execution.'}`,

  c => `Okay, genuinely impressive. You set this ${c.difficulty} quiz up ${c.timeAgo} and just demolished it — ${c.score}/${c.total}. ${c.rank}. I'd say you're ready for anything they throw at this topic.`,

  c => `${c.timeAgo} you scheduled a ${c.difficulty} quiz on "${c.docName}". Turns out you knew more than you thought: ${c.score}/${c.total}, ${c.rank}.${c.weakTopics ? ` Worth a quick review on ${c.weakTopics} just to stay sharp.` : ' Barely anything to work on here.'}`,

  c => `Clean sweep, more or less. Quiz on "${c.docName}" set up ${c.timeAgo}, ${c.score}/${c.total}. At this point you can probably teach this material — the ${c.rank} rank isn't an accident.`,

  c => `Not surprised, honestly. You put in the time. Results for "${c.docName}" (${c.timeAgo}): ${c.score}/${c.total}, ${c.rank}.${c.weakTopics ? ` Keep an eye on ${c.weakTopics} — just so you don't get caught off guard on the detail stuff.` : ' Textbook preparation.'}`,

  c => `${c.rank} territory. ${c.score}/${c.total} on the "${c.docName}" quiz you scheduled ${c.timeAgo}. That's the kind of score that tells you the material actually stuck — not just short-term memory.`,
];

const QUIZ_SKILLED: Array<(c: QuizMessageContext) => string> = [
  c => `${c.timeAgo} you set up a quiz on "${c.docName}". Solid outing — ${c.score}/${c.total}, ${c.rank}. Core concepts are clearly there.${c.weakTopics ? ` The spots to sharpen: ${c.weakTopics}. Another round in a few days would lock those in.` : ''}`,

  c => `Here's where you landed on that quiz you scheduled ${c.timeAgo}: ${c.score}/${c.total}. Not bad at all.${c.weakTopics ? ` "${c.weakTopics}" gave you some trouble — which is exactly why spaced practice exists. One more round there and it'll click.` : ' Solid throughout.'}`,

  c => `Results for your "${c.docName}" quiz (set up ${c.timeAgo}): ${c.score}/${c.total}, ${c.rank}. The fundamentals are clearly there.${c.weakTopics ? ` Worth targeting ${c.weakTopics} specifically before the next round.` : ' You have this well in hand.'}`,

  c => `You set this up ${c.timeAgo}, and it paid off — ${c.score}/${c.total} on "${c.docName}".${c.weakTopics ? ` A few misses on ${c.weakTopics}, but the broader material? Solid.` : ' Well-rounded performance.'}`,

  c => `Good effort on the "${c.docName}" quiz you queued ${c.timeAgo}. ${c.score}/${c.total} — ${c.rank}.${c.weakTopics ? ` Tricky spots were around ${c.weakTopics}. Schedule another round in a week targeting just those and you'll be in great shape.` : ' You\ve got a good handle on this.'}`,

  c => `${c.score}/${c.total} on "${c.docName}" (scheduled ${c.timeAgo}). ${c.rank} — which means the work is paying off. ${c.weakTopics ? `Tighten up ${c.weakTopics} and you're pushing into top-score territory.` : 'Keep the momentum going.'}`,
];

const QUIZ_LEARNER: Array<(c: QuizMessageContext) => string> = [
  c => `Okay, real talk — ${c.timeAgo} you scheduled a quiz on "${c.docName}", and the results show where you actually are right now: ${c.score}/${c.total}. That's not a bad thing. The gaps are clearly around ${c.weakTopics || 'a few key areas'}, which is useful to know.`,

  c => `Results for your scheduled quiz on "${c.docName}" (${c.timeAgo}): ${c.score}/${c.total}. You've got pieces of this, but ${c.weakTopics || 'certain sections'} is where it's coming apart. More repetition there, then try again — the pattern will click.`,

  c => `The quiz you set up ${c.timeAgo} is done. ${c.score}/${c.total} on "${c.docName}" — ${c.rank}. Roughly half the material is solid, the other half needs more time.${c.weakTopics ? ` Worth scheduling another one focused purely on ${c.weakTopics}.` : ''}`,

  c => `Your "${c.docName}" quiz landed. Scheduled ${c.timeAgo}, ${c.score}/${c.total}. Mixed results, which is exactly what spaced practice is for.${c.weakTopics ? ` ${c.weakTopics} is your main target area.` : ''} That's not failure — that's data.`,

  c => `Quiz result for "${c.docName}" (${c.timeAgo}): ${c.score}/${c.total}. You know more than you think, but ${c.weakTopics || 'a few areas'} is where the understanding is patchy. One targeted round there and you'll see a real jump.`,

  c => `${c.score}/${c.total} — honestly, this is the part of the process people skip but shouldn't. You scheduled this quiz ${c.timeAgo} to check yourself, and now you know: ${c.weakTopics || 'a few topics'} need more attention. Good data to have.`,
];

const QUIZ_BEGINNER: Array<(c: QuizMessageContext) => string> = [
  c => `Alright — ${c.timeAgo} you asked for an honest look at "${c.docName}". The score is ${c.score}/${c.total}, and I'm not going to sugarcoat it.${c.weakTopics ? ` ${c.weakTopics} need serious work.` : ''} But you scheduled this because you wanted to know. Now you do.`,

  c => `Quiz results for "${c.docName}" (scheduled ${c.timeAgo}): ${c.score}/${c.total}. This material is tougher than it looked. The main trouble areas: ${c.weakTopics || 'most of the core concepts'}. Start there, not from the top.`,

  c => `Your quiz on "${c.docName}" is back: ${c.score}/${c.total}. Rough, but that's the point — you caught this early.${c.weakTopics ? ` ${c.weakTopics} are the foundation pieces that need reinforcing before the rest can click into place.` : ''} Schedule a retry soon.`,

  c => `${c.timeAgo} you set up this quiz as a check-in. Honest result: ${c.score}/${c.total}. Don't read too much into the number — focus on ${c.weakTopics || 'rebuilding the fundamentals'}. Schedule a targeted retry and you'll see movement.`,

  c => `The honest answer to "how well do I know '${c.docName}'?" is: ${c.score}/${c.total} right now. You flagged this ${c.timeAgo}, which was smart. The path forward is focused work on ${c.weakTopics || 'the core concepts'} — not re-reading everything from scratch.`,

  c => `${c.score}/${c.total} on "${c.docName}" (${c.timeAgo}). Okay. This is why we do this — so we know where we stand before it matters. ${c.weakTopics ? `Hit ${c.weakTopics} first, then build outward.` : 'Back to basics, build from there.'} You've got more ground to cover than you thought, but now you have a map.`,
];

export function buildQuizMessage(
  task: ScheduledTask,
  score: number,
  total: number,
  weakTopics: string[],
): string {
  if (task.payload.type !== 'quiz') return 'Your quiz is ready.';
  const timeAgo = formatTimeAgo(task.createdAt);
  const pct = total > 0 ? Math.round((score / total) * 100) : 0;
  const ranks: Record<string, string> = { expert: 'Expert', skilled: 'Skilled', learner: 'Learner', beginner: 'Beginner' };
  const rankKey = pct >= 90 ? 'expert' : pct >= 70 ? 'skilled' : pct >= 50 ? 'learner' : 'beginner';
  const ctx: QuizMessageContext = {
    timeAgo,
    docName: task.payload.data.documentName,
    score,
    total,
    percentage: pct,
    rank: ranks[rankKey],
    difficulty: task.payload.data.difficulty,
    weakTopics: weakTopics.length > 0 ? weakTopics.slice(0, 2).join(' and ') : '',
  };
  const pool = rankKey === 'expert' ? QUIZ_EXPERT : rankKey === 'skilled' ? QUIZ_SKILLED : rankKey === 'learner' ? QUIZ_LEARNER : QUIZ_BEGINNER;
  return pick(pool)(ctx);
}

// Message shown when the quiz is generated but not yet taken
const QUIZ_READY: Array<(c: { timeAgo: string; docName: string; count: number; difficulty: string }) => string> = [
  c => `Your quiz is ready. ${c.timeAgo} you asked me to prepare a ${c.difficulty} set from "${c.docName}" — ${c.count} questions, loaded and waiting. Tap to start whenever you're ready.`,

  c => `${c.timeAgo} you set this up and now it's showtime. ${c.count} questions on "${c.docName}", ${c.difficulty} difficulty. Go whenever you're ready.`,

  c => `Quiz generated. You scheduled this ${c.timeAgo} on "${c.docName}" — ${c.count} questions at ${c.difficulty} level. Take it now while the material is fresh in your mind.`,

  c => `Here it is. ${c.count}-question ${c.difficulty} quiz on "${c.docName}", built from the schedule you set up ${c.timeAgo}. Your call when to start.`,

  c => `${c.timeAgo} you decided to quiz yourself on "${c.docName}" at some point. That point is now — ${c.count} questions ready.`,

  c => `Ready when you are. ${c.count} ${c.difficulty} questions from "${c.docName}" — you asked me to have these waiting ${c.timeAgo}. Don't leave them sitting too long.`,

  c => `The "${c.docName}" quiz you put on the calendar ${c.timeAgo} is ready. ${c.count} questions, ${c.difficulty} mode. No pressure — but also, don't let it sit forever.`,
];

export function buildQuizReadyMessage(task: ScheduledTask, count: number): string {
  if (task.payload.type !== 'quiz') return 'Your quiz is ready.';
  const timeAgo = formatTimeAgo(task.createdAt);
  return pick(QUIZ_READY)({
    timeAgo,
    docName: task.payload.data.documentName,
    count,
    difficulty: task.payload.data.difficulty,
  });
}

// ── Workspace AI messages ─────────────────────────────────────────────────────

interface WorkspaceMessageContext {
  timeAgo: string;
  prompt: string;
  promptPreview: string;
}

const WORKSPACE_AI_MESSAGES: Array<(c: WorkspaceMessageContext) => string> = [
  c => `${c.timeAgo} you left me a question and said to pick it back up later. I did. Here's where I landed on "${c.promptPreview}".`,

  c => `You asked me to sit with this for a while — that was ${c.timeAgo}. I went away, thought it through, and here's what I came back with.`,

  c => `Picking up where you left off (${c.timeAgo}). Your original question: "${c.promptPreview}". Here's my take now.`,

  c => `So ${c.timeAgo} you stashed a question in your workspace, probably because you wanted a less rushed answer. Good instinct. Here it is.`,

  c => `Deferred thinking complete. You queued this up ${c.timeAgo}. The question was: "${c.promptPreview}". Here's what I've got.`,

  c => `This one's been sitting for ${c.timeAgo}. You asked: "${c.promptPreview}". Had time to consider it properly — here's the answer.`,

  c => `${c.timeAgo} you scheduled this AI block for later. Good call — some questions benefit from distance. Here's my response.`,

  c => `Coming back to you on something from ${c.timeAgo}: "${c.promptPreview}". Had time to think it through properly.`,

  c => `You parked a question ${c.timeAgo} and said to revisit it. I did. Here's what I've got.`,

  c => `This landed in my queue ${c.timeAgo}. The prompt: "${c.promptPreview}". Here's a response worth waiting for.`,

  c => `Some questions deserve more than an instant reply. You knew that ${c.timeAgo} when you scheduled this. The answer is below.`,

  c => `${c.timeAgo} you wrote: "${c.promptPreview}" and told me to come back to it. I'm here. Here's what the waiting produced.`,

  c => `Consider this your AI block delivery. "${c.promptPreview}" — you set this up ${c.timeAgo} for exactly this moment. Ready.`,

  c => `You future-proofed this one. ${c.timeAgo} you asked "${c.promptPreview}" and deferred it. Smart. Here's the result.`,
];

export function buildWorkspaceAIMessage(task: ScheduledTask): string {
  if (task.payload.type !== 'workspace_ai') return 'Your deferred AI response is ready.';
  const timeAgo = formatTimeAgo(task.createdAt);
  const prompt = task.payload.data.prompt;
  const promptPreview = prompt.length > 60 ? prompt.slice(0, 57) + '…' : prompt;
  return pick(WORKSPACE_AI_MESSAGES)({ timeAgo, prompt, promptPreview });
}

// ── Generate Document messages ────────────────────────────────────────────────

interface DocMessageContext {
  timeAgo: string;
  title: string;
  fileType: string;
  category: string;
  tone: string;
  wordCount: number;
  isRecurring: boolean;
  interval?: string;
  runCount?: number;
}

const DOC_ONE_OFF: Array<(c: DocMessageContext) => string> = [
  c => `${c.timeAgo} you asked me to draft "${c.title}". It's done — ${c.wordCount.toLocaleString()} words, ${c.fileType.toUpperCase()} format. Tap to review before saving.`,

  c => `Your document is ready. You scheduled this ${c.timeAgo}: "${c.title}". I've drafted it out and it's waiting for your review.`,

  c => `The "${c.title}" you commissioned ${c.timeAgo} is finished. ${c.wordCount.toLocaleString()} words, ${c.category} style, ready for a look.`,

  c => `Writing complete. ${c.timeAgo} you gave me the brief for "${c.title}" — I've turned it into a ${c.wordCount.toLocaleString()}-word ${c.fileType.toUpperCase()}.`,

  c => `${c.timeAgo} you set this up: draft a ${c.tone} ${c.category} document called "${c.title}". Done. Here's a preview of what I wrote.`,

  c => `Your scheduled document landed. "${c.title}" — ${c.wordCount.toLocaleString()} words, ${c.fileType.toUpperCase()}, ${c.category} tone. Give it a look; it should be close to what you described.`,

  c => `I built what you asked for ${c.timeAgo}. "${c.title}" is ready — ${c.wordCount.toLocaleString()}-word ${c.fileType.toUpperCase()}. Review it and save it to your library.`,

  c => `Here's the ${c.category} document you put in the queue ${c.timeAgo}: "${c.title}". ${c.wordCount.toLocaleString()} words, formatted and ready. Tap to edit or save as-is.`,

  c => `Okay, it's done. You briefed me ${c.timeAgo} on "${c.title}" and I've been drafting since. ${c.wordCount.toLocaleString()} words. Take a look.`,
];

const DOC_RECURRING_FIRST: Array<(c: DocMessageContext) => string> = [
  c => `This is the first run of your recurring "${c.title}" — set up ${c.timeAgo}. ${c.wordCount.toLocaleString()} words, freshly generated. I'll keep delivering this ${c.interval} automatically.`,

  c => `Your ${c.interval} "${c.title}" is live — first edition, generated right on schedule as you configured ${c.timeAgo}. I'll keep it coming.`,

  c => `First automated run of "${c.title}" (you set this to repeat ${c.interval}, ${c.timeAgo}). It's ready. From here I'll handle this on schedule without you lifting a finger.`,

  c => `Edition one of your ${c.interval} "${c.title}". ${c.wordCount.toLocaleString()} words, ${c.fileType.toUpperCase()}, delivered as scheduled. The automation is running.`,
];

const DOC_RECURRING_SUBSEQUENT: Array<(c: DocMessageContext) => string> = [
  c => `Running like clockwork — your ${c.interval} "${c.title}" just dropped. ${c.wordCount.toLocaleString()}-word edition, freshly drafted on schedule.`,

  c => `It's that time again. Your recurring "${c.title}" is ready — ${c.wordCount.toLocaleString()} words, ${c.fileType.toUpperCase()}, generated on schedule.`,

  c => `Another ${c.interval} has passed, another "${c.title}" delivered. Latest edition — tap to review your newest draft.`,

  c => `Your standing order for "${c.title}" ran again on schedule. ${c.wordCount.toLocaleString()}-word ${c.fileType.toUpperCase()}, ready to review.`,

  c => `Right on time — your ${c.interval} "${c.title}" is done. Consistent, automatic, ready when you are.`,

  c => `Edition ${c.runCount ?? '?'} of your recurring "${c.title}". Generated on schedule, ${c.wordCount.toLocaleString()} words. Same place it always lands — waiting for your review.`,

  c => `Automated delivery: "${c.title}". ${c.interval} schedule, ${c.wordCount.toLocaleString()} words, ${c.fileType.toUpperCase()}. Your recurring document is ready.`,

  c => `On schedule, as always. "${c.title}" — ${c.wordCount.toLocaleString()} words, this ${c.interval}'s edition. It's in the queue for your review.`,
];

export function buildGenerateDocumentMessage(task: ScheduledTask, wordCount: number): string {
  if (task.payload.type !== 'generate_document') return 'Your document is ready.';
  const timeAgo = formatTimeAgo(task.createdAt);
  const { title, fileType, category, tone } = task.payload.data;
  const INTERVAL_LABELS: Record<string, string> = {
    daily: 'daily', weekly: 'weekly', biweekly: 'bi-weekly', monthly: 'monthly',
  };
  const ctx: DocMessageContext = {
    timeAgo,
    title,
    fileType,
    category,
    tone,
    wordCount,
    isRecurring: !!task.recurring,
    interval: task.recurring ? INTERVAL_LABELS[task.recurring.interval] : undefined,
    runCount: task.recurring?.runCount,
  };

  if (!task.recurring) return pick(DOC_ONE_OFF)(ctx);
  if ((task.recurring.runCount ?? 1) <= 1) return pick(DOC_RECURRING_FIRST)(ctx);
  return pick(DOC_RECURRING_SUBSEQUENT)(ctx);
}

// ── Generic fallback ──────────────────────────────────────────────────────────

export function buildReturnMessage(task: ScheduledTask, meta?: Record<string, unknown>): string {
  const timeAgo = formatTimeAgo(task.createdAt);
  if (task.type === 'quiz' && meta) {
    const { score, total, weakTopics } = meta as { score: number; total: number; weakTopics: string[] };
    return buildQuizReadyMessage(task, total);
  }
  if (task.type === 'workspace_ai') return buildWorkspaceAIMessage(task);
  if (task.type === 'generate_document' && meta) {
    const { wordCount } = meta as { wordCount: number };
    return buildGenerateDocumentMessage(task, wordCount);
  }
  return `${timeAgo} you scheduled this task. It's done — tap to see the result.`;
}
