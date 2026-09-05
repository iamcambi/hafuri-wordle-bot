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
