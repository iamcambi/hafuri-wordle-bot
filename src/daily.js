import { getCachedNytPuzzle, ensureNytPuzzle } from './nyt.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const EPOCH_MS = Date.UTC(2024, 0, 1); // arbitrary fixed reference point, never changes

export const ANSWER_TIMEZONE = process.env.ANSWER_TIMEZONE || 'America/New_York';

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: ANSWER_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * The calendar date (YYYY-MM-DD) the daily puzzle rolls over on, evaluated
 * in ANSWER_TIMEZONE. Every player sees the same date key -- and therefore
 * the same secret word -- at the same moment, regardless of their own
 * local time.
 */
export function getTodayKey(now = new Date()) {
  return dateFormatter.format(now); // en-CA formats as YYYY-MM-DD
}

function epochDayNumber(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d);
  return Math.floor((ms - EPOCH_MS) / DAY_MS);
}

/**
 * Sequential day number for a date key (used for streak math in stats.js).
 */
export function dayNumber(dateKey) {
  return epochDayNumber(dateKey);
}

// Wordle #0 was June 19, 2021. NYT's days_since_launch is zero-based.
const WORDLE_EPOCH_MS = Date.UTC(2021, 5, 19);

/**
 * The NYT-style daily puzzle number (Wordle #1,234 ...) for a date key.
 */
export function puzzleNumber(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d);
  return Math.floor((ms - WORDLE_EPOCH_MS) / DAY_MS);
}

/**
 * Fetch and persist NYT's official puzzle before starting a new game.
 */
export function ensureDailyPuzzle(dateKey = getTodayKey()) {
  return ensureNytPuzzle(dateKey);
}

/** Read only an already-validated official answer, never a generated fallback. */
export function getDailyAnswer(dateKey) {
  return getCachedNytPuzzle(dateKey).solution;
}
