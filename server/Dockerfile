# The relay as a container. Build context is the REPOSITORY ROOT (the server imports ../shared/protocol.ts):
#   docker build -f server/Dockerfile -t gamerfleet-relay .
#   docker run --rm -p 8787:8787 gamerfleet-relay          # ws://localhost:8787, http://localhost:8787/health
# Hosted platforms (Render, Fly, Railway…) set PORT; the relay listens on it (options.ts: --port, SQUAD_PORT, PORT).
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# tsx (the TypeScript runner) is a dev dependency on purpose: there is no build step for the relay.
COPY server/package.json server/package-lock.json ./server/
RUN npm ci --prefix server --include=dev --no-audit --no-fund
COPY shared ./shared
COPY server ./server
EXPOSE 8787
ENV PORT=8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -qO- "http://127.0.0.1:${PORT}/health" >/dev/null || exit 1
USER node
CMD ["npm", "--prefix", "server", "start", "--", "--host", "0.0.0.0"]
