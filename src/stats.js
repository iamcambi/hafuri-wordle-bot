import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_ATTEMPTS } from './wordle.js';

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
  // Write to a temp file then rename, so a crash mid-write can't corrupt stats.json.
  const tmpPath = `${STATS_PATH}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(stats, null, 2));
  writeFileSync(STATS_PATH, readFileSync(tmpPath));
}

export function getStats(userId) {
  return stats[userId] || blankStats();
}

export function recordResult(userId, won, attemptsUsed) {
  const s = stats[userId] || blankStats();
  s.played += 1;
  if (won) {
    s.won += 1;
    s.currentStreak += 1;
    s.maxStreak = Math.max(s.maxStreak, s.currentStreak);
    s.distribution[attemptsUsed - 1] += 1;
  } else {
    s.currentStreak = 0;
  }
  stats[userId] = s;
  persist();
  return s;
}
