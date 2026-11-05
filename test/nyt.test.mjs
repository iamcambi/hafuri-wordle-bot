import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNytProvider, DailyPuzzleUnavailableError } from '../src/nyt.js';

const day = '2026-11-05';
const nextDay = '2026-11-06';
const path = () => join(mkdtempSync(join(tmpdir(), 'nyt-provider-')), 'puzzles.json');
const puzzle = (date = day) => ({
  print_date: date,
  days_since_launch: (Date.parse(`${date}T00:00:00Z`) - Date.UTC(2021, 5, 19)) / 86400000,
  solution: 'cigar', // synthetic fixture, not a claim about this date's answer
});
const response = (body) => ({ ok: true, json: async () => body });
let count = 0;
async function test(name, run) {
  await run();
  count++;
  console.log(`ok  : ${name}`);
}

await test('fetches the requested NYT date, validates number, and persists a private cache', async () => {
  const cacheFile = path();
  let calls = 0;
  const provider = createNytProvider({ cacheFile, fetchImpl: async (url) => {
    calls++;
    assert.equal(url, `https://www.nytimes.com/svc/wordle/v2/${day}.json`);
    return response(puzzle());
  } });
  const official = await provider.ensurePuzzle(day);
  assert.equal(official.days_since_launch, 1965);
  assert.equal(official.source, 'nyt');
  assert.equal(statSync(cacheFile).mode & 0o777, 0o600);
  official.solution = 'xxxxx';
  assert.equal(provider.getPuzzle(day).solution, 'cigar');
  await provider.ensurePuzzle(day);
  assert.equal(calls, 1);
  assert.equal(JSON.parse(readFileSync(cacheFile, 'utf8'))[day].print_date, day);
  const restarted = createNytProvider({ cacheFile, fetchImpl: async () => { throw Error('offline'); } });
  assert.equal((await restarted.ensurePuzzle(day)).solution, 'cigar');
  await assert.rejects(restarted.ensurePuzzle(nextDay), DailyPuzzleUnavailableError);
});

for (const [name, mutate] of [
  ['wrong date', (p) => ({ ...p, print_date: nextDay })],
  ['wrong puzzle number', (p) => ({ ...p, days_since_launch: 1966 })],
  ['invalid answer', (p) => ({ ...p, solution: 'too-long' })],
  ['missing answer', (p) => ({ ...p, solution: undefined })],
]) {
  await test(`rejects ${name} without substituting a local word`, async () => {
    const provider = createNytProvider({ cacheFile: path(), fetchImpl: async () => response(mutate(puzzle())) });
    await assert.rejects(provider.ensurePuzzle(day), DailyPuzzleUnavailableError);
    assert.throws(() => provider.getPuzzle(day), DailyPuzzleUnavailableError);
  });
}

await test('rejects HTTP failures and retries cleanly after recovery', async () => {
  let up = false;
  const provider = createNytProvider({ cacheFile: path(), fetchImpl: async () => up ? response(puzzle()) : ({ ok: false }) });
  await assert.rejects(provider.ensurePuzzle(day), DailyPuzzleUnavailableError);
  up = true;
  assert.equal((await provider.ensurePuzzle(day)).print_date, day);
});

await test('invalid dates never reach the network', async () => {
  const provider = createNytProvider({ cacheFile: path(), fetchImpl: async () => { assert.fail('unexpected fetch'); } });
  for (const invalid of ['2026-99-05', '2026-02-30', '../secret', '', '2026-1-1']) {
    await assert.rejects(provider.ensurePuzzle(invalid), DailyPuzzleUnavailableError);
  }
});

await test('concurrent starts share one request', async () => {
  let calls = 0;
  const provider = createNytProvider({ cacheFile: path(), fetchImpl: async () => {
    calls++;
    return response(puzzle());
  } });
  await Promise.all([provider.ensurePuzzle(day), provider.ensurePuzzle(day), provider.ensurePuzzle(day)]);
  assert.equal(calls, 1);
});

await test('concurrent dates preserve both durable entries', async () => {
  const cacheFile = path();
  const provider = createNytProvider({ cacheFile, fetchImpl: async (url) => response(puzzle(url.match(/(\d{4}-\d{2}-\d{2})\.json$/)[1])) });
  await Promise.all([provider.ensurePuzzle(day), provider.ensurePuzzle(nextDay)]);
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(cacheFile, 'utf8'))).sort(), [day, nextDay]);
});

await test('corrupted caches require a fresh official response', async () => {
  const cacheFile = path();
  writeFileSync(cacheFile, 'not json');
  const provider = createNytProvider({ cacheFile, fetchImpl: async () => response(puzzle()) });
  assert.equal((await provider.ensurePuzzle(day)).print_date, day);
});

console.log(`\nALL PASS (${count} source tests)`);
