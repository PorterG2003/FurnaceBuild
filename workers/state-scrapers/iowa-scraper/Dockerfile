# Playwright base includes Chromium + OS deps for Iowa SOS automation.
# Keep in sync with package.json `playwright` version (browser bundles must match).
# Iowa often needs headed Chrome; install Xvfb + Chrome for Testing for ECS parity.
FROM mcr.microsoft.com/playwright:v1.58.2-noble

USER root
RUN apt-get update && apt-get install -y xvfb && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY lib/foundry/registry-server ./lib/foundry/registry-server
COPY workers/state-scrapers/iowa-scraper ./workers/state-scrapers/iowa-scraper

WORKDIR /app/workers/state-scrapers/iowa-scraper
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npm install
RUN npx playwright install chrome
RUN chown -R pwuser:pwuser /app /ms-playwright
RUN chmod +x docker-entrypoint.sh

USER pwuser
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV NODE_ENV=production
ENV INPUT_CSV=/data/input.csv
ENV OUTPUT_JSON=/out/iowa-scrape-report.json

ENTRYPOINT ["./docker-entrypoint.sh"]
