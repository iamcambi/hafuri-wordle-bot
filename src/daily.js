import { ANSWERS } from './words.js';

// Big odd prime chosen so that stepping through the ANSWERS array by this
// amount (mod its length) visits every index exactly once before repeating
// -- a full-period linear walk. This spreads consecutive calendar days
// across the whole answer list (instead of replaying it in file order)
// without needing any persisted "words already used" state.
const STEP = 104729; // the 10,000th prime -- coprime with any realistic list length
const OFFSET = 733957; // arbitrary large constant, just decorrelates day 0 from index 0

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
 * Deterministic answer for a given date key. Same word for every player,
 * every process, every restart -- as long as data/answers.txt doesn't
 * change -- so the puzzle is genuinely shared across the whole server.
 */
export function getDailyAnswer(dateKey) {
  const day = epochDayNumber(dateKey);
  const len = ANSWERS.length;
  const index = (((day * STEP + OFFSET) % len) + len) % len;
  return ANSWERS[index];
}
