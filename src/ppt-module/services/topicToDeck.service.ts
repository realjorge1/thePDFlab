// ─────────────────────────────────────────────
//  PPT Module — Topic-to-Deck Service
//  One sentence in → a complete, themed, ready-to-edit deck out.
//
//  The standout: a generic "AI deck" tool dumps everything into title+bullets.
//  This asks the model to pick the RIGHT layout per slide and maps its JSON
//  output directly onto our existing Slide[] schema (14 layout types). If the
//  model is unreachable or returns prose, a deterministic builder still yields
//  a real, structured, editable deck — the feature never dead-ends.
// ─────────────────────────────────────────────

import { v4 as uuid } from 'uuid';
import { sendChat } from '@/services/ai/ai.service';
import {
  PPTPresentation,
  Slide,
  SlideContent,
  SlideLayout,
  ThemeId,
} from '../types/ppt.types';
import { THEME_LIST, DEFAULT_THEME_ID } from '../themes/pptThemes';

// Example one-liners shown as tappable chips on the home screen.
export const DECK_TOPIC_EXAMPLES: string[] = [
  'Pitch deck for a fitness app targeting Gen Z',
  'Q3 sales review for a SaaS startup',
  'Onboarding deck for new software engineers',
  'Investor update for a climate-tech company',
];

// Layouts the generator is allowed to emit. Every one of these renders in the
// canvas AND exports correctly via pptxGenerator, so a generated deck is never
// broken. Unknown layouts from the model are coerced to 'titleContent'.
const ALLOWED_LAYOUTS: SlideLayout[] = [
  'title',
  'agenda',
  'titleContent',
  'twoColumn',
  'comparison',
  'processSteps',
  'statHighlight',
  'timeline',
  'quote',
  'sectionDivider',
  'closing',
];

const VALID_THEME_IDS = new Set<string>(THEME_LIST.map((t) => t.id));

// ─── Public API ───────────────────────────────

export interface DeckGenerationResult {
  presentation: PPTPresentation;
  /** True when the deck came from the AI; false when the local fallback was used. */
  fromAI: boolean;
}

/**
 * Turn a single-sentence topic into a complete presentation.
 *
 * @param topic   The user's one-sentence description.
 * @param themeId Optional theme to honor. When omitted, the model picks one
 *                that fits the topic (falling back to a sensible default).
 * @param signal  Optional abort signal so the caller can cancel mid-flight.
 */
export async function generateDeckFromTopic(
  topic: string,
  themeId?: ThemeId,
  signal?: AbortSignal,
): Promise<DeckGenerationResult> {
  const cleanTopic = topic.trim();
  if (!cleanTopic) {
    return { presentation: buildFallbackDeck('Untitled Presentation', themeId), fromAI: false };
  }

  try {
    const res = await sendChat(buildPrompt(cleanTopic, themeId), [], undefined, undefined, signal);
    const parsed = extractJson<RawDeck>(res?.content ?? '');
    const presentation = parsed ? toPresentation(parsed, cleanTopic, themeId) : null;
    if (presentation && presentation.slides.length >= 2) {
      return { presentation, fromAI: true };
    }
  } catch (e) {
    // A cancellation (AbortError) must propagate so the UI can restore cleanly.
    if (isAbort(e)) throw e;
    // Any other failure falls through to the deterministic builder below.
  }

  return { presentation: buildFallbackDeck(cleanTopic, themeId), fromAI: false };
}

function isAbort(e: unknown): boolean {
  return e instanceof Error && (e.name === 'AbortError' || /abort|cancel/i.test(e.message));
}

// ─── Prompt ───────────────────────────────────

