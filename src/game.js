import { evaluateGuess, WORD_LENGTH, MAX_ATTEMPTS } from './wordle.js';
import { pickRandomAnswer, VALID_GUESSES } from './words.js';

/**
 * Tracks one active Wordle game per (channel, user) pair. Games live only
 * in memory — a bot restart clears in-progress games, but recorded stats
 * (stats.js) persist to disk separately.
 */
export class GameManager {
  constructor() {
    this.games = new Map();
  }

  key(channelId, userId) {
    return `${channelId}:${userId}`;
  }

  get(channelId, userId) {
    return this.games.get(this.key(channelId, userId));
  }

  start(channelId, userId) {
    const game = {
      answer: pickRandomAnswer(),
      attempts: [], // { word, result }
      startedAt: Date.now(),
    };
    this.games.set(this.key(channelId, userId), game);
    return game;
  }

  end(channelId, userId) {
    const key = this.key(channelId, userId);
    const game = this.games.get(key);
    this.games.delete(key);
    return game;
  }

  /**
   * Submit a guess for the active game.
   * Returns { status: 'no-game' | 'invalid-word' }
   *      or { status: 'win' | 'lose' | 'continue', game, word, result }
   */
  guess(channelId, userId, rawWord) {
    const key = this.key(channelId, userId);
    const game = this.games.get(key);
    if (!game) return { status: 'no-game' };

    const word = rawWord.toLowerCase();
    if (word.length !== WORD_LENGTH || !VALID_GUESSES.has(word)) {
      return { status: 'invalid-word' };
    }

    const result = evaluateGuess(word, game.answer);
    game.attempts.push({ word, result });

    const won = word === game.answer;
    const outOfTries = game.attempts.length >= MAX_ATTEMPTS;

    if (won || outOfTries) {
      this.games.delete(key);
    }

    return {
      status: won ? 'win' : outOfTries ? 'lose' : 'continue',
      game,
      word,
      result,
    };
  }
}
