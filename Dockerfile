FROM node:22-alpine AS base

ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

FROM base AS deps

RUN apk add --no-cache libc6-compat python3 make g++ \
    && npm install --global bun@1.4.0

COPY . .

RUN bun install --frozen-lockfile

FROM deps AS builder

ARG DATABASE_URL=postgresql://user:password@localhost:5432/novastar
ARG NEXTAUTH_SECRET=build-placeholder-secret
ARG NEXTAUTH_URL=http://localhost:3000

ENV DATABASE_URL=$DATABASE_URL \
    NEXTAUTH_SECRET=$NEXTAUTH_SECRET \
    NEXTAUTH_URL=$NEXTAUTH_URL

RUN cd packages/database && bunx prisma generate

RUN bun run build:portal

FROM base AS runner

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN apk add --no-cache libc6-compat \
    && addgroup --gid 1001 --system nodejs \
    && adduser --uid 1001 --system nextjs

COPY --from=builder --chown=nextjs:nodejs /app/apps/portal/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/portal/.next/static ./apps/portal/.next/static

USER nextjs

EXPOSE 3000

CMD ["node", "apps/portal/server.js"]