function buildPrompt(topic: string, themeId?: ThemeId): string {
  const themeIds = THEME_LIST.map((t) => t.id).join(', ');
  const themeLine = themeId
    ? `Use the theme "${themeId}".`
    : `Choose a "themeId" from this list that best fits the topic's mood: ${themeIds}.`;

  return [
    `You are an expert presentation designer. Turn the user's one-sentence brief into a complete, well-structured slide deck.`,
    ``,
    `Brief: "${topic}"`,
    ``,
    `Return ONLY a JSON object — no prose, no markdown, no code fences — shaped exactly like:`,
    `{`,
    `  "title": "Deck title (short, punchy)",`,
    `  "themeId": "<one theme id>",`,
    `  "slides": [ { "layout": "...", ...fields } ]`,
    `}`,
    ``,
    `Pick the RIGHT layout per slide (do NOT make everything title+bullets). Available layouts and their fields:`,
    `- "title": { "title", "subtitle" }  ← always the first slide`,
    `- "agenda": { "title", "bullets": [string] }  ← 3–6 short items`,
    `- "titleContent": { "title", "bullets": [string] }  ← 3–5 concise bullets (≤10 words each)`,
    `- "twoColumn": { "title", "leftContent", "rightContent" }  ← two short paragraphs`,
    `- "comparison": { "title", "leftTitle", "leftContent", "rightTitle", "rightContent" }  ← A vs B`,
    `- "processSteps": { "title", "steps": [string] }  ← 3–5 ordered steps`,
    `- "statHighlight": { "title", "stat": { "value", "label" }, "footnote" }  ← value is a number/figure like "73%" or "3.4x"`,
    `- "timeline": { "title", "timelineItems": [ { "year", "event" } ] }  ← 3–5 milestones`,
    `- "quote": { "body", "subtitle" }  ← body is the quote, subtitle is the attribution`,
    `- "sectionDivider": { "sectionNumber", "title", "subtitle" }  ← e.g. sectionNumber "01"`,
    `- "closing": { "title", "subtitle" }  ← always the last slide`,
    ``,
    `Rules:`,
    `- 8 to 12 slides total. First slide is "title", last is "closing".`,
    `- Use genuine variety: include at least two of comparison / timeline / statHighlight / processSteps where they fit the topic.`,
    `- Keep text tight and presentation-ready. Bullets are phrases, not sentences.`,
    `- Every field must be real content for THIS topic — never placeholders like "Point 1".`,
    themeLine,
  ].join('\n');
}

// ─── Tolerant JSON extraction ─────────────────
// Pulls the first balanced {...} object out of a model response that may include
// stray prose or code fences around the JSON.
function extractJson<T>(raw: string): T | null {
  if (!raw) return null;
  let s = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(s) as T;
  } catch {
    /* fall through to balanced-scan */
  }
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(s.slice(start, i + 1)) as T;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

// ─── Normalization: raw model JSON → validated PPTPresentation ─────────────

interface RawDeck {
  title?: unknown;
  themeId?: unknown;
  slides?: unknown;
}

function toPresentation(raw: RawDeck, topic: string, forcedTheme?: ThemeId): PPTPresentation {
  const themeId = resolveTheme(forcedTheme, raw.themeId);
  const rawSlides = Array.isArray(raw.slides) ? raw.slides : [];

  let slides: Slide[] = rawSlides
    .map(normalizeSlide)
    .filter((s): s is Slide => s !== null)
    .slice(0, 14);

  slides = ensureFraming(slides, topic);

  const title =
    str(raw.title) ||
    slides[0]?.content.title?.trim() ||
    titleCase(topic);

  // The first slide's heading IS the presentation title (export file name).
  if (slides[0]?.layout === 'title') {
    slides[0] = { ...slides[0], content: { ...slides[0].content, title } };
  }

  const now = new Date();
  return { id: uuid(), title, themeId, slides, createdAt: now, updatedAt: now };
}

function resolveTheme(forced?: ThemeId, suggested?: unknown): ThemeId {
  if (forced) return forced;
  const s = typeof suggested === 'string' ? suggested.trim() : '';
  if (s && VALID_THEME_IDS.has(s)) return s as ThemeId;
  return DEFAULT_THEME_ID;
}

