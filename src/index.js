import 'dotenv/config';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { Client, Events } from '@fluxerjs/core';
import { DailyGameManager } from './game.js';
import { ANSWER_TIMEZONE, getTodayKey, puzzleNumber } from './daily.js';
import { recordResult, getStats, getHardMode, setHardMode, renderDistribution } from './stats.js';
import {
  MAX_ATTEMPTS,
  WORD_LENGTH,
  renderBoard,
  renderKeyboard,
  shareGrid,
  shareScore,
} from './wordle.js';

const TOKEN = process.env.FLUXER_BOT_TOKEN;
const PUZZLES_CHANNEL_ID = process.env.PUZZLES_CHANNEL_ID;
const API_ORIGIN = process.env.FLUXER_API_URL;

function validateEnv() {
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
}

const GUESS_RE = /^[a-zA-Z]{5}$/;

function helpText() {
  return [
    '**Wordle** — everyone in the server guesses the same secret 5-letter word each day, 6 tries each.',
    '`!wordle` — start (or resume) today\'s word',
    '`!wordle end` — give up on today\'s word (I\'ll DM you the answer)',
    '`!wordle hard` — toggle hard mode (revealed hints must be reused, like the NYT app)',
    '`!wordle stats` — I\'ll DM you your win rate, streak, and guess distribution',
    '`!wordle leaderboard` — see who has finished today\'s word so far',
    '`!wordle answer` — DM today\'s answer (only after you\'ve finished today\'s puzzle)',
    '`!wordle help` — show this message',
    "Once you've started today's puzzle, just type any 5-letter word in this channel to guess.",
    `The word resets once a day (midnight ${ANSWER_TIMEZONE}) — each player gets one attempt at it per day.`,
    '🟩 = right letter, right spot · 🟨 = right letter, wrong spot · ⬛ = not in the word',
    'Your guess message is deleted right away and I only show the colored squares — nobody else can see exactly what you typed, and I never say the word in the channel. The answer goes to your DMs once you finish.',
  ].join('\n');
}

function resultLabel(entry) {
  if (entry.status === 'won') return 'You solved it! ✅';
  if (entry.status === 'gaveup') return 'You gave up.';
  return "You didn't get it. ❌";
}

/** Today's puzzle number, in the NYT app's Wordle numbering. */
function todayPuzzleNo() {
  return puzzleNumber(getTodayKey());
}

/**
 * DM a player. Returns false when the DM can't be delivered (e.g. DMs
 * from server members are disabled) so the caller can tell them in-channel.
 */
async function dm(user, text) {
  try {
    await user.send(text);
    return true;
  } catch (err) {
    console.error(`Could not DM ${user.id}:`, err.message);
    return false;
  }
}

/**
 * Send the player their end-of-game DM: the answer, their full board, and
 * the NYT-style spoiler-free share text they can copy anywhere.
 */
async function sendResultDM(user, entry) {
  const no = todayPuzzleNo();
  const text =
    `**Today's word was \`${entry.answer.toUpperCase()}\`** — Wordle #${no.toLocaleString()}\n` +
    `\n${renderBoard(entry)}\n\n${renderKeyboard(entry.attempts)}\n` +
    `\n${entry.status === 'won' ? `Solved in ${entry.attempts.length}/${MAX_ATTEMPTS}${entry.hardMode ? ' (hard mode)' : ''}` : entry.status === 'gaveup' ? 'Gave up' : 'Out of guesses'}\n` +
    `\nShare your result (spoiler-free):\n\`\`\`\nWordle #${no.toLocaleString()} ${shareScore(entry)}\n${shareGrid(entry.attempts)}\n\`\`\``;
  return dm(user, text);
}

function boardWithKeyboard(entry) {
  return `**Your guesses**\n${renderBoard(entry)}\n\n${renderKeyboard(entry.attempts)}`;
}

/**
 * Handle one incoming message. Exported so the command/guess flow can be
 * exercised without a live Fluxer connection (see test/handler.test.mjs).
 */
