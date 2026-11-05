# Wordle Bot for the hafuri lofi Fluxer community (#puzzles channel)
#
# @fluxerjs/core requires Node >= 22.13.0, so this image is pinned to the
# node:22-alpine base rather than a generic LTS tag.
FROM node:22-alpine

WORKDIR /app

# Install dependencies first so they're cached across code-only rebuilds.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY data/answers.txt data/guesses.txt ./data/

# Persisted stats live under /app/data — mount a host volume here (see
# docker-compose.yml) so wins/streaks survive container restarts/updates.
RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV HEALTH_PORT=8091
EXPOSE 8091

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:' + (process.env.HEALTH_PORT || 8091)).then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "src/index.js"]
