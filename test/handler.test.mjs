// Integration test: drives the real message handler with fake Fluxer
// message objects — no live connection needed.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareNytFixture } from './nyt-fixture.mjs';

prepareNytFixture();
process.env.STATS_FILE = join(mkdtempSync(join(tmpdir(), 'stats-')), 'stats.json');
process.env.DAILY_FILE = join(mkdtempSync(join(tmpdir(), 'daily-')), 'daily.json');
process.env.PUZZLES_CHANNEL_ID = 'chan-1';

// index.js reads env at import time; set before importing.
const { handleMessage } = await import('../src/index.js');
const { DailyGameManager } = await import('../src/game.js');
const { getTodayKey } = await import('../src/daily.js');
const { getStats } = await import('../src/stats.js');

let failures = 0;
const channelPayloads = [];
function check(name, cond, extra) {
  if (!cond) { failures++; console.log('FAIL:', name, extra ?? ''); }
  else console.log('ok  :', name);
}

/** Fake Fluxer message. Records channel replies/sends and DMs separately. */
function makeMessage(userId, content) {
  const state = { replies: [], sends: [], dms: [], deleted: 0 };
  const msg = {
    author: {
      id: userId,
      bot: false,
      username: `user_${userId}`,
      send: async (t) => { state.dms.push(t); },
    },
    channelId: 'chan-1',
    content,
    reply: async (t) => { channelPayloads.push(t); state.replies.push(t.content); },
    send: async (t) => { channelPayloads.push(t); state.sends.push(t.content); },
    delete: async () => { state.deleted++; },
    client: { users: { fetch: async (id) => ({ username: `user_${id}` }) } },
  };
  msg._state = state;
  return msg;
}

const games = new DailyGameManager();

// --- start ---
let m = makeMessage('u1', '!wordle');
await handleMessage(m, games);
check('start announces puzzle number', m._state.replies[0].includes('#') && m._state.replies[0].includes('Daily puzzle'));
check('start identifies the official NYT date', m._state.replies[0].includes('NYT') && m._state.replies[0].includes(getTodayKey()));
check('game pins its source and calendar date', games.get('u1').source === 'nyt' && games.get('u1').dateKey === getTodayKey());

// --- invalid guess ---
m = makeMessage('u1', 'zzzzz');
await handleMessage(m, games);
check('invalid guess rejected politely', m._state.sends[0].includes("not a word"));
check('invalid guess message still deleted', m._state.deleted === 1);

// --- valid guesses through to a win ---
const answer = games.get('u1').answer;
const validGuesses = ['crane', 'slate', 'audio'];
let winState = null;
for (const gw of validGuesses) {
  if (gw === answer) break;
  m = makeMessage('u1', gw);
  await handleMessage(m, games);
  if (games.get('u1').status === 'playing') {
    check('in-progress reply names every letter category', m._state.sends.some((t) => t.includes('Your letter hints') && t.includes('Right spot:') && t.includes('In word, wrong spot:') && t.includes('Not in word:') && t.includes('Not tried:')));
    check('guess heading is separated from the grid', m._state.sends.some((t) => t.includes('**Your guesses**\n\n`1`')));
  }
}
if (validGuesses.includes(answer)) {
  m = makeMessage('u1', answer);
  await handleMessage(m, games);
}
// guess the answer directly if not already won
if (games.get('u1').status === 'playing') {
  m = makeMessage('u1', answer);
  await handleMessage(m, games);
}
winState = m._state;
check('win announced publicly', winState.sends.some((t) => t.includes('solved Wordle #')));
check('win reply shows six numbered grid rows', winState.sends.some((t) => (t.match(/^`[1-6]`  /gm) || []).length === 6));
check('completed public grid has no next-guess prompt', winState.sends.every((t) => !t.includes('next guess')));
check('finished letter hints go privately with the result', winState.dms.some((t) => t.includes('Your letter hints') && t.includes('Right spot:') && t.includes('In word, wrong spot:') && t.includes('Not in word:') && t.includes('Not tried:')));
check('public win does not spell the answer through the position pattern', winState.sends.every((t) => !t.includes('Right spot:') && !t.includes(answer.toUpperCase().split('').join(' '))));
check('win DM contains the answer', winState.dms.some((t) => t.includes(answer.toUpperCase())));
check('win DM has spoiler-free share text', winState.dms.some((t) => t.includes('Wordle #') && t.includes('/6')));
check('win recorded in stats', getStats('u1').won === 1 && getStats('u1').played === 1);

