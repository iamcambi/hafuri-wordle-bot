import 'dotenv/config';
import { createServer } from 'node:http';
import { Client, Events } from '@fluxerjs/core';
import { DailyGameManager } from './game.js';
import { ANSWER_TIMEZONE } from './daily.js';
import { recordResult, getStats } from './stats.js';
import { MAX_ATTEMPTS, WORD_LENGTH, renderTiles } from './wordle.js';

const TOKEN = process.env.FLUXER_BOT_TOKEN;
const PUZZLES_CHANNEL_ID = process.env.PUZZLES_CHANNEL_ID;
const API_ORIGIN = process.env.FLUXER_API_URL;

if (!TOKEN) {
  console.error('Missing FLUXER_BOT_TOKEN in environment. Copy .env.example to .env and fill it in.');
  process.exit(1);
}
if (!PUZZLES_CHANNEL_ID) {
  console.error('Missing PUZZLES_CHANNEL_ID in environment.');
  process.exit(1);
}
if (!API_ORIGIN) {
  console.error('Missing FLUXER_API_URL in environment (instance discovery origin).');
  process.exit(1);
}

const games = new DailyGameManager();

const GUESS_RE = /^[a-zA-Z]{5}$/;

function helpText() {
  return [
    '**Wordle** — everyone in the server guesses the same secret 5-letter word each day, 6 tries each.',
    '`!wordle` — start (or resume) today\'s word',
    '`!wordle end` — give up on today\'s word and reveal the answer',
    '`!wordle stats` — see your all-time win rate and streak',
    '`!wordle leaderboard` — see who has finished today\'s word so far',
    '`!wordle help` — show this message',
    "Once you've started today's puzzle, just type any 5-letter word in this channel to guess.",
    `The word resets once a day (midnight ${ANSWER_TIMEZONE}) — each player gets one attempt at it per day.`,
    '🟩 = right letter, right spot · 🟨 = right letter, wrong spot · ⬛ = not in the word',
    'Your guess message is deleted right away and I only show the colored squares — nobody else can see exactly what you typed, and I never say the word out loud in the channel.',
  ].join('\n');
}

function boardText(entry) {
  if (!entry.attempts.length) return '_No guesses made._';
  return entry.attempts.map((a) => renderTiles(a.result)).join('\n');
}

function resultLabel(entry) {
  if (entry.status === 'won') return 'You solved it! ✅';
  if (entry.status === 'gaveup') return 'You gave up.';
  return "You didn't get it. ❌";
}

