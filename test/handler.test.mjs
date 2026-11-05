import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareNytFixture } from './nyt-fixture.mjs';

prepareNytFixture();
const dir = mkdtempSync(join(tmpdir(), 'wordle-dm-'));
process.env.STATS_FILE = join(dir, 'stats.json');
process.env.DAILY_FILE = join(dir, 'daily.json');
process.env.PUZZLES_CHANNEL_ID = 'chan-1';
const { handleMessage } = await import('../src/index.js');
const { DailyGameManager } = await import('../src/game.js');
const { getTodayKey } = await import('../src/daily.js');
const { getStats } = await import('../src/stats.js');
const games = new DailyGameManager();
const publicPayloads = [];
let checks = 0;
function check(name, condition) {
  assert.ok(condition, name);
  checks++;
  console.log(`ok  : ${name}`);
}
const text = (payload) => typeof payload === 'string' ? payload : payload.content;
function makeMessage(userId, content, { scope = 'dm', blockedDM = false, member = true, uncached = false } = {}) {
  const state = { replies: [], sends: [], dms: [], deleted: 0, public: [] };
  const privateChannel = scope === 'dm' || scope === 'group';
  const channel = { type: scope === 'group' ? 3 : privateChannel ? 1 : 0, guildId: privateChannel ? null : 'guild-1' };
  const record = (kind, payload) => {
    state[kind].push(text(payload));
    if (!privateChannel) {
      publicPayloads.push(payload);
      state.public.push(payload);
    }
  };
  return {
    author: {
      id: userId, bot: false, username: `user_${userId}`,
      send: async (payload) => {
        if (blockedDM) throw Error('DMs blocked');
        state.dms.push(text(payload));
      },
    },
    guildId: privateChannel ? null : 'guild-1',
    channelId: scope === 'public' ? 'chan-1' : scope === 'other' ? 'other-channel' : `dm-${userId}`,
    channel: uncached ? null : channel,
    resolveChannel: async () => channel,
    content,
    reply: async (payload) => record('replies', payload),
    send: async (payload) => record('sends', payload),
    delete: async () => { state.deleted++; },
    client: {
      channels: { fetch: async () => ({ guildId: 'guild-1' }) },
      guilds: { fetch: async () => ({ members: { fetch: async (id) => member ? { user: { id } } : null } }) },
      users: { fetch: async (id) => ({ username: `user_${id}` }) },
    },
    _state: state,
  };
}
const dispatch = async (userId, content, options) => {
  const message = makeMessage(userId, content, options);
  await handleMessage(message, games);
  return message._state;
};

// Public onboarding is only a silent pointer. The actual board stays private.
let state = await dispatch('u1', '!wordle', { scope: 'public' });
check('public start sends NYT puzzle and full board by DM', state.dms.some((t) => t.includes('Daily puzzle #') && t.includes('NYT') && t.includes(getTodayKey()) && t.includes('Your guesses')));
check('public start directs guesses to DMs without exposing hints', state.replies[0].includes('DM') && !state.replies[0].includes('Your letter hints'));
check('game pins official source and date', games.get('u1').source === 'nyt' && games.get('u1').dateKey === getTodayKey());
check('public start consumes no guesses', games.get('u1').attempts.length === 0);

state = await dispatch('u1', 'crane', { scope: 'public' });
check('accidental public guess is removed but never counted', state.deleted === 1 && games.get('u1').attempts.length === 0);
check('accidental public guess gets only a private redirect', state.public.length === 0 && state.dms[0].includes('not counted'));

state = await dispatch('u1', 'zzzzz');
check('invalid DM guess gets private feedback', state.sends[0].includes('not a word') && state.public.length === 0);
check('DM guesses are not deleted', state.deleted === 0);
const beforeGuesses = publicPayloads.length;
for (const guess of ['crane', 'slate', 'audio']) {
  state = await dispatch('u1', guess);
  check('DM guess returns private spaced grid and named hints', state.sends.some((t) => t.includes('**Your guesses**\n\n`1`') && t.includes('Right spot:') && t.includes('In word, wrong spot:') && t.includes('Not in word:') && t.includes('Not tried:')));
}
const answer = games.get('u1').answer;
state = await dispatch('u1', answer);
check('win and all guesses create zero server messages', publicPayloads.length === beforeGuesses && state.public.length === 0);
check('win DM has answer and six numbered rows', state.dms.some((t) => t.includes(answer.toUpperCase()) && (t.match(/^`[1-6]`  /gm) || []).length === 6));
check('win DM has private letter hints and compact share text', state.dms.some((t) => t.includes('Your letter hints') && t.includes('Share your result') && t.includes('/6')));
check('win records stats once', getStats('u1').won === 1 && getStats('u1').played === 1);
state = await dispatch('u1', answer);
check('post-win DM cannot record a second result', state.sends[0].includes('already finished') && getStats('u1').played === 1);