// Guarantee a coherent open/close so the deck always reads as finished.
function ensureFraming(slides: Slide[], topic: string): Slide[] {
  const out = slides.length ? slides : [];
  if (out.length === 0 || out[0].layout !== 'title') {
    out.unshift(slide('title', { title: titleCase(topic), subtitle: '' }));
  }
  if (out[out.length - 1].layout !== 'closing') {
    out.push(slide('closing', { title: 'Thank You', subtitle: 'Questions & Discussion' }));
  }
  return out;
}

function normalizeSlide(raw: unknown): Slide | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  // The model sometimes nests fields under "content" — read from either level.
  const nested = (r.content && typeof r.content === 'object' ? r.content : {}) as Record<string, unknown>;
  const get = (k: string): unknown => (r[k] !== undefined ? r[k] : nested[k]);

  const layout = coerceLayout(r.layout);
  const content = buildContent(layout, get);
  if (isContentEmpty(layout, content)) return null;
  return { id: uuid(), layout, content };
}

function coerceLayout(raw: unknown): SlideLayout {
  const v = typeof raw === 'string' ? raw.trim() : '';
  return (ALLOWED_LAYOUTS as string[]).includes(v) ? (v as SlideLayout) : 'titleContent';
}

function buildContent(layout: SlideLayout, get: (k: string) => unknown): SlideContent {
  switch (layout) {
    case 'title':
      return { title: str(get('title')), subtitle: str(get('subtitle')) };
    case 'closing':
      return { title: str(get('title')) || 'Thank You', subtitle: str(get('subtitle')) };
    case 'agenda':
      return { title: str(get('title')) || 'Agenda', bullets: strArray(get('bullets') ?? get('items') ?? get('steps'), 6) };
    case 'titleContent': {
      const bullets = strArray(get('bullets') ?? get('points') ?? get('items'), 6);
      const body = str(get('body'));
      return bullets.length ? { title: str(get('title')), bullets } : { title: str(get('title')), body };
    }
    case 'twoColumn':
      return {
        title: str(get('title')),
        leftContent: str(get('leftContent') ?? get('left')),
        rightContent: str(get('rightContent') ?? get('right')),
      };
    case 'comparison':
      return {
        title: str(get('title')),
        leftTitle: str(get('leftTitle')),
        leftContent: multiline(get('leftContent') ?? get('left')),
        rightTitle: str(get('rightTitle')),
        rightContent: multiline(get('rightContent') ?? get('right')),
      };
    case 'processSteps':
      return { title: str(get('title')) || 'Process', steps: strArray(get('steps') ?? get('items') ?? get('bullets'), 6) };
    case 'statHighlight': {
      const stat = (get('stat') && typeof get('stat') === 'object' ? get('stat') : {}) as Record<string, unknown>;
      return {
        title: str(get('title')),
        stat: {
          value: str(stat.value ?? get('statValue') ?? get('value')),
          label: str(stat.label ?? get('statLabel') ?? get('label')),
        },
        footnote: str(get('footnote') ?? get('source')),
      };
    }
    case 'timeline':
      return { title: str(get('title')) || 'Timeline', timelineItems: timelineItems(get('timelineItems') ?? get('items') ?? get('events')) };
    case 'quote':
      return { body: str(get('body') ?? get('quote')), subtitle: str(get('subtitle') ?? get('attribution') ?? get('author')) };
    case 'sectionDivider':
      return {
        sectionNumber: str(get('sectionNumber') ?? get('number')),
        title: str(get('title')),
        subtitle: str(get('subtitle') ?? get('description')),
      };
    default:
      return { title: str(get('title')), body: str(get('body')) };
  }
}