export async function handleMessage(message, games) {
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
            `${resultLabel(existing)}\n${renderBoard(existing)}\n` +
              `You've used today's attempt. Come back after midnight ${ANSWER_TIMEZONE} for a new word, ` +
              'or check `!wordle leaderboard`.'
          );
          return;
        }
        await message.reply(
          `You're already on today's word (${existing.attempts.length}/${MAX_ATTEMPTS} guesses used).\n` +
            `${boardWithKeyboard(existing)}\n` +
            'Type a 5-letter guess, or `!wordle end` to give up.'
        );
        return;
      }
      const hard = getHardMode(userId);
      games.start(userId);
      await message.reply(
        `**Daily puzzle #${todayPuzzleNo().toLocaleString()}!** Everyone in the server is guessing the same secret ${WORD_LENGTH}-letter word today. ` +
          `You have ${MAX_ATTEMPTS} tries — just type a 5-letter word in this channel. \`${hard ? 'Hard mode is ON — revealed hints must be reused. ' : ''}!wordle help\` for the rules.`
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
      const dmOk = await sendResultDM(message.author, entry);
      await message.reply(
        `Gave up on today's word.\n${renderBoard(entry)}\n` +
          (dmOk ? "I DM'd you the answer — no spoilers here." : "I couldn't DM you the answer — enable DMs from server members, then run `!wordle answer`.")
      );
      return;
    }

    if (lower === '!wordle hard' || lower === '!wordle hardmode') {
      const on = setHardMode(userId, !getHardMode(userId));
      const entry = games.get(userId);
      const inProgress = entry && entry.status === 'playing';
      await message.reply(
        on
          ? `Hard mode **ON** — like the NYT app, revealed hints (🟩 and 🟨) must be reused in later guesses.${inProgress ? " Today's puzzle already started, so it kicks in tomorrow." : ''}`
          : `Hard mode **off**.${inProgress ? " Today's puzzle already started, so it stays on for today." : ''}`
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
            e.status === 'won'
              ? `${e.attempts.length}/${MAX_ATTEMPTS}${e.hardMode ? '*' : ''}`
              : e.status === 'gaveup'
                ? 'gave up'
                : `X/${MAX_ATTEMPTS}`;
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
      await message.reply(`**Today's leaderboard (Wordle #${todayPuzzleNo().toLocaleString()})**\n${lines.join('\n')}`);
      return;
    }

    if (lower === '!wordle stats') {
      const s = getStats(userId);
      const winRate = s.played ? Math.round((s.won / s.played) * 100) : 0;
      const dmOk = await dm(
        message.author,
        '**Your Wordle stats**\n' +
          `Played: ${s.played} · Won: ${s.won} (${winRate}%)\n` +
          `Current streak: ${s.currentStreak} · Best streak: ${s.maxStreak}\n` +
          `Hard mode: ${s.hardMode ? 'on' : 'off'}\n` +
          `\n**Guess distribution**\n\`\`\`\n${renderDistribution(s)}\n\`\`\``
      );
      await message.reply(
        dmOk ? 'Sent your stats via DM.' : "I couldn't DM you — enable DMs from server members and try again."
      );
      return;
    }

    if (lower === '!wordle answer') {
      const entry = games.get(userId);
      if (!entry) {
        await message.reply("Start today's puzzle first with `!wordle`.");
        return;
      }
      if (entry.status === 'playing') {
        await message.reply("No cheating — finish today's puzzle (or `!wordle end`) and I'll DM you the answer.");
        return;
      }
      const dmOk = await dm(
        message.author,
        `Today's word was \`${entry.answer.toUpperCase()}\` — Wordle #${todayPuzzleNo().toLocaleString()}`
      );
      await message.reply(
        dmOk ? "I DM'd you today's answer." : "I couldn't DM you — enable DMs from server members and try again."
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
    if (outcome.status === 'hard-mode') {
      await message.send(
        `Hard mode is on — your guess must use the hints you've revealed:\n` +
          `- ${outcome.issues.join('\n- ')}\n` +
          'Turn it off with `!wordle hard` (applies from tomorrow).'
      );
      return;
    }

    const { entry, status } = outcome;
    const username = message.author.username || userId;
    const no = todayPuzzleNo().toLocaleString();

    if (status === 'win') {
      const s = recordResult(userId, true, entry.attempts.length);
      const dmOk = await sendResultDM(message.author, entry);
      await message.send(
        `${renderBoard(entry)}\n\n🎉 ${username} solved Wordle #${no} in ${entry.attempts.length}/${MAX_ATTEMPTS}${entry.hardMode ? '*' : ''}! ` +
          `Current streak: ${s.currentStreak} · \`${dmOk ? "answer DM'd" : 'DM failed'}\` · \`!wordle leaderboard\` for today's standings.`
      );
      return;
    }

    if (status === 'lose') {
      recordResult(userId, false, entry.attempts.length);
      const dmOk = await sendResultDM(message.author, entry);
      await message.send(
        `${renderBoard(entry)}\n\n${username} is out of guesses on Wordle #${no}. ` +
          `${dmOk ? 'The answer is in your DMs.' : "I couldn't DM you the answer — enable DMs from server members, then run `!wordle answer`."} Try again tomorrow!`
      );
      return;
    }

    await message.send(
      `${boardWithKeyboard(entry)}\n\n${MAX_ATTEMPTS - entry.attempts.length} guess(es) left.`
    );
  } catch (err) {
    console.error('Error handling message:', err);
  }
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

  const games = new DailyGameManager();

  client.on(Events.Ready, () => {
    ready = true;
    console.log(`Wordle Bot logged in as ${client.user.username}#${client.user.discriminator}`);
    console.log(`Watching channel ${PUZZLES_CHANNEL_ID} for games.`);
  });

  client.on(Events.Error, (err) => {
    console.error('Client error:', err);
  });

  client.on(Events.MessageCreate, (message) => handleMessage(message, games));

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

// Only auto-start when run directly (node src/index.js) — not when imported
// by tests.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  validateEnv();
  main().catch((err) => {
    console.error('Failed to start Wordle Bot:', err);
    process.exit(1);
  });
}
