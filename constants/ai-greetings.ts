// ============================================
// AI greetings
// ---------------------------------------------
// Time-aware, rotating greetings shown on the empty AI screen (replacing the
// old static "Have a conversation with gozlin"). `pickGreeting()` chooses a
// random line from the bucket that matches the current local hour and never
// repeats the same line twice in a row.
//
// Buckets: midnight/early-morning, morning, noon/afternoon, evening, night —
// 20 lines each.
// ============================================

type TimeBucket = "midnight" | "morning" | "noon" | "evening" | "night";

const GREETINGS: Record<TimeBucket, string[]> = {
  // 00:00 – 04:59 — midnight / early morning
  midnight: [
    "Burning the midnight oil?",
    "The quiet hours are great for thinking.",
    "Still curious at this hour? I like that.",
    "Late-night learning, let's go.",
    "The world's asleep — perfect time to focus.",
    "A night owl after my own heart.",
    "Big ideas often come at 3am.",
    "Can't sleep? Let's learn something instead.",
    "Midnight curiosity is the best kind.",
    "The stars are out — so is your mind.",
    "Quiet night, clear thoughts.",
    "Let's make this late hour count.",
    "Some of history's best work happened at night.",
    "Resting minds rarely discover — but yours is awake.",
    "Here for your midnight breakthroughs.",
    "The night is young and so is the question.",
    "Deep night, deep focus.",
    "What's keeping you up? Let's untangle it.",
    "A little learning before the dawn?",
    "The early hours belong to the curious.",
  ],
  // 05:00 – 11:59 — morning
  morning: [
    "Good morning — ready to learn?",
    "Rise and think.",
    "A fresh day, a fresh question.",
    "Morning! Your mind is sharpest now.",
    "Let's start the day with a discovery.",
    "Good morning, curious one.",
    "Coffee and curiosity — perfect pair.",
    "New day, new things to understand.",
    "Bright and early — I like your style.",
    "Let's make today a little smarter.",
    "Morning momentum starts here.",
    "First thought of the day? Make it count.",
    "The early mind catches the idea.",
    "Wishing you a thoughtful morning.",
    "Ready when you are this fine morning.",
    "Let's turn this morning into progress.",
    "A good morning for a good question.",
    "Sunrise and a clean slate.",
    "Start small, learn big.",
    "Hello, morning thinker.",
  ],
  // 12:00 – 16:59 — noon / afternoon
  noon: [
    "Good afternoon — what shall we explore?",
    "Midday curiosity, right on time.",
    "Afternoon brain fuel, coming up.",
    "Let's beat the afternoon slump with an idea.",
    "Halfway through the day — let's learn something.",
    "Good afternoon, thinker.",
    "A perfect time for a fresh thought.",
    "Lunchtime for the mind?",
    "Afternoon questions are always welcome.",
    "Keep the momentum going this afternoon.",
    "What's on your mind this fine afternoon?",
    "Midday is made for discoveries.",
    "Let's make the afternoon productive.",
    "Back at it again?",
    "A little learning between tasks?",
    "Afternoon spark — let's chase it.",
    "Good afternoon — curiosity never clocks out.",
    "The day's still full of things to learn.",
    "Recharge with a new idea.",
    "Ready for your next question.",
  ],
  // 17:00 – 20:59 — evening
  evening: [
    "Good evening — let's wind down with a thought.",
    "Evening is a fine time to reflect.",
    "How was your day? Let's learn something new.",
    "Golden hour, golden ideas.",
    "Good evening, curious mind.",
    "Let's end the day a little wiser.",
    "Evenings are perfect for slow thinking.",
    "Unwind with a question or two.",
    "The day's winding down — your curiosity isn't.",
    "Evening study session? I'm in.",
    "A calm evening for clear thoughts.",
    "Good evening — what sparked your curiosity today?",
    "Let's make this evening count.",
    "Settle in and let's explore.",
    "Twilight thinking suits you.",
    "One more idea before the day's done?",
    "Good evening — knowledge tastes better after dinner.",
    "Reflect, learn, repeat.",
    "Here for your evening questions.",
    "Wind down, wonder on.",
  ],
  // 21:00 – 23:59 — night
  night: [
    "Good night owl — what's on your mind?",
    "Winding down with a little learning?",
    "The night is calm — perfect for ideas.",
    "Late evening thoughts welcome here.",
    "A quiet hour for a good question.",
    "Still curious before bed? Wonderful.",
    "Let's end the night a little wiser.",
    "Nighttime is for the deep questions.",
    "One last idea before you rest?",
    "The day is done — curiosity isn't.",
    "Good night thinking starts here.",
    "Stars are out; let's chase a thought.",
    "A peaceful night for learning.",
    "Tucking in with a new fact?",
    "Late, but never too late to learn.",
    "Quiet night, open mind.",
    "Let's make the night thoughtful.",
    "Here for your bedtime curiosities.",
    "Slow night, sharp mind.",
    "Rest soon — but wonder first.",
  ],
};

function bucketForHour(hour: number): TimeBucket {
  if (hour < 5) return "midnight";
  if (hour < 12) return "morning";
  if (hour < 17) return "noon";
  if (hour < 21) return "evening";
  return "night";
}

// Remember the last greeting shown so we never repeat it twice in a row.
let lastGreeting: string | null = null;

/** A random greeting for the current local time, never the same as last time. */
export function pickGreeting(date: Date = new Date()): string {
  const pool = GREETINGS[bucketForHour(date.getHours())];
  if (pool.length <= 1) return pool[0] ?? "Hello there.";

  let pick = pool[Math.floor(Math.random() * pool.length)];
  let attempts = 0;
  while (pick === lastGreeting && attempts < 5) {
    pick = pool[Math.floor(Math.random() * pool.length)];
    attempts++;
  }
  lastGreeting = pick;
  return pick;
}