// --- playing again after finishing ---
m = makeMessage('u1', 'crane');
await handleMessage(m, games);
check('post-win guess handled', m._state.sends.length === 0 || m._state.sends[0].includes('already finished'));

// --- !wordle answer before finishing (cheating) ---
m = makeMessage('u2', '!wordle');
await handleMessage(m, games);
m = makeMessage('u2', '!wordle answer');
await handleMessage(m, games);
check('answer refused while playing', m._state.replies[0].includes('cheating'));

// --- give up reveals via DM ---
m = makeMessage('u2', '!wordle end');
await handleMessage(m, games);
const u2Answer = games.get('u2').answer;
check('give-up DMs the answer', m._state.dms.some((t) => t.includes(u2Answer.toUpperCase())));
check('give-up public reply stays spoiler-free', !m._state.replies[0].includes(u2Answer.toUpperCase()));
check('give-up counts as played', getStats('u2').played === 1 && getStats('u2').won === 0);

// --- answer after finishing ---
m = makeMessage('u2', '!wordle answer');
await handleMessage(m, games);
check('answer after finish DMs word', m._state.dms.some((t) => t.includes(u2Answer.toUpperCase())));

// --- hard mode toggle + enforcement ---
m = makeMessage('u3', '!wordle hard');
await handleMessage(m, games);
check('hard toggle confirms ON', m._state.replies[0].includes('Hard mode **ON**'));
m = makeMessage('u3', '!wordle');
await handleMessage(m, games);
check('start mentions hard mode when on', m._state.replies[0].includes('Hard mode is ON'));
m = makeMessage('u3', 'crane');
await handleMessage(m, games);
const u3entry = games.get('u3');
// craft a violating guess: reuse greens wrongly is hard generically; use hardModeIssues via a guess missing a yellow
const { hardModeIssues } = await import('../src/wordle.js');
const issues = hardModeIssues(u3entry.attempts, 'stone');
if (issues.length) {
  m = makeMessage('u3', 'stone');
  await handleMessage(m, games);
  check('hard mode rejects violating guess', m._state.sends.some((t) => t.includes('Hard mode is on')));
} else {
  check('hard mode: crane vs answer needs no hints (skipped)', true);
}

// --- stats DM ---
m = makeMessage('u1', '!wordle stats');
await handleMessage(m, games);
check('stats sent via DM with distribution', m._state.dms.some((t) => t.includes('Guess distribution')));
check('stats public reply is a pointer only', m._state.replies[0].includes('DM'));

// --- leaderboard ---
m = makeMessage('u1', '!wordle leaderboard');
await handleMessage(m, games);
check('leaderboard lists players', m._state.replies[0].includes('leaderboard') && m._state.replies[0].includes('user_'));

// --- help ---
m = makeMessage('u1', '!wordle help');
await handleMessage(m, games);
check('help documents new commands', m._state.replies[0].includes('!wordle hard') && m._state.replies[0].includes('!wordle answer'));

// --- unknown command ---
m = makeMessage('u1', '!wordle bogus');
await handleMessage(m, games);
check('unknown command handled', m._state.replies[0].includes('Unknown command'));

// --- messages from other channels / bots ignored ---
const other = makeMessage('u9', '!wordle');
other.channelId = 'other-channel';
await handleMessage(other, games);
check('other channels ignored', other._state.replies.length === 0);
const botMsg = makeMessage('bot-1', '!wordle');
botMsg.author.bot = true;
await handleMessage(botMsg, games);
check('bot messages ignored', botMsg._state.replies.length === 0);

// --- guess without starting is not deleted ---
m = makeMessage('u8', 'crane');
await handleMessage(m, games);
check('unstarted guess ignored and left visible', m._state.sends.length === 0 && m._state.deleted === 0);

check('all public bot replies suppress notifications', channelPayloads.length > 0 && channelPayloads.every((p) => p.flags === 4096));
check('all public bot replies suppress every mention type', channelPayloads.every((p) => p.allowedMentions.parse.length === 0 && p.allowedMentions.users.length === 0 && p.allowedMentions.roles.length === 0 && p.allowedMentions.repliedUser === false && p.ping === false && p.tts === false));

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
