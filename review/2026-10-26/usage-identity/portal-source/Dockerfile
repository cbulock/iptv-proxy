FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATABASE_PATH=/data/portal.sqlite
RUN mkdir /data && chown node:node /data
COPY --from=build --chown=node:node /app/.output ./.output
COPY --chown=node:node scripts/invalidate-restored.ts ./scripts/invalidate-restored.ts
COPY --chown=node:node server/core/db.ts server/core/restore.ts ./server/core/
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", ".output/server/index.mjs"]
