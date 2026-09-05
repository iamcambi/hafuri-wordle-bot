import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORE_PATH = process.env.DAILY_FILE || join(__dirname, '..', 'data', 'daily.json');

// How many past days of per-player daily results to keep on disk (for the
// leaderboard / debugging). Older days are pruned on every save so this
// file can't grow forever. Contains that day's secret word, so it's kept
// out of git the same way stats.json is.
const RETAIN_DAYS = 14;

function blankDay() {
  return { players: {} }; // players[userId] = { answer, attempts: [{word,result}], status, startedAt, completedAt }
}

function load() {
  if (!existsSync(STORE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(STORE_PATH, 'utf8'));
  } catch (err) {
    console.error(`Could not parse daily store at ${STORE_PATH}, starting fresh:`, err.message);
    return {};
  }
}

let store = load();

function persist() {
  mkdirSync(dirname(STORE_PATH), { recursive: true });
  const keys = Object.keys(store).sort();
  if (keys.length > RETAIN_DAYS) {
    for (const k of keys.slice(0, keys.length - RETAIN_DAYS)) delete store[k];
  }
  // Write to a temp file then rename, so a crash mid-write can't corrupt daily.json.
  const tmpPath = `${STORE_PATH}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(store, null, 2));
  writeFileSync(STORE_PATH, readFileSync(tmpPath));
}

function getDay(dateKey) {
  if (!store[dateKey]) store[dateKey] = blankDay();
  return store[dateKey];
}

export function getPlayerEntry(dateKey, userId) {
  return getDay(dateKey).players[userId] || null;
}

export function savePlayerEntry(dateKey, userId, entry) {
  getDay(dateKey).players[userId] = entry;
  persist();
}

/**
 * Everyone who has finished (won, lost, or gave up on) today's word,
 * ranked winners-first, fewest guesses first, earliest finish breaking ties.
 */
export function getLeaderboard(dateKey) {
  const day = getDay(dateKey);
  return Object.entries(day.players)
    .filter(([, e]) => e.status === 'won' || e.status === 'lost' || e.status === 'gaveup')
    .map(([userId, e]) => ({ userId, ...e }))
    .sort((a, b) => {
      const rank = (e) => (e.status === 'won' ? 0 : 1);
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      if (a.attempts.length !== b.attempts.length) return a.attempts.length - b.attempts.length;
      return a.completedAt - b.completedAt;
    });
}
