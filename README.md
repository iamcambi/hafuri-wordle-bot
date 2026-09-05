# Hafuri Wordle Bot

A self-hosted Wordle game bot for the **hafuri lofi** Fluxer community, scoped
to the **#puzzles** channel. Built on [`@fluxerjs/core`](https://fluxerjs.blstmo.com).

## What it does

- `!wordle` — starts a new game for you in #puzzles (one active game per player)
- Type any 5-letter word in #puzzles while a game is running — it's treated as a guess
- `!wordle end` — gives up and reveals the answer
- `!wordle stats` — shows your played/won/streak record
- `!wordle help` — shows the command list in-channel
- 🟩 / 🟨 / ⬛ tile feedback, exactly like the original Wordle
- Per-user stats (played, won, current streak, best streak, guess distribution)
  persist to `data/stats.json` across restarts

The bot only reads/reacts to messages in the configured #puzzles channel — it
ignores every other channel and never needs elevated permissions (it holds
only View Channel + Send Messages + Read Message History on the Fluxer side).

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

   `./data` is mounted as a volume, so `stats.json` survives rebuilds and
   restarts.

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
| `HEALTH_PORT` | Optional. Port for a plain HTTP health endpoint (`200` once logged in, `503` before). Used by the Docker healthcheck. Leave unset to disable it. |

**Never commit `.env`** — it holds a live bot token. `.gitignore` already
excludes it.

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
  index.js   — bot entry point, command handling, health server
  game.js    — per-channel/user in-memory game state
  wordle.js  — guess evaluation + tile rendering
  words.js   — answer/valid-guess word lists
  stats.js   — persistent per-user stats (data/stats.json)
data/
  answers.txt   — possible secret words
  guesses.txt   — additional accepted guesses
  stats.json    — per-user stats (created/updated at runtime)
```
