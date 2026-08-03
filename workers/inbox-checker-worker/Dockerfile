# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy and build @furnace/email-lib (worker depends on file:../../lib/email)
RUN mkdir -p /app/lib/email /app/lib/mailbox /app/lib/slack /app/workers/inbox-checker-worker
COPY lib/email/package*.json lib/email/tsconfig.build.json ./lib/email/
COPY lib/email/*.ts ./lib/email/
COPY lib/email/transactional ./lib/email/transactional
WORKDIR /app/lib/email
RUN npm install && npm run build

# Copy and build @furnace/mailbox-lib (worker depends on file:../../lib/mailbox)
WORKDIR /app
COPY lib/mailbox/package*.json lib/mailbox/tsconfig.build.json lib/mailbox/*.ts ./lib/mailbox/
WORKDIR /app/lib/mailbox
RUN npm install && npm run build

# Copy and build @furnace/slack-lib (worker depends on file:../../lib/slack)
WORKDIR /app
COPY lib/slack/package.json lib/slack/package-lock.json lib/slack/tsconfig.build.json lib/slack/*.ts ./lib/slack/
WORKDIR /app/lib/slack
RUN npm install && npm run build

# Worker: package files and install (file:../../lib/* resolve)
WORKDIR /app
COPY workers/inbox-checker-worker/package*.json ./workers/inbox-checker-worker/
WORKDIR /app/workers/inbox-checker-worker
RUN npm ci

# Copy worker source code and build
COPY workers/inbox-checker-worker/src ./src
COPY workers/inbox-checker-worker/tsconfig.json ./
RUN npm run build

# Production stage (path layout so file:../../lib/* resolves)
FROM node:20-alpine

WORKDIR /app

# Copy libs so file:../../lib/* from worker dir resolves
COPY --from=builder /app/lib/email/package.json ./lib/email/
COPY --from=builder /app/lib/email/dist ./lib/email/dist
COPY --from=builder /app/lib/mailbox/package.json ./lib/mailbox/
COPY --from=builder /app/lib/mailbox/dist ./lib/mailbox/dist
COPY --from=builder /app/lib/slack/package.json ./lib/slack/
COPY --from=builder /app/lib/slack/dist ./lib/slack/dist

# Copy worker package and built output
COPY workers/inbox-checker-worker/package*.json ./workers/inbox-checker-worker/
COPY --from=builder /app/workers/inbox-checker-worker/dist ./workers/inbox-checker-worker/dist

WORKDIR /app/workers/inbox-checker-worker
RUN npm ci --production && npm cache clean --force

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

USER nodejs

# Start worker
CMD ["node", "dist/index.js"]
