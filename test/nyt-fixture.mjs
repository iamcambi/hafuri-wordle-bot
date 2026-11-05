import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Offline fixtures, not live puzzle answers. Set before importing the app. */
export function prepareNytFixture() {
  process.env.ANSWER_TIMEZONE = 'America/New_York';
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.ANSWER_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  process.env.NYT_CACHE_FILE = join(mkdtempSync(join(tmpdir(), 'nyt-')), 'puzzles.json');
  const dates = [...new Set([today, '2026-11-05'])];
  writeFileSync(process.env.NYT_CACHE_FILE, JSON.stringify(Object.fromEntries(dates.map((date) => [
    date, {
      print_date: date,
      days_since_launch: (Date.parse(`${date}T00:00:00Z`) - Date.UTC(2021, 5, 19)) / 86400000,
      solution: 'crone',
      source: 'nyt',
    },
  ]))));
}