// A slide is dropped only when it carries no usable content at all.
function isContentEmpty(layout: SlideLayout, c: SlideContent): boolean {
  switch (layout) {
    case 'agenda':
    case 'titleContent':
      return !(c.title || (c.bullets?.length ?? 0) > 0 || c.body);
    case 'processSteps':
      return (c.steps?.length ?? 0) === 0 && !c.title;
    case 'timeline':
      return (c.timelineItems?.length ?? 0) === 0 && !c.title;
    case 'statHighlight':
      return !c.stat?.value && !c.title;
    case 'comparison':
      return !(c.leftContent || c.rightContent || c.title);
    case 'twoColumn':
      return !(c.leftContent || c.rightContent || c.title);
    case 'quote':
      return !c.body;
    case 'sectionDivider':
      return !(c.title || c.sectionNumber);
    default:
      return !(c.title || c.subtitle || c.body);
  }
}

// ─── Field coercion helpers ───────────────────

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
}

function strArray(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((item) =>
      typeof item === 'string'
        ? item.trim()
        : item && typeof item === 'object'
          ? str((item as any).text ?? (item as any).label ?? (item as any).title)
          : str(item),
    )
    .filter(Boolean)
    .slice(0, max);
}

// Join an array (or pass a string through) into newline-separated text for
// the left/right panels of comparison slides.
function multiline(v: unknown): string {
  if (Array.isArray(v)) return strArray(v, 6).join('\n');
  return str(v);
}

function timelineItems(v: unknown): Array<{ year: string; event: string }> {
  if (!Array.isArray(v)) return [];
  return v
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const o = item as Record<string, unknown>;
      const year = str(o.year ?? o.date ?? o.when ?? o.label);
      const event = str(o.event ?? o.title ?? o.text ?? o.description);
      if (!year && !event) return null;
      return { year, event };
    })
    .filter((x): x is { year: string; event: string } => x !== null)
    .slice(0, 6);
}

// ─── Deterministic fallback deck ──────────────
// Used when the model is offline / returns unusable output. It still produces a
// genuinely structured, themed, editable deck (not blank) so the user can keep
// working — they just fill in the specifics.

function buildFallbackDeck(topic: string, themeId?: ThemeId): PPTPresentation {
  const title = titleCase(topic);
  const now = new Date();
  const slides: Slide[] = [
    slide('title', { title, subtitle: 'A presentation' }),
    slide('agenda', {
      title: 'Agenda',
      bullets: ['Overview', 'Why it matters', 'How it works', 'Key results', "What's next"],
    }),
    slide('sectionDivider', { sectionNumber: '01', title: 'Overview', subtitle: title }),
    slide('titleContent', {
      title: 'The opportunity',
      bullets: ['The problem we address', 'Who it affects', 'Why now'],
    }),
    slide('comparison', {
      title: 'Before vs. After',
      leftTitle: 'Today',
      leftContent: 'The current state\nKey pain points\nWhat it costs',
      rightTitle: 'With us',
      rightContent: 'The improved state\nWhat changes\nThe upside',
    }),
    slide('processSteps', {
      title: 'How it works',
      steps: ['Step one', 'Step two', 'Step three'],
    }),
    slide('statHighlight', {
      title: 'The impact',
      stat: { value: '00%', label: 'Headline result' },
      footnote: 'Add your source',
    }),
    slide('titleContent', {
      title: 'Key takeaways',
      bullets: ['First takeaway', 'Second takeaway', 'Third takeaway'],
    }),
    slide('closing', { title: 'Thank You', subtitle: 'Questions & Discussion' }),
  ];
  return { id: uuid(), title, themeId: themeId ?? DEFAULT_THEME_ID, slides, createdAt: now, updatedAt: now };
}

function slide(layout: SlideLayout, content: SlideContent): Slide {
  return { id: uuid(), layout, content };
}

function titleCase(s: string): string {
  const cleaned = s.trim().replace(/[."]+$/, '');
  if (!cleaned) return 'Untitled Presentation';
  // Keep it short enough to read as a deck title.
  const short = cleaned.length > 70 ? cleaned.slice(0, 70).trim() + '…' : cleaned;
  return short.charAt(0).toUpperCase() + short.slice(1);
}
