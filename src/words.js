import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');

function loadWordList(filename) {
  return readFileSync(join(DATA_DIR, filename), 'utf8')
    .split('\n')
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w.length === 5 && /^[a-z]+$/.test(w));
}

// 2,314 words that can appear as the secret answer (original Wordle answer list).
export const ANSWERS = loadWordList('answers.txt');

// ~10,656 additional words accepted as valid guesses but never used as answers.
const EXTRA_GUESSES = loadWordList('guesses.txt');

// Full set of words a player is allowed to type as a guess.
export const VALID_GUESSES = new Set([...ANSWERS, ...EXTRA_GUESSES]);

export function pickRandomAnswer() {
  return ANSWERS[Math.floor(Math.random() * ANSWERS.length)];
}
