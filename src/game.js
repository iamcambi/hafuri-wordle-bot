import { evaluateGuess, WORD_LENGTH, MAX_ATTEMPTS } from './wordle.js';
import { VALID_GUESSES } from './words.js';
import { getTodayKey, getDailyAnswer } from './daily.js';
import { getPlayerEntry, savePlayerEntry, getLeaderboard } from './dailyStore.js';

/**
 * Manages the single shared daily Wordle puzzle. Every player is guessing
 * the *same* secret word on a given calendar day (see daily.js for how
 * "today" and the word are derived) -- this class only tracks each
 * player's own attempts against that shared word, and persists them to
 * disk (dailyStore.js) so progress survives bot restarts and a player
 * can't get a fresh word by re-running `!wordle`.
 */
export class DailyGameManager {
  todayKey() {
    return getTodayKey();
  }

  /** Existing entry for the player today, or null if they haven't started yet. */
  get(userId) {
    return getPlayerEntry(this.todayKey(), userId);
  }

  /** Start (or resume) today's puzzle for a player. */
  start(userId) {
    const dateKey = this.todayKey();
    const existing = getPlayerEntry(dateKey, userId);
    if (existing) return existing;

    const entry = {
      answer: getDailyAnswer(dateKey),
      attempts: [],
      status: 'playing', // 'playing' | 'won' | 'lost' | 'gaveup'
      startedAt: Date.now(),
      completedAt: null,
    };
    savePlayerEntry(dateKey, userId, entry);
    return entry;
  }

  /** Give up on today's puzzle. Returns the now-completed entry, or null if there's nothing active. */
  giveUp(userId) {
    const dateKey = this.todayKey();
    const entry = getPlayerEntry(dateKey, userId);
    if (!entry || entry.status !== 'playing') return null;
    entry.status = 'gaveup';
    entry.completedAt = Date.now();
    savePlayerEntry(dateKey, userId, entry);
    return entry;
  }

  /**
   * Submit a guess against today's shared word.
   * Returns { status: 'no-game' | 'already-done' | 'invalid-word', entry? }
   *      or { status: 'win' | 'lose' | 'continue', entry, word, result }
   */
  guess(userId, rawWord) {
    const dateKey = this.todayKey();
    const entry = getPlayerEntry(dateKey, userId);
    if (!entry) return { status: 'no-game' };
    if (entry.status !== 'playing') return { status: 'already-done', entry };

    const word = rawWord.toLowerCase();
    if (word.length !== WORD_LENGTH || !VALID_GUESSES.has(word)) {
      return { status: 'invalid-word' };
    }

    const result = evaluateGuess(word, entry.answer);
    entry.attempts.push({ word, result });

    const won = word === entry.answer;
    const outOfTries = entry.attempts.length >= MAX_ATTEMPTS;

    if (won || outOfTries) {
      entry.status = won ? 'won' : 'lost';
      entry.completedAt = Date.now();
    }
    savePlayerEntry(dateKey, userId, entry);

    return {
      status: won ? 'win' : outOfTries ? 'lose' : 'continue',
      entry,
      word,
      result,
    };
  }

  /** Everyone who has finished today's word so far, best result first. */
  leaderboardToday() {
    return getLeaderboard(this.todayKey());
  }
}
