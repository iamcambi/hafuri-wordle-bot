import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_ATTEMPTS } from './wordle.js';
import { dayNumber, getTodayKey } from './daily.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATS_PATH = process.env.STATS_FILE || join(__dirname, '..', 'data', 'stats.json');

function blankStats() {
  return {
    played: 0,
    won: 0,
    currentStreak: 0,
    maxStreak: 0,
    // distribution[i] = number of wins that took i+1 guesses
    distribution: Array(MAX_ATTEMPTS).fill(0),
    // Day number (see daily.js) of the player's most recent win. Used to
    // break streaks when a day is missed, exactly like the NYT app.
    lastWonDay: null,
    // Per-player hard-mode preference (NYT-style), snapshotted into each
    // day's game entry when they start.
    hardMode: false,
  };
}

function load() {
  if (!existsSync(STATS_PATH)) return {};
  try {
    return JSON.parse(readFileSync(STATS_PATH, 'utf8'));
  } catch (err) {
    console.error(`Could not parse stats file at ${STATS_PATH}, starting fresh:`, err.message);
    return {};
  }
}

let stats = load();

function persist() {
  mkdirSync(dirname(STATS_PATH), { recursive: true });
  // Write to a temp file then atomically rename, so a crash mid-write can
  // never corrupt stats.json.
  const tmpPath = `${STATS_PATH}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(stats, null, 2));
  renameSync(tmpPath, STATS_PATH);
}

export function getStats(userId) {
  return stats[userId] || blankStats();
}

/**
 * Record the outcome of a finished daily game. Like the NYT app, a win
 * only extends a streak if the previous win was yesterday — skipping a
 * day resets it to 1.
 *
 * @param {string} userId
 * @param {boolean} won
 * @param {number} attemptsUsed guesses used (1..6)
 * @param {string} [dateKey] the day the game was played on (defaults to today)
 */
export function recordResult(userId, won, attemptsUsed, dateKey = getTodayKey()) {
  const s = stats[userId] || blankStats();
  const day = dayNumber(dateKey);
  s.played += 1;

  if (won) {
    s.won += 1;
    // If we have a known previous win day, the streak only continues when
    // it was the immediately preceding day (NYT behavior). Entries written
    // before lastWonDay existed (null) keep the old increment behavior so
    // existing streaks aren't wiped by the upgrade.
    if (s.lastWonDay == null) {
      s.currentStreak += 1;
    } else {
      s.currentStreak = day - s.lastWonDay === 1 ? s.currentStreak + 1 : 1;
    }
    s.lastWonDay = day;
    s.maxStreak = Math.max(s.maxStreak, s.currentStreak);
    s.distribution[attemptsUsed - 1] += 1;
  } else {
    s.currentStreak = 0;
    s.lastWonDay = s.lastWonDay ?? null;
  }

  stats[userId] = s;
  persist();
  return s;
}

/** The player's persistent hard-mode preference (NYT-style). */
export function getHardMode(userId) {
  return Boolean(stats[userId]?.hardMode);
}

/** Toggle / set the player's hard-mode preference. Returns the new value. */
export function setHardMode(userId, on) {
  const s = stats[userId] || blankStats();
  s.hardMode = Boolean(on);
  stats[userId] = s;
  persist();
  return s.hardMode;
}

/**
 * NYT-style guess-distribution bars, tallest bar scaled to 10 blocks:
 *
 *   1 ▕████████ 3
 *   2 ▕██ 1
 */
export function renderDistribution(s) {
  const max = Math.max(1, ...s.distribution);
  return s.distribution
    .map((count, i) => {
      const blocks = count === 0 ? '' : '█'.repeat(Math.max(1, Math.round((count / max) * 10)));
      return `${i + 1} ▕${blocks}${count > 0 ? ` ${count}` : ''}`;
    })
    .join('\n');
}
