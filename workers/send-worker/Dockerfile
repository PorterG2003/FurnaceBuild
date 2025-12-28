# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files for worker
COPY workers/send-worker/package*.json ./workers/send-worker/
WORKDIR /app/workers/send-worker

# Install dependencies
RUN npm ci

# Copy worker source code
COPY workers/send-worker/src ./src
COPY workers/send-worker/tsconfig.json ./

# Build TypeScript
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY workers/send-worker/package*.json ./
COPY workers/send-worker/dist ./dist

# Install production dependencies only
RUN npm ci --production && npm cache clean --force

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

USER nodejs

# Expose port (if needed for health checks)
# EXPOSE 3000

# Start worker
CMD ["node", "dist/index.js"]

