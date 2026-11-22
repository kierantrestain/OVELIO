FROM node:22.22.2-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN mkdir -p public && npm run build && npm prune --omit=dev --no-audit --no-fund

FROM base AS runtime
ENV NODE_ENV=production
COPY --chown=node:node --from=build /app/package.json /app/package-lock.json ./
COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/.next ./.next
COPY --chown=node:node --from=build /app/next.config.ts ./
COPY --chown=node:node --from=build /app/public ./public
COPY --chown=node:node --from=build /app/deploy ./deploy
COPY --chown=node:node --from=build /app/scripts ./scripts
COPY --chown=node:node --from=build /app/migrations ./migrations
COPY --chown=node:node --from=build /app/src ./src
COPY --chown=node:node --from=build /app/tsconfig.json ./
USER node
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0"]
