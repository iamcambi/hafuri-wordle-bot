# Hafuri Wordle Bot

A self-hosted, multiplayer daily Wordle bot for the **hafuri lofi** Fluxer
community, with **DM-only gameplay** and a quiet **#puzzles** entry point. Built on
[`@fluxerjs/core`](https://fluxerjs.blstmo.com).

## How it works

Everyone in the server guesses **NYT's actual daily 5-letter word** for the
configured calendar date. The bot uses NYT's dated puzzle endpoint, for example
https://www.nytimes.com/svc/wordle/v2/2026-11-05.json, rather than choosing a
word from its own list. This is an unofficial community bot, not an NYT app.
The word changes once a day at midnight
(configurable timezone, default `America/New_York`), and each player gets one
attempt at it — 6 tries, tracked independently per player.

- `!wordle` — start or resume in a one-to-one DM with Wordle_Bot; in #puzzles,
  this sends the game by DM and posts only a silent pointer
- Send five-letter guesses **only in your DM with Wordle_Bot**, never in #puzzles
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
  (e.g. "Wordle #1,965" on 2026-11-05)
- When you finish (win, lose, or give up), the bot **DMs you the answer**
  together with a spoiler-free share text (`Wordle #1,965 4/6*` + your grid)
- Streaks follow the NYT rule: winning on consecutive days builds a streak;
  skipping a day resets it

### Private, quiet gameplay

- Guesses, grids, named letter hints, errors, answers, and completion results
  stay in the player's one-to-one DM. Playing or finishing creates **no server
  messages**, so those guesses cannot trigger server notifications.
- Starting from #puzzles sends the board privately and posts only a silent
  direction to continue in DMs. Starting directly by DM works too.
- One-to-one DM players must be verified members of the community containing
  #puzzles. Other communities and group DMs are ignored.
- If DMs are blocked, the bot explains how to enable them without creating a
  new game or consuming a guess. Existing game progress is preserved.
- Accidental five-letter guesses in #puzzles are not evaluated or counted.
  The bot tries to remove them and sends a private redirect. Deletion cannot
  undo a notification a player's public message already triggered, so players
  must use DMs to keep their guesses out of server notifications.
- Wins, losses, and give-ups still update shared stats and the daily leaderboard,
  but no automatic finish announcement is posted. Anyone can explicitly request
  `!wordle leaderboard` in #puzzles or in their DM.

Per-user stats (played, won, current streak, best streak, guess distribution)
persist to `data/stats.json` across restarts. Today's shared word and each
player's in-progress attempts persist to `data/daily.json` (kept for the last
14 days, then pruned).

Official answers are validated against the requested date and puzzle number,
then cached privately in `data/nyt-puzzles.json`. The same date reuses its
cached answer across restarts. If neither a valid cache nor the official
endpoint is available, starting a game fails with an explanation; the bot
never substitutes yesterday's word or a randomly selected local answer.

### Quiet public messages

Every public bot reply uses Fluxer's `SUPPRESS_NOTIFICATIONS` flag (`4096`),
disables reply pings, disables all mention types, and disables text-to-speech.
This applies to guess feedback, start/resume messages, results, help, and errors.
See https://docs.fluxer.com/http-api/messages/ for the platform flag.
Player-authored public commands and accidental public posts still follow each
member's own notification settings. Normal guesses are private DMs instead.

The bot only responds in the configured #puzzles channel and verified members'
one-to-one DMs. It ignores every other server channel and group DM. It holds
View Channel, Send Messages, Read Message History, and Manage Messages on the
Fluxer side (the last one is used only to remove accidental public guesses).

## Requirements

- Docker and Docker Compose (recommended — see below), **or**
- Node.js **>= 22.13.0** run directly (`@fluxerjs/core` requires this; older
  LTS releases will not work)

## Quick start (Docker — recommended for long-term hosting)

1. Copy the environment template and fill in your bot's credentials:

   ```sh
   cp .env.example .env
   ```

   Supply your own bot token. Real credentials are not shipped or committed;
   keep `.env` private when moving or backing up the deployment.

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
| `NYT_CACHE_FILE` | Optional. Private official-puzzle cache path (default `data/nyt-puzzles.json`). |
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
  daily.js     — timezone-aware NYT date and zero-based puzzle numbering
  nyt.js       — validated official puzzle fetching and durable date-pinned cache
  notifications.js — silent public messages with all mention types disabled
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
