# Playwright base includes Chromium + OS deps for headless Sunbiz automation.
# Keep in sync with package.json `playwright` version (browser bundles must match).
# Xvfb + Chrome for Testing: headed Playwright fallback (channel: chrome) on ECS has no real display.
# Chrome for Testing is not available for Linux arm64; ECS uses amd64. On Apple Silicon: docker build --platform linux/amd64 ...
FROM mcr.microsoft.com/playwright:v1.58.2-noble

USER root
RUN apt-get update && apt-get install -y xvfb && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY lib/foundry/registry-server ./lib/foundry/registry-server
COPY workers/state-scrapers/florida-scraper ./workers/state-scrapers/florida-scraper

WORKDIR /app/workers/state-scrapers/florida-scraper
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npm install
RUN npx playwright install chrome
RUN chown -R pwuser:pwuser /app /ms-playwright
RUN chmod +x docker-entrypoint.sh

USER pwuser
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV NODE_ENV=production
ENV INPUT_CSV=/data/input.csv
ENV OUTPUT_JSON=/out/florida-scrape-report.json

ENTRYPOINT ["./docker-entrypoint.sh"]
