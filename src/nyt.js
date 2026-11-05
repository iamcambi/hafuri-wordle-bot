import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_CACHE = fileURLToPath(new URL('../data/nyt-puzzles.json', import.meta.url));
const EPOCH = Date.UTC(2021, 5, 19);

export class DailyPuzzleUnavailableError extends Error {
  constructor() {
    super("I couldn't load NYT's puzzle for today. Please try again shortly; I won't substitute a different word.");
    this.name = 'DailyPuzzleUnavailableError';
  }
}

function validDate(dateKey) {
  const timestamp = Date.parse(`${dateKey}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(dateKey) && Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString().slice(0, 10) === dateKey;
}

function validPuzzle(puzzle, dateKey) {
  return puzzle?.print_date === dateKey &&
    /^[a-z]{5}$/i.test(puzzle.solution || '') &&
    Number.isSafeInteger(puzzle.days_since_launch) &&
    puzzle.days_since_launch === (Date.parse(`${dateKey}T00:00:00Z`) - EPOCH) / 86400000;
}

/**
 * Only NYT's dated puzzle endpoint can supply an answer. Validated answers
 * are pinned to their date and persisted so restarts don't require the network.
 * There is deliberately no local-word-list fallback.
 */
export function createNytProvider({
  cacheFile = process.env.NYT_CACHE_FILE || DEFAULT_CACHE,
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  const cache = new Map();
  const pending = new Map();
  if (existsSync(cacheFile)) {
    try {
      for (const [dateKey, puzzle] of Object.entries(JSON.parse(readFileSync(cacheFile, 'utf8')))) {
        if (validDate(dateKey) && validPuzzle(puzzle, dateKey)) cache.set(dateKey, puzzle);
      }
    } catch {
      console.warn('NYT puzzle cache could not be read; an official response will be required.');
    }
  }

  function getPuzzle(dateKey) {
    if (!validDate(dateKey) || !cache.has(dateKey)) throw new DailyPuzzleUnavailableError();
    return { ...cache.get(dateKey) };
  }

  function ensurePuzzle(dateKey) {
    if (!validDate(dateKey)) return Promise.reject(new DailyPuzzleUnavailableError());
    if (cache.has(dateKey)) return Promise.resolve(getPuzzle(dateKey));
    if (pending.has(dateKey)) return pending.get(dateKey);
    const operation = (async () => {
      try {
        const response = await fetchImpl(`https://www.nytimes.com/svc/wordle/v2/${dateKey}.json`, {
          signal: AbortSignal.timeout(8000),
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) throw new DailyPuzzleUnavailableError();
        const data = await response.json();
        if (!validPuzzle(data, dateKey)) throw new DailyPuzzleUnavailableError();
        const puzzle = {
          print_date: data.print_date,
          days_since_launch: data.days_since_launch,
          solution: data.solution.toLowerCase(),
          source: 'nyt',
        };
        const next = new Map(cache);
        next.set(dateKey, puzzle);
        const keys = [...next.keys()].sort().slice(-14);
        const retained = Object.fromEntries(keys.map((key) => [key, next.get(key)]));
        mkdirSync(dirname(cacheFile), { recursive: true });
        writeFileSync(`${cacheFile}.tmp`, JSON.stringify(retained, null, 2), { mode: 0o600 });
        renameSync(`${cacheFile}.tmp`, cacheFile);
        // Commit in-memory only after the durable write succeeds.
        cache.clear();
        for (const [key, value] of Object.entries(retained)) cache.set(key, value);
        return getPuzzle(dateKey);
      } catch {
        throw new DailyPuzzleUnavailableError();
      } finally {
        pending.delete(dateKey);
      }
    })();
    pending.set(dateKey, operation);
    return operation;
  }

  return { getPuzzle, ensurePuzzle };
}

const provider = createNytProvider();
export const getCachedNytPuzzle = provider.getPuzzle;
export const ensureNytPuzzle = provider.ensurePuzzle;