state = await dispatch('u1', '!wordle', { scope: 'public' });
check('public completed-game resume keeps board private', state.dms.some((t) => t.includes('You solved it')) && state.public.every((p) => !p.content.includes('`1`')));
state = await dispatch('u1', '!wordle answer');
check('answer command stays private and avoids duplicate confirmations', state.dms.some((t) => t.includes(answer.toUpperCase())) && state.replies.length === 0);

state = await dispatch('u2', '!wordle', { uncached: true });
check('member can start directly in an uncached one-to-one DM', state.replies[0].includes('Daily puzzle') && games.get('u2').attempts.length === 0);
state = await dispatch('u2', '!wordle answer');
check('answer is refused before finishing', state.replies[0].includes('No cheating'));
state = await dispatch('u2', '!wordle end');
check('give-up result is private with no duplicate reply', state.dms.some((t) => t.includes('Gave up') && t.includes(games.get('u2').answer.toUpperCase())) && state.replies.length === 0 && state.public.length === 0);
check('give-up counts once', getStats('u2').played === 1 && getStats('u2').won === 0);

await dispatch('u3', '!wordle hard');
state = await dispatch('u3', '!wordle');
check('DM start mentions enabled hard mode', state.replies[0].includes('Hard mode is ON'));
await dispatch('u3', 'crane');
state = await dispatch('u3', 'stone');
check('DM hard mode rejects hint violations privately', state.sends.some((t) => t.includes('Hard mode is on')) && state.public.length === 0 && games.get('u3').attempts.length === 1);
const oldAttempt = structuredClone(games.get('u3').attempts);
state = await dispatch('u3', '!wordle', { scope: 'public' });
check('public-to-DM resume preserves exact progress', JSON.stringify(games.get('u3').attempts) === JSON.stringify(oldAttempt) && state.dms[0].includes('1/6 guesses used'));

state = await dispatch('u1', '!wordle stats', { scope: 'public' });
check('public stats remain a private DM with a silent pointer', state.dms[0].includes('Guess distribution') && state.replies[0].includes('DM'));
state = await dispatch('u1', '!wordle stats');
check('DM stats avoid duplicate confirmations', state.dms[0].includes('Guess distribution') && state.replies.length === 0);
state = await dispatch('u1', '!wordle leaderboard', { scope: 'public' });
check('shared leaderboard is available on explicit request', state.replies[0].includes('leaderboard') && state.replies[0].includes('user_u1'));
state = await dispatch('u1', '!wordle help', { scope: 'public' });
check('help explains DM-only play and no per-guess server posts', state.replies[0].includes('one-to-one DM') && state.replies[0].includes('no per-guess server posts'));

state = await dispatch('blocked', '!wordle', { scope: 'public', blockedDM: true });
check('blocked DMs do not create or consume a game', games.get('blocked') === null && state.replies[0].includes('Enable direct messages'));
state = await dispatch('outsider', '!wordle', { member: false });
check('non-members cannot enter the community puzzle or leaderboard', games.get('outsider') === null && state.replies[0].includes("couldn't verify your membership"));
state = await dispatch('group-user', '!wordle', { scope: 'group' });
check('group DMs are ignored to prevent leaking guesses', games.get('group-user') === null && state.replies.length === 0);
state = await dispatch('other-user', '!wordle', { scope: 'other' });
check('other server channels are ignored', games.get('other-user') === null && state.replies.length === 0);
state = await dispatch('new-user', 'crane');
check('unstarted DM text is not treated as a guess', games.get('new-user') === null && state.deleted === 0 && state.sends.length === 0);
const botMessage = makeMessage('another-bot', '!wordle');
botMessage.author.bot = true;
await handleMessage(botMessage, games);
check('bot messages are ignored', games.get('another-bot') === null);

// Slow async delivery/membership checks must not reorder starts and guesses.
const queued = [
  makeMessage('queue-user', '!wordle', { scope: 'public' }),
  makeMessage('queue-user', 'crane'),
  makeMessage('queue-user', 'slate'),
];
await Promise.all(queued.map((message) => handleMessage(message, games)));
check('rapid start and DM guesses are processed in order', games.get('queue-user').attempts.map((a) => a.word).join(',') === 'crane,slate');

check('all public bot messages suppress notifications', publicPayloads.length > 0 && publicPayloads.every((p) => p.flags === 4096));
check('all public bot messages suppress every mention type', publicPayloads.every((p) => p.allowedMentions.parse.length === 0 && p.allowedMentions.users.length === 0 && p.allowedMentions.roles.length === 0 && p.allowedMentions.repliedUser === false && p.ping === false && p.tts === false));
check('no public message contains grids or letter clues', publicPayloads.every((p) => !p.content.includes('Your guesses') && !p.content.includes('Right spot:') && !p.content.includes('In word, wrong spot:')));
console.log(`\nALL PASS (${checks} DM-flow checks)`);
