import 'dotenv/config';
import { createServer } from 'node:http';
import { Client, Events } from '@fluxerjs/core';
import { GameManager } from './game.js';
import { recordResult, getStats } from './stats.js';
import { MAX_ATTEMPTS, WORD_LENGTH, renderRow } from './wordle.js';

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

const games = new GameManager();

const GUESS_RE = /^[a-zA-Z]{5}$/;

function helpText() {
  return [
    '**Wordle** — guess the secret 5-letter word in 6 tries.',
    '`!wordle` — start a new game (one active game per player at a time)',
    '`!wordle end` — give up and reveal the answer',
    '`!wordle stats` — see your win rate and streak',
    '`!wordle help` — show this message',
    'Once a game is running, just type any 5-letter word in this channel to guess.',
    '🟩 = right letter, right spot · 🟨 = right letter, wrong spot · ⬛ = not in the word',
  ].join('\n');
}

function boardText(game) {
  if (!game.attempts.length) return '_No guesses made._';
  return game.attempts.map((a) => renderRow(a.word, a.result)).join('\n');
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

      const channelId = message.channelId;
      const userId = message.author.id;
      const content = message.content.trim();
      const lower = content.toLowerCase();

      if (lower === '!wordle' || lower === '!wordle start') {
        const existing = games.get(channelId, userId);
        if (existing) {
          await message.reply(
            `You already have a game running (${existing.attempts.length}/${MAX_ATTEMPTS} guesses used).\n` +
              `${boardText(existing)}\n` +
              'Type a 5-letter guess, or `!wordle end` to give up.'
          );
          return;
        }
        games.start(channelId, userId);
        await message.reply(
          `New game started! Guess the secret ${WORD_LENGTH}-letter word. You have ${MAX_ATTEMPTS} tries — ` +
            'just type a 5-letter word in this channel. `!wordle help` for the rules.'
        );
        return;
      }

      if (lower === '!wordle end') {
        const game = games.end(channelId, userId);
        if (!game) {
          await message.reply("You don't have a game running. Start one with `!wordle`.");
          return;
        }
        await message.reply(
          `Game ended. The word was **${game.answer.toUpperCase()}**.\n${boardText(game)}`
        );
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
      // player currently has a game running in this channel.
      if (!games.get(channelId, userId)) return;
      if (!GUESS_RE.test(content)) return;

      const outcome = games.guess(channelId, userId, content);

      if (outcome.status === 'invalid-word') {
        await message.reply(`"${content.toUpperCase()}" isn't a word I know. Try another guess.`);
        return;
      }
      if (outcome.status === 'no-game') return;

      const { game, word, result, status } = outcome;
      const row = renderRow(word, result);

      if (status === 'win') {
        const s = recordResult(userId, true, game.attempts.length);
        await message.reply(
          `${row}\n\n🎉 Got it in ${game.attempts.length}/${MAX_ATTEMPTS}! The word was **${game.answer.toUpperCase()}**.\n` +
            `Current streak: ${s.currentStreak}`
        );
        return;
      }

      if (status === 'lose') {
        recordResult(userId, false, game.attempts.length);
        await message.reply(
          `${row}\n\nOut of guesses! The word was **${game.answer.toUpperCase()}**. Try again with \`!wordle\`.`
        );
        return;
      }

      await message.reply(`${row}\n${MAX_ATTEMPTS - game.attempts.length} guess(es) left.`);
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
