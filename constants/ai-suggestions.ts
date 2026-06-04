// ============================================
// AI suggestion prompts
// ---------------------------------------------
// Tappable starter prompts shown on empty AI screens. Tapping one fills the
// composer and auto-sends. Each feature has a large pool of educational /
// enlightening prompts; `pickSuggestions()` returns a fresh random subset on
// every screen open and never repeats the exact same batch twice in a row.
// ============================================

import type { AIAction } from "@/services/ai/ai.types";

// How many chips to show at once.
const SHOW_COUNT = 6;

export const AI_SUGGESTIONS: Partial<Record<AIAction, string[]>> = {
  chat: [
    "Write me a poem about paradox",
    "What are the most recently discovered chemical elements?",
    "Explain quantum entanglement like I'm 12",
    "Summarize the plot of Crime and Punishment",
    "Give me 5 study tips backed by science",
    "Why is the sky blue, really?",
    "Teach me a surprising fact about the ocean",
    "What would happen if the Earth stopped spinning?",
    "Explain the Fibonacci sequence with an example",
    "Who was Ada Lovelace and why does she matter?",
    "Break down how vaccines train the immune system",
    "What's the difference between weather and climate?",
    "Tell me about a philosophy idea that changed the world",
    "How do black holes bend time?",
    "Explain compound interest like I'm new to money",
    "What makes a good argument vs a fallacy?",
    "Give me a 3-minute history of the internet",
    "How does the brain form long-term memories?",
    "Walk me through the scientific method with an example",
    "What is entropy, in plain language?",
  ],
  summarize: [
    "Summarize the key themes of 1984",
    "Give me the main arguments of The Republic",
    "Condense the theory of evolution into 5 points",
    "Summarize the causes of World War I",
    "A short TL;DR of the French Revolution",
    "Summarize the plot of The Odyssey",
    "Boil down the laws of thermodynamics",
    "Summarize the key ideas of The Wealth of Nations",
    "Give me the gist of Einstein's relativity",
    "Summarize the story of the Apollo 11 mission",
    "Condense the water cycle into a few lines",
    "Summarize the main points of the Magna Carta",
    "A quick TL;DR of how photosynthesis works",
    "Summarize the themes of To Kill a Mockingbird",
    "Sum up the causes of the Great Depression",
    "Summarize the basics of supply and demand",
  ],
  translate: [
    'Translate "Knowledge is power" to Latin',
    'How do you say "once upon a time" in French?',
    "Translate a haiku about autumn into Japanese",
    "Render a famous Shakespeare line in Spanish",
    'Translate "the pen is mightier than the sword"',
    'Say "the early bird catches the worm" in German',
    'Translate "to be or not to be" into Italian',
    "How do you greet someone politely in Japanese?",
    'Translate "carpe diem" into everyday English',
    'Say "thank you for your kindness" in Swahili',
    "Translate a short proverb about patience into Arabic",
    'How do you say "good luck" in Mandarin Chinese?',
    'Translate "all that glitters is not gold" to French',
    'Say "knowledge has no end" in Hindi',
  ],
  analyze: [
    "Analyze the tone of a famous speech",
    "Break down the structure of a sonnet",
    "What rhetorical devices appear in Hamlet's soliloquy?",
    "Analyze the readability of academic writing",
    "Analyze the argument in a short essay",
    "Compare the writing styles of two authors",
    "Analyze the symbolism in The Great Gatsby",
    "What's the central conflict in this passage?",
    "Analyze the persuasive techniques in an ad",
    "Break down the logic of a famous proof",
    "Find the assumptions hidden in an argument",
    "Analyze the mood created by this description",
    "What patterns show up in this data summary?",
    "Critique the strength of this thesis statement",
  ],
  tasks: [
    "Find the action items in my meeting notes",
    "Turn this reading list into a study plan",
    "Extract the to-dos from a project brief",
    "Pull the deadlines from a syllabus",
    "List the steps of the scientific method",
    "Break this big goal into weekly tasks",
    "Find what I need to prepare from these notes",
    "Turn this chapter into a revision checklist",
    "Extract the next steps from this email",
    "Make a study schedule from this exam outline",
    "Pull the assignments and their due dates",
    "List the prerequisites mentioned in this plan",
  ],
  explain: [
    "Explain the theory of relativity simply",
    "Explain photosynthesis to a beginner",
    "Break down how a neural network learns",
    "Explain supply and demand in plain English",
    "What is the Pythagorean theorem, simply?",
    "Explain DNA and genes like I'm 10",
    "Explain how the stock market works",
    "Break down what inflation actually means",
    "Explain gravity without the equations",
    "What is machine learning, in simple terms?",
    "Explain the greenhouse effect step by step",
    "Explain how electricity flows in a circuit",
    "Break down the difference between mass and weight",
    "Explain how the immune system fights germs",
    "What is the speed of light and why does it matter?",
  ],
  highlight: [
    "Find the key points in a research abstract",
    "Highlight the most important lines of a contract",
    "Pull the critical facts from a history chapter",
    "What are the key takeaways of this essay?",
    "Highlight the thesis of an argument",
    "Find the most quotable lines in this text",
    "Highlight the definitions I should memorize",
    "Pull out the cause-and-effect statements",
    "Highlight the dates and figures that matter",
    "What sentences carry the main idea here?",
    "Find the warnings or conditions in this document",
    "Highlight the steps in this process",
  ],
  quiz: [
    "Quiz me on the periodic table",
    "Make flashcards for the world capitals",
    "Test me on Shakespeare's plays",
    "Generate questions on cell biology",
    "Quiz me on key dates in history",
    "Make a quiz on the solar system",
    "Test my knowledge of human anatomy",
    "Quiz me on grammar and punctuation",
    "Generate questions on famous inventions",
    "Make flashcards for common Spanish words",
    "Quiz me on the branches of government",
    "Test me on the parts of a plant",
  ],
  classify: [
    "What type of document is this?",
    "Suggest a clean filename for this file",
    "Is this an invoice, a contract, or a report?",
    "Categorize this document for me",
    "Detect the document type and rename it",
    "What folder should this file go in?",
    "Is this formal or informal writing?",
    "Tell me the subject area of this document",
    "Classify this as personal, work, or study",
    "What's the best label for this file?",
  ],
  "generate-document": [
    "Write a one-page essay on climate change",
    "Draft a book report on To Kill a Mockingbird",
    "Create study notes on the water cycle",
    "Write a short biography of Marie Curie",
    "Draft a clean lab report template",
    "Write an outline for a history presentation",
    "Create revision notes on World War II",
    "Draft a persuasive essay on renewable energy",
    "Write a summary sheet of the human body systems",
    "Create a cheat sheet for algebra formulas",
    "Draft a reflective journal entry template",
    "Write an explainer on how the brain works",
    "Create a one-pager on the causes of inflation",
    "Draft a reading guide for a novel",
  ],
  "chat-with-document": [
    "What is the main argument of this document?",
    "Summarize this in three sentences",
    "What are the key dates mentioned here?",
    "Explain the conclusion in simple terms",
    "List the most important takeaways",
    "What questions does this document leave open?",
    "Who is the intended audience of this text?",
    "Find any contradictions in this document",
    "What evidence supports the main claim?",
    "Explain the hardest part of this in plain English",
    "What should I remember from this for an exam?",
    "Give me 5 quiz questions from this document",
  ],
  "extract-text": [
    "Extract all the text from this PDF",
    "Pull the readable text page by page",
    "Get the text so I can copy it",
    "Extract the text and count the words",
    "Turn this scanned PDF into plain text",
    "Pull out just the headings and titles",
    "Extract the text from the first few pages",
    "Get the clean text without the page numbers",
  ],
};

const DEFAULT_SUGGESTIONS = AI_SUGGESTIONS.chat!;

/** Full pool of prompts for a feature (falls back to chat). */
export function suggestionsFor(action: AIAction): string[] {
  return AI_SUGGESTIONS[action] ?? DEFAULT_SUGGESTIONS;
}

// In-memory record of the last batch shown per action, so we never show the
// exact same set twice in a row (resets on app reload — that's fine).
const lastBatch: Partial<Record<AIAction, string>> = {};

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Return a fresh random subset of prompts for a feature. The batch is guaranteed
 * not to be identical to the previous batch for the same action (best-effort,
 * with a few reshuffle attempts).
 */
export function pickSuggestions(
  action: AIAction,
  count: number = SHOW_COUNT,
): string[] {
  const pool = suggestionsFor(action);
  if (pool.length <= count) return pool.slice();

  let batch = shuffle(pool).slice(0, count);
  let attempts = 0;
  // Avoid an identical consecutive batch (order-insensitive comparison).
  const signature = (b: string[]) => b.slice().sort().join("|");
  while (signature(batch) === lastBatch[action] && attempts < 5) {
    batch = shuffle(pool).slice(0, count);
    attempts++;
  }
  lastBatch[action] = signature(batch);
  return batch;
}
