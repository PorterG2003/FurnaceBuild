FROM node:20-alpine

WORKDIR /app

COPY package*.json tsconfig.json ./
COPY lib ./lib
COPY workers/smartlead-migration-task ./workers/smartlead-migration-task

RUN npm ci

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

USER nodejs

CMD ["npx", "tsx", "workers/smartlead-migration-task/src/index.ts"]
