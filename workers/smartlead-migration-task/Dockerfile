# Build stage: build shared libs (same pattern as send-worker)
FROM node:20-alpine AS builder

WORKDIR /app

# Copy and build @furnace/email-lib
COPY lib/email/package*.json lib/email/tsconfig.build.json ./lib/email/
COPY lib/email/*.ts ./lib/email/
COPY lib/email/threading ./lib/email/threading
WORKDIR /app/lib/email
RUN npm install && npm run build

# Copy and build @furnace/slack-lib
WORKDIR /app
COPY lib/slack/package*.json lib/slack/tsconfig.build.json ./lib/slack/
COPY lib/slack/*.ts ./lib/slack/
WORKDIR /app/lib/slack
RUN npm install && npm run build

# Worker: copy package files and install (file:../../lib/email and file:../../lib/slack resolve)
WORKDIR /app/workers/smartlead-migration-task
COPY workers/smartlead-migration-task/package*.json ./
RUN npm ci

# Copy lib/smartlead and lib/supabase (source only; no separate package, resolved via @/* at runtime)
WORKDIR /app
COPY lib/smartlead ./lib/smartlead
COPY lib/supabase ./lib/supabase

# Copy worker source and tsconfig (esbuild uses it)
COPY workers/smartlead-migration-task/src ./workers/smartlead-migration-task/src
COPY workers/smartlead-migration-task/tsconfig.json ./workers/smartlead-migration-task/

# Build compiled worker entrypoint
WORKDIR /app/workers/smartlead-migration-task
RUN npm run build

# Runtime stage: minimal image, run compiled worker
FROM node:20-alpine

WORKDIR /app

# Copy built internal libs so file:../../lib/* deps resolve (email-lib needs sanitize-html at runtime)
COPY --from=builder /app/lib/email/package.json ./lib/email/
COPY --from=builder /app/lib/email/dist ./lib/email/dist
COPY --from=builder /app/lib/email/node_modules ./lib/email/node_modules
COPY --from=builder /app/lib/slack/package.json ./lib/slack/
COPY --from=builder /app/lib/slack/dist ./lib/slack/dist

# Copy worker package and node_modules from builder
COPY workers/smartlead-migration-task/package*.json ./workers/smartlead-migration-task/
COPY --from=builder /app/workers/smartlead-migration-task/node_modules ./workers/smartlead-migration-task/node_modules
COPY --from=builder /app/workers/smartlead-migration-task/dist ./workers/smartlead-migration-task/dist

# Non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

USER nodejs

WORKDIR /app
CMD ["node", "workers/smartlead-migration-task/dist/index.js"]
