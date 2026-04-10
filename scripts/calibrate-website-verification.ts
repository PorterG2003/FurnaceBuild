import { readFileSync } from 'node:fs';
import {
  WEBSITE_VERIFICATION_SCORE_THRESHOLDS,
  type WebsiteVerificationBand,
} from '../lib/foundry/registry-server/websiteVerification.js';

type LabeledSample = {
  company_id?: string;
  score: number;
  label: WebsiteVerificationBand;
  scenario?: string;
};

function usage(): never {
  throw new Error(
    'Usage: tsx scripts/calibrate-website-verification.ts <samples.json>\n' +
      'Each sample must include { "score": number, "label": "usable" | "uncertain" | "not_usable" }.',
  );
}

function predict(score: number, usableThreshold: number, uncertainThreshold: number): WebsiteVerificationBand {
  if (score >= usableThreshold) return 'usable';
  if (score >= uncertainThreshold) return 'uncertain';
  return 'not_usable';
}

function precisionRecall(samples: LabeledSample[], positive: WebsiteVerificationBand, usableThreshold: number, uncertainThreshold: number) {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (const sample of samples) {
    const predicted = predict(sample.score, usableThreshold, uncertainThreshold);
    const predictedPositive = predicted === positive;
    const actualPositive = sample.label === positive;
    if (predictedPositive && actualPositive) tp += 1;
    if (predictedPositive && !actualPositive) fp += 1;
    if (!predictedPositive && actualPositive) fn += 1;
  }
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  return { tp, fp, fn, precision, recall };
}

function summarizeByScenario(
  samples: LabeledSample[],
  usableThreshold: number,
  uncertainThreshold: number,
) {
  const byScenario = new Map<string, { total: number; correct: number; predicted: Record<WebsiteVerificationBand, number> }>();
  for (const sample of samples) {
    const scenario = sample.scenario?.trim() || 'uncategorized';
    const bucket = byScenario.get(scenario) ?? {
      total: 0,
      correct: 0,
      predicted: { usable: 0, uncertain: 0, not_usable: 0 },
    };
    const predicted = predict(sample.score, usableThreshold, uncertainThreshold);
    bucket.total += 1;
    if (predicted === sample.label) bucket.correct += 1;
    bucket.predicted[predicted] += 1;
    byScenario.set(scenario, bucket);
  }
  return Object.fromEntries(
    [...byScenario.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([scenario, bucket]) => [
      scenario,
      {
        total: bucket.total,
        accuracy: bucket.total > 0 ? bucket.correct / bucket.total : 0,
        predicted: bucket.predicted,
      },
    ]),
  );
}

function main() {
  const path = process.argv[2];
  if (!path) usage();
  const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  if (!Array.isArray(raw)) usage();
  const samples = raw.filter(
    (item): item is LabeledSample =>
      Boolean(
        item &&
          typeof item === 'object' &&
          typeof (item as LabeledSample).score === 'number' &&
          ((item as LabeledSample).label === 'usable' ||
            (item as LabeledSample).label === 'uncertain' ||
            (item as LabeledSample).label === 'not_usable'),
      ),
  );
  if (samples.length === 0) {
    throw new Error('No valid samples found.');
  }

  const defaultUsable = WEBSITE_VERIFICATION_SCORE_THRESHOLDS.usable;
  const defaultUncertain = WEBSITE_VERIFICATION_SCORE_THRESHOLDS.uncertain;
  let best: {
    usableThreshold: number;
    uncertainThreshold: number;
    score: number;
  } = {
    usableThreshold: defaultUsable,
    uncertainThreshold: defaultUncertain,
    score: -1,
  };

  for (let usableThreshold = 60; usableThreshold <= 85; usableThreshold += 2) {
    for (let uncertainThreshold = 35; uncertainThreshold < usableThreshold; uncertainThreshold += 2) {
      const usableMetrics = precisionRecall(samples, 'usable', usableThreshold, uncertainThreshold);
      const uncertainMetrics = precisionRecall(samples, 'uncertain', usableThreshold, uncertainThreshold);
      const score = usableMetrics.precision * 0.5 + usableMetrics.recall * 0.3 + uncertainMetrics.precision * 0.2;
      if (score > best.score) {
        best = { usableThreshold, uncertainThreshold, score };
      }
    }
  }

  const defaultUsableMetrics = precisionRecall(samples, 'usable', defaultUsable, defaultUncertain);
  const defaultUncertainMetrics = precisionRecall(samples, 'uncertain', defaultUsable, defaultUncertain);
  const bestUsableMetrics = precisionRecall(samples, 'usable', best.usableThreshold, best.uncertainThreshold);
  const bestUncertainMetrics = precisionRecall(samples, 'uncertain', best.usableThreshold, best.uncertainThreshold);

  console.log(
    JSON.stringify(
      {
        sample_count: samples.length,
        defaults: {
          thresholds: WEBSITE_VERIFICATION_SCORE_THRESHOLDS,
          usable: defaultUsableMetrics,
          uncertain: defaultUncertainMetrics,
          by_scenario: summarizeByScenario(samples, defaultUsable, defaultUncertain),
        },
        suggested: {
          usable: best.usableThreshold,
          uncertain: best.uncertainThreshold,
          usable_metrics: bestUsableMetrics,
          uncertain_metrics: bestUncertainMetrics,
          by_scenario: summarizeByScenario(samples, best.usableThreshold, best.uncertainThreshold),
        },
      },
      null,
      2,
    ),
  );
}

main();
