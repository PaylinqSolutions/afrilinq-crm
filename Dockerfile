# Production image for the Afrilinq CRM demo (Railway, Render, Fly or any Docker host). The demo resets to the sample data on every deploy.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build
# Load the demo data now, so the running server starts with a ready database (seeding needs ~1 GB of memory; serving needs ~300 MB).
ENV PGLITE_DIR=/app/.data/pglite STORAGE_DIR=/app/storage
RUN mkdir -p storage && npx tsx scripts/reset.ts

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=10000 HOSTNAME=0.0.0.0 PGLITE_DIR=/app/.data/pglite STORAGE_DIR=/app/storage
COPY --from=build /app ./
EXPOSE 10000
CMD ["npx", "next", "start"]
