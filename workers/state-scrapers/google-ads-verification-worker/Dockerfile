FROM mcr.microsoft.com/playwright:v1.58.2-noble

USER root
RUN apt-get update && apt-get install -y xvfb && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY lib/foundry/registry-server ./lib/foundry/registry-server
COPY workers/state-scrapers/google-ads-verification-worker ./workers/state-scrapers/google-ads-verification-worker

WORKDIR /app/workers/state-scrapers/google-ads-verification-worker
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npm install
RUN npx playwright install chrome
RUN chown -R pwuser:pwuser /app /ms-playwright
RUN chmod +x docker-entrypoint.sh

USER pwuser
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV NODE_ENV=production

ENTRYPOINT ["./docker-entrypoint.sh"]
