# Hafuri Wordle Bot

A self-hosted, multiplayer daily Wordle bot for the **hafuri lofi** Fluxer
community, scoped to the **#puzzles** channel. Built on
[`@fluxerjs/core`](https://fluxerjs.blstmo.com).

## How it works

Everyone in the server guesses the **same secret 5-letter word each day** —
just like real-world daily Wordle. The word changes once a day at midnight
(configurable timezone, default `America/New_York`), and each player gets one
attempt at it — 6 tries, tracked independently per player.

- `!wordle` — start (or resume) today's word
- Type any 5-letter word in #puzzles while your game is running — it's your guess
- `!wordle end` — give up on today's word (the answer is DM'd to you)
- `!wordle hard` — toggle hard mode (revealed hints must be reused, like the NYT app)
- `!wordle stats` — your all-time record, streak, and guess distribution (sent via DM)
- `!wordle leaderboard` (or `!wordle today`) — who has finished today's word so far, and in how many guesses
- `!wordle answer` — DM today's answer (only after you've finished today's puzzle)
- `!wordle help` — shows the command list in-channel
- 🟩 / 🟨 / ⬛ tile feedback, exactly like the original Wordle
- Each in-progress reply shows your **full board so far** and **named letter hints**:
  confirmed letters in a five-position pattern, letters in the word but in the
  wrong spot, ruled-out letters, and letters not yet tried. Letters never
  disappear behind anonymous colored keyboard squares.
- The grid has six numbered rows, spaces between tiles, white tiles for unused
  guesses, and a marker on the next row. Copyable result grids stay compact.
- Daily puzzles are numbered with the same numbering as the NYT app
  (e.g. "Wordle #1,966")
- When you finish (win, lose, or give up), the bot **DMs you the answer**
  together with a spoiler-free share text (`Wordle #1,966 4/6*` + your grid)
- Streaks follow the NYT rule: winning on consecutive days builds a streak;
  skipping a day resets it

### Guesses are hidden from other players

Typing a 5-letter word is the only way to guess, but nobody else in the
channel sees your complete guess messages after the bot removes them:

- Your guess message is **deleted immediately** after the bot reads it
  (requires the bot to hold the **Manage Messages** permission in #puzzles).
- The board uses **colored tile squares**, not complete guessed words. During
  play, the named letter hints are visible in the shared channel; other players
  can see these clues. This is not a fully private or spoiler-free play mode.
- Once you win or run out of guesses, letter hints move into the result DM.
  The public completion message omits the letter-position pattern so it does
  not spell out a winning answer.
- The answer itself is only ever sent to the finishing player **via DM**,
  never in the channel. If a DM can't be delivered (DMs from server members
  disabled), the bot says so in-channel and offers `!wordle answer` as a
  retry.
- The public channel only ever announces *that* someone solved it and in how
  many guesses (e.g. "🎉 hafuri solved Wordle #1,966 in 2/6!") — never the word
  itself.

Per-user stats (played, won, current streak, best streak, guess distribution)
persist to `data/stats.json` across restarts. Today's shared word and each
player's in-progress attempts persist to `data/daily.json` (kept for the last
14 days, then pruned).

The bot only reads/reacts to messages in the configured #puzzles channel — it
ignores every other channel. It holds View Channel, Send Messages, Read
Message History, and Manage Messages on the Fluxer side (the last one is
needed solely to delete players' raw guess messages).

## Requirements

- Docker and Docker Compose (recommended — see below), **or**
- Node.js **>= 22.13.0** run directly (`@fluxerjs/core` requires this; older
  LTS releases will not work)

## Quick start (Docker — recommended for long-term hosting)

1. Copy the environment template and fill in your bot's credentials:

   ```sh
   cp .env.example .env
   ```

   The `.env` shipped alongside this README already has the real
   `Wordle_Bot` credentials for hafuri lofi filled in — you can use it as-is
   unless you're rotating the token or moving to a different bot/channel.

2. Build and start the bot in the background:

   ```sh
   docker compose up -d --build
   ```

3. Check it came up healthy:

   ```sh
   docker compose logs -f wordle-bot
   ```

   You should see `Wordle Bot logged in as Wordle_Bot#6644` and `Watching
   channel ... for games.` The bot will then show Online in the hafuri lofi
   member list.

4. To update after pulling new code:

   ```sh
   docker compose up -d --build
   ```

   `./data` is mounted as a volume, so `stats.json` and `daily.json` survive
   rebuilds and restarts.

5. To stop it:

   ```sh
   docker compose down
   ```

## Running without Docker

```sh
npm ci
cp .env.example .env   # fill in real values
node src/index.js
```

Make sure whichever `node` is on your `PATH` is >= 22.13.0 — check with
`node --version`.

## Configuration (`.env`)

| Variable | Description |
|---|---|
| `FLUXER_BOT_TOKEN` | Wordle_Bot's bot token from the Fluxer developer portal |
| `FLUXER_APPLICATION_ID` | Wordle_Bot's application ID |
| `FLUXER_API_URL` | Instance discovery origin, e.g. `https://api.canary.fluxer.app` |
| `PUZZLES_CHANNEL_ID` | Channel ID the bot watches (hafuri lofi's #puzzles) |
| `ANSWER_TIMEZONE` | Optional. IANA timezone used to compute "today" for the shared daily word (default `America/New_York`). |
| `HEALTH_PORT` | Optional. Port for a plain HTTP health endpoint (`200` once logged in, `503` before). Used by the Docker healthcheck. Leave unset to disable it. |

**Never commit `.env`** — it holds a live bot token. `.gitignore` already
excludes it.

## Required bot permission: Manage Messages

Because the bot deletes each player's raw guess message to keep it hidden
from everyone else, its role in the server needs the **Manage Messages**
permission (in addition to View Channel, Send Messages, and Read Message
History). If this permission is ever removed, guesses will still work
correctly, but the raw guess text will stay visible in the channel until
someone manually deletes it — the bot logs a warning in that case instead of
failing the command.

## Notes on the Fluxer API

Fluxer's `.well-known/fluxer` instance-discovery document returns several API
endpoints. The bot deliberately talks to `endpoints.api_public`
(`https://api.canary.fluxer.app`) rather than `endpoints.api`
(`https://web.canary.fluxer.app/api`) — the latter is a browser-session,
CSRF-guarded proxy that rejects direct server-to-server requests with an
"Invalid API origin" error. This override happens automatically in
`src/index.js`; you shouldn't need to touch it unless Fluxer changes its
discovery format.

## Project layout

```
src/
  index.js     — bot entry point, command handling, health server
  daily.js     — deterministic date-seeded shared daily word + puzzle numbering
  dailyStore.js — persistent per-day per-user progress (data/daily.json)
  game.js      — DailyGameManager: shared-word game logic + hard mode
  wordle.js    — guess evaluation, board/keyboard rendering, share text
  words.js     — answer/valid-guess word lists
  stats.js     — persistent per-user all-time stats (data/stats.json)
test/
  logic.test.mjs    — game-engine unit tests (node test/logic.test.mjs)
  handler.test.mjs  — end-to-end command/guess flow tests, no live bot needed
data/
  answers.txt   — possible secret words
  guesses.txt   — additional accepted guesses
  stats.json    — per-user all-time stats (created/updated at runtime)
  daily.json    — today's (and the last 14 days') shared word + player progress (created/updated at runtime)
```
