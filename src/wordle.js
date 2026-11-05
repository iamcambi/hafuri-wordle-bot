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

/**
 * Six numbered rows with separated tiles. A text prefix also prevents chat
 * clients from turning an emoji-only row into oversized, touching tiles.
 * Keep the compact spoiler-free sharing format separate in shareGrid().
 */
export function renderBoard(entry) {
  return Array.from({ length: MAX_ATTEMPTS }, (_, i) => {
    const attempt = entry.attempts[i];
    const tiles = attempt ? attempt.result.map((r) => TILE[r]) : Array(WORD_LENGTH).fill('⬜');
    const next = entry.status === 'playing' && i === entry.attempts.length ? '  ← next guess' : '';
    return `\`${i + 1}\`  ${tiles.join(' ')}${next}`;
  }).join('\n');
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz';
const STATE_RANK = { absent: 1, present: 2, correct: 3 };

/**
 * Name the letters instead of replacing them with anonymous colored squares.
 * Keep the strongest evidence for each letter, especially for duplicate guesses.
 * Only show information learned from guesses, never inspect the answer.
 * Full guessed words remain out of the public board.
 */
export function renderKeyboard(attempts) {
  const state = {};
  const positions = Array(WORD_LENGTH).fill('_');
  for (const a of attempts) {
    a.result.forEach((r, i) => {
      const ch = a.word[i].toLowerCase();
      if (!state[ch] || STATE_RANK[r] > STATE_RANK[state[ch]]) state[ch] = r;
      if (r === 'correct') positions[i] = ch.toUpperCase();
    });
  }
  const letters = (status) =>
    [...ALPHABET]
      .filter((ch) => status === 'unused' ? !state[ch] : state[ch] === status)
      .map((ch) => ch.toUpperCase())
      .join(' ') || (status === 'unused' ? 'none' : 'none yet');
  return [
    '**Your letter hints**',
    `🟩 Right spot: \`${positions.join(' ')}\` (1–5)`,
    `🟨 In word, wrong spot: \`${letters('present')}\``,
    `⬛ Not in word: \`${letters('absent')}\``,
    `Not tried: \`${letters('unused')}\``,
  ].join('\n');
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