async function main() {
  let ready = false;

  // Minimal health endpoint for container/orchestrator liveness checks
  // (e.g. `docker-compose` healthcheck, or process managers). Not required
  // for the bot itself to function -- disable by leaving HEALTH_PORT unset.
  const healthPort = process.env.HEALTH_PORT;
  if (healthPort) {
    createServer((req, res) => {
      res.writeHead(ready ? 200 : 503, { 'Content-Type': 'text/plain' });
      res.end(ready ? 'ok' : 'starting');
    }).listen(Number(healthPort), () => {
      console.log(`Health check listening on port ${healthPort}`);
    });
  }

  // Some self-hosted / canary Fluxer instances expose a browser-only,
  // CSRF-guarded `api` endpoint (proxied through the webapp) that rejects
  // plain server-to-server requests with "Invalid API origin". Bots should
  // always talk to `api_public` instead, so fetch discovery ourselves and
  // override `api` before constructing the client.
  const discoveryRes = await fetch(`${API_ORIGIN.replace(/\/+$/, '')}/.well-known/fluxer`);
  if (!discoveryRes.ok) {
    throw new Error(`Instance discovery failed: HTTP ${discoveryRes.status}`);
  }
  const discovery = await discoveryRes.json();
  const endpoints = { ...discovery.endpoints, api: discovery.endpoints.api_public };

  const client = new Client({
    instance: endpoints,
    logLevel: 'info',
  });

  client.on(Events.Ready, () => {
    ready = true;
    console.log(`Wordle Bot logged in as ${client.user.username}#${client.user.discriminator}`);
    console.log(`Watching channel ${PUZZLES_CHANNEL_ID} for games.`);
  });

  client.on(Events.Error, (err) => {
    console.error('Client error:', err);
  });

  client.on(Events.MessageCreate, async (message) => {
    try {
      if (message.author.bot) return;
      if (message.channelId !== PUZZLES_CHANNEL_ID) return;

      const userId = message.author.id;
      const content = message.content.trim();
      const lower = content.toLowerCase();

      if (lower === '!wordle' || lower === '!wordle start') {
        const existing = games.get(userId);
        if (existing) {
          if (existing.status !== 'playing') {
            await message.reply(
              `${resultLabel(existing)}\n${boardText(existing)}\n` +
                `You've used today's attempt. Come back after midnight ${ANSWER_TIMEZONE} for a new word, ` +
                'or check `!wordle leaderboard`.'
            );
            return;
          }
          await message.reply(
            `You're already on today's word (${existing.attempts.length}/${MAX_ATTEMPTS} guesses used).\n` +
              `${boardText(existing)}\n` +
              'Type a 5-letter guess, or `!wordle end` to give up.'
          );
          return;
        }
        games.start(userId);
        await message.reply(
          `New daily puzzle! Everyone in the server is guessing the same secret ${WORD_LENGTH}-letter word today. ` +
            `You have ${MAX_ATTEMPTS} tries — just type a 5-letter word in this channel. \`!wordle help\` for the rules.`
        );
        return;
      }

      if (lower === '!wordle end') {
        const entry = games.giveUp(userId);
        if (!entry) {
          const existing = games.get(userId);
          if (existing) {
            await message.reply("You've already finished today's word — try `!wordle` to see your result.");
          } else {
            await message.reply("You don't have a game running. Start today's with `!wordle`.");
          }
          return;
        }
        recordResult(userId, false, entry.attempts.length);
        await message.reply(
          `Gave up on today's word.\n${boardText(entry)}`
        );
        return;
      }

      if (lower === '!wordle leaderboard' || lower === '!wordle today') {
        const board = games.leaderboardToday();
        if (!board.length) {
          await message.reply("Nobody's finished today's word yet — be the first with `!wordle`!");
          return;
        }
        const lines = await Promise.all(
          board.map(async (e, i) => {
            const tag =
              e.status === 'won' ? `${e.attempts.length}/${MAX_ATTEMPTS}` : e.status === 'gaveup' ? 'gave up' : `X/${MAX_ATTEMPTS}`;
            let name = e.userId;
            try {
              const user = await message.client.users.fetch(e.userId);
              name = user?.username || e.userId;
            } catch {
              // fall back to raw id if we can't resolve the username
            }
            return `${i + 1}. ${name} — ${tag}`;
          })
        );
        await message.reply(`**Today's leaderboard**\n${lines.join('\n')}`);
        return;
      }

      if (lower === '!wordle stats') {
        const s = getStats(userId);
        const winRate = s.played ? Math.round((s.won / s.played) * 100) : 0;
        await message.reply(
          '**Your Wordle stats**\n' +
            `Played: ${s.played} · Won: ${s.won} (${winRate}%)\n` +
            `Current streak: ${s.currentStreak} · Best streak: ${s.maxStreak}`
        );
        return;
      }

      if (lower === '!wordle help') {
        await message.reply(helpText());
        return;
      }

      if (lower.startsWith('!wordle')) {
        await message.reply('Unknown command. Try `!wordle help`.');
        return;
      }

      // Not a command — only treat a plain 5-letter word as a guess if this
      // player has started today's puzzle.
      if (!games.get(userId)) return;
      if (!GUESS_RE.test(content)) return;

      // Scrub the raw guess from the channel immediately, before evaluating
      // or replying, so nobody else ever sees another player's exact input
      // (and never see the answer implied by a winning guess). Requires the
      // bot to have the "Manage Messages" permission in this channel.
      try {
        await message.delete();
      } catch (err) {
        console.error('Could not delete guess message (check Manage Messages permission):', err);
      }

      const outcome = games.guess(userId, content);

      if (outcome.status === 'invalid-word') {
        await message.send("That's not a word I recognize. Try another 5-letter guess.");
        return;
      }
      if (outcome.status === 'no-game') return;
      if (outcome.status === 'already-done') {
        await message.send("You've already finished today's word — try `!wordle` to see your result, or `!wordle leaderboard`.");
        return;
      }

      const { entry, result, status } = outcome;
      const tiles = renderTiles(result);
      const username = message.author.username || userId;

      if (status === 'win') {
        const s = recordResult(userId, true, entry.attempts.length);
        await message.send(
          `${tiles}\n\n🎉 ${username} solved today's word in ${entry.attempts.length}/${MAX_ATTEMPTS}! ` +
            `Current streak: ${s.currentStreak} · \`!wordle leaderboard\` for today's standings.`
        );
        return;
      }

      if (status === 'lose') {
        recordResult(userId, false, entry.attempts.length);
        await message.send(
          `${tiles}\n\n${username} is out of guesses today. Try again tomorrow!`
        );
        return;
      }

      await message.send(`${tiles}\n${MAX_ATTEMPTS - entry.attempts.length} guess(es) left.`);
    } catch (err) {
      console.error('Error handling message:', err);
    }
  });

  const shutdown = async () => {
    console.log('Shutting down Wordle Bot...');
    try {
      await client.destroy();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await client.login(TOKEN);
}

main().catch((err) => {
  console.error('Failed to start Wordle Bot:', err);
  process.exit(1);
});
