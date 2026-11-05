import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'wordle-outage-'));
process.env.NYT_CACHE_FILE = join(dir, 'nyt.json');
process.env.DAILY_FILE = join(dir, 'daily.json');
process.env.STATS_FILE = join(dir, 'stats.json');
process.env.PUZZLES_CHANNEL_ID = 'test-channel';
globalThis.fetch = async () => { throw Error('offline'); };
const { handleMessage } = await import('../src/index.js');
const { DailyGameManager } = await import('../src/game.js');
const games = new DailyGameManager();
const sent = [];
await handleMessage({
  author: { id: 'offline-user', bot: false, username: '@everyone' },
  channelId: 'test-channel',
  content: '!wordle',
  reply: async (payload) => sent.push(payload),
}, games);
assert.equal(sent.length, 1);
assert.match(sent[0].content, /won't substitute a different word/);
assert.equal(sent[0].flags, 4096);
assert.deepEqual(sent[0].allowedMentions.parse, []);
assert.equal(sent[0].allowedMentions.repliedUser, false);
assert.equal(games.get('offline-user'), null);
console.log('ok  : source outage creates no game and sends only a silent explanation\n\nALL PASS');
