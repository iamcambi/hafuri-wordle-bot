export const WORD_LENGTH = 5;
export const MAX_ATTEMPTS = 6;

const TILE = {
  correct: '🟩',
  present: '🟨',
  absent: '⬛',
};

/**
 * Score a guess against the answer using standard Wordle rules
 * (duplicate letters are only marked "present" as many times as
 * they actually occur, unmatched, in the answer).
 *
 * Returns an array of 'correct' | 'present' | 'absent', one per letter.
 */
export function evaluateGuess(guess, answer) {
  const result = Array(WORD_LENGTH).fill('absent');
  const guessLetters = guess.split('');
  const answerLetters = answer.split('');
  const consumed = Array(WORD_LENGTH).fill(false);

  // Pass 1: exact position matches.
  for (let i = 0; i < WORD_LENGTH; i++) {
    if (guessLetters[i] === answerLetters[i]) {
      result[i] = 'correct';
      consumed[i] = true;
    }
  }

  // Pass 2: right letter, wrong position — only consume unmatched answer letters.
  for (let i = 0; i < WORD_LENGTH; i++) {
    if (result[i] === 'correct') continue;
    const idx = answerLetters.findIndex((ch, j) => !consumed[j] && ch === guessLetters[i]);
    if (idx !== -1) {
      result[i] = 'present';
      consumed[idx] = true;
    }
  }

  return result;
}

export function renderTiles(result) {
  return result.map((r) => TILE[r]).join('');
}

export function renderRow(word, result) {
  return `${renderTiles(result)}  ${word.toUpperCase()}`;
}

/** An entry's full accumulated board, one tile row per guess (NYT-style). */
export function renderBoard(entry) {
  if (!entry.attempts.length) return '_No guesses made._';
  return entry.attempts.map((a) => renderTiles(a.result)).join('\n');
}

// QWERTY layout, same as the NYT on-screen keyboard. Letters the player has
// learned something about are replaced by their best-known tile color, so
// the row position itself identifies the letter.
const KEYBOARD_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const STATE_RANK = { absent: 1, present: 2, correct: 3 };

/**
 * Render the letter keyboard, NYT-style: each letter shows the best state
 * discovered across all guesses so far (🟩 > 🟨 > ⬛). Unguessed letters
 * show as plain letters.
 */
export function renderKeyboard(attempts) {
  const state = {};
  for (const a of attempts) {
    a.result.forEach((r, i) => {
      const ch = a.word[i];
      if (!state[ch] || STATE_RANK[r] > STATE_RANK[state[ch]]) state[ch] = r;
    });
  }
  return KEYBOARD_ROWS.map((row) =>
    row
      .split('')
      .map((ch) => (state[ch] ? TILE[state[ch]] : ch.toUpperCase()))
      .join(' ')
  ).join('\n');
}

/**
 * NYT hard-mode validation. Returns an array of human-readable problems
 * (empty when the guess is legal): every revealed hint must be reused —
 * greens in the same position, yellows somewhere in the word.
 */
export function hardModeIssues(attempts, guess) {
  const issues = [];
  const greenAt = {}; // position -> letter
  const required = {}; // letter -> minimum count that must appear

  for (const a of attempts) {
    const counts = {};
    a.result.forEach((r, i) => {
      const ch = a.word[i];
      if (r === 'correct') {
        greenAt[i] = ch;
        counts[ch] = (counts[ch] || 0) + 1;
      } else if (r === 'present') {
        counts[ch] = (counts[ch] || 0) + 1;
      }
    });
    for (const [ch, c] of Object.entries(counts)) {
      required[ch] = Math.max(required[ch] || 0, c);
    }
  }

  for (const [pos, ch] of Object.entries(greenAt)) {
    if (guess[Number(pos)] !== ch) {
      issues.push(`\`${ch.toUpperCase()}\` must stay in position ${Number(pos) + 1}`);
    }
  }

  const guessCounts = {};
  for (const ch of guess) guessCounts[ch] = (guessCounts[ch] || 0) + 1;
  for (const [ch, c] of Object.entries(required)) {
    if ((guessCounts[ch] || 0) < c) {
      issues.push(`guess must include \`${ch.toUpperCase()}\`${c > 1 ? ` ×${c}` : ''}`);
    }
  }

  return issues;
}

/** NYT-style spoiler-free share grid (tile rows only). */
export function shareGrid(attempts) {
  return attempts.map((a) => renderTiles(a.result)).join('\n');
}

/** NYT-style spoiler-free result line, e.g. `4/6*` (star = hard mode). */
export function shareScore(entry) {
  const score = entry.status === 'won' ? `${entry.attempts.length}/${MAX_ATTEMPTS}` : `X/${MAX_ATTEMPTS}`;
  return entry.hardMode ? `${score}*` : score;
}
