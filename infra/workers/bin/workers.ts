#!/usr/bin/env node
import 'source-map-support/register';
/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import { config as loadEnvFile } from 'dotenv';
import * as cdk from 'aws-cdk-lib';
import { WorkerStack } from '../lib/worker-stack';

// Repo root = infra/workers/bin -> ../../..
const repoRoot = path.resolve(__dirname, '../../..');
for (const name of ['.env.local', '.env'] as const) {
  const p = path.join(repoRoot, name);
  if (fs.existsSync(p)) {
    loadEnvFile({ path: p });
  }
}
// Root .env.local often has EXPO_PUBLIC_SUPABASE_URL but not DEV_SUPABASE_URL
if (!process.env.DEV_SUPABASE_URL?.trim() && process.env.EXPO_PUBLIC_SUPABASE_URL?.trim()) {
  process.env.DEV_SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL.trim();
}
// Same pattern as Amplify synth: .env.local usually has LEADS_SUPABASE_URL but not DEV_LEADS_SUPABASE_URL
if (!process.env.DEV_LEADS_SUPABASE_URL?.trim() && process.env.LEADS_SUPABASE_URL?.trim()) {
  process.env.DEV_LEADS_SUPABASE_URL = process.env.LEADS_SUPABASE_URL.trim();
}

const app = new cdk.App();

const account = process.env.CDK_DEFAULT_ACCOUNT || process.env.AWS_ACCOUNT_ID;
const region = process.env.CDK_DEFAULT_REGION || process.env.AWS_REGION || 'us-west-2';

// Get Supabase URLs from environment variables
const devSupabaseUrl = process.env.DEV_SUPABASE_URL || process.env.SUPABASE_URL_DEV;
let prodSupabaseUrl = process.env.PROD_SUPABASE_URL || process.env.SUPABASE_URL_PROD;

// SSM: one prefix per environment; full parameter names = prefix + /SUPABASE_SECRET_KEY,
// prefix + /LEADS_SUPABASE_SECRET_KEY, and prefix + /FOUNDRY_OPENROUTER_API_KEY (same layout Amplify uses under that folder).
// See docs/infrastructure/WORKER_SSM_AND_AMPLIFY_SECRETS.md

/** Join prefix (e.g. /amplify/.../sandbox-id) with Amplify secret segment (no leading slash). */
function ssmParamUnderPrefix(prefix: string, secretSegment: string): string {
  const p = prefix.replace(/\/+$/, '');
  const s = secretSegment.replace(/^\/+/, '');
  return `${p}/${s}`;
}

// Optional: Slack Incoming Webhook URL for error reporting (workers post errors to this channel when set)
const devSlackErrorWebhookUrl = process.env.DEV_SLACK_ERROR_WEBHOOK_URL || process.env.SLACK_ERROR_WEBHOOK_URL || undefined;
const prodSlackErrorWebhookUrl = process.env.PROD_SLACK_ERROR_WEBHOOK_URL || process.env.SLACK_ERROR_WEBHOOK_URL || undefined;

const devLeadsSupabaseUrl =
  process.env.DEV_LEADS_SUPABASE_URL?.trim() || process.env.LEADS_SUPABASE_URL_DEV?.trim();
let prodLeadsSupabaseUrl =
  process.env.PROD_LEADS_SUPABASE_URL?.trim() || process.env.LEADS_SUPABASE_URL_PROD?.trim();

// Validate required environment variables
if (!devSupabaseUrl) {
  throw new Error('DEV_SUPABASE_URL or SUPABASE_URL_DEV environment variable is required for dev stack');
}

// Same CDK app defines WorkerStack-Prod; solo-dev setups often omit prod URL.
if (!prodSupabaseUrl?.trim()) {
  prodSupabaseUrl = devSupabaseUrl;
  // eslint-disable-next-line no-console -- deploy-time hint for operators
  console.warn(
    '[workers CDK] PROD_SUPABASE_URL unset; WorkerStack-Prod uses the dev URL. Set PROD_SUPABASE_URL before deploying real production.',
  );
}

if (devLeadsSupabaseUrl && !prodLeadsSupabaseUrl) {
  prodLeadsSupabaseUrl = devLeadsSupabaseUrl;
  // eslint-disable-next-line no-console -- deploy-time hint for operators
  console.warn(
    '[workers CDK] PROD_LEADS_SUPABASE_URL unset; WorkerStack-Prod uses the dev leads URL. Set PROD_LEADS_SUPABASE_URL before deploying real production.',
  );
}

if (!account) {
  throw new Error('CDK_DEFAULT_ACCOUNT or AWS_ACCOUNT_ID environment variable is required');
}

const devSecretSsmPrefix = process.env.DEV_SECRET_SSM_PREFIX?.trim();
const prodSecretSsmPrefix = process.env.PROD_SECRET_SSM_PREFIX?.trim();
if (!devSecretSsmPrefix) {
  throw new Error(
    'DEV_SECRET_SSM_PREFIX is required (SSM path prefix; CDK appends /SUPABASE_SECRET_KEY and /LEADS_SUPABASE_SECRET_KEY — see docs/infrastructure/WORKER_SSM_AND_AMPLIFY_SECRETS.md)',
  );
}
if (!prodSecretSsmPrefix) {
  throw new Error(
    'PROD_SECRET_SSM_PREFIX is required (WorkerStack-Prod is always synthesized; duplicate DEV prefix until prod exists if needed — see docs/infrastructure/WORKER_SSM_AND_AMPLIFY_SECRETS.md)',
  );
}

const devSupabaseSecretKeyParamPath = ssmParamUnderPrefix(devSecretSsmPrefix, 'SUPABASE_SECRET_KEY');
const prodSupabaseSecretKeyParamPath = ssmParamUnderPrefix(prodSecretSsmPrefix, 'SUPABASE_SECRET_KEY');

const devLeadsSecretParamPath = devLeadsSupabaseUrl
  ? ssmParamUnderPrefix(devSecretSsmPrefix, 'LEADS_SUPABASE_SECRET_KEY')
  : undefined;
const prodLeadsSecretParamPath = prodLeadsSupabaseUrl
  ? ssmParamUnderPrefix(prodSecretSsmPrefix, 'LEADS_SUPABASE_SECRET_KEY')
  : undefined;
const devFoundryOpenRouterApiKeyParamPath = ssmParamUnderPrefix(devSecretSsmPrefix, 'FOUNDRY_OPENROUTER_API_KEY');
const prodFoundryOpenRouterApiKeyParamPath = ssmParamUnderPrefix(prodSecretSsmPrefix, 'FOUNDRY_OPENROUTER_API_KEY');
const devGooglePlacesApiKeyParamPath = ssmParamUnderPrefix(devSecretSsmPrefix, 'GOOGLE_PLACES_API_KEY');
const prodGooglePlacesApiKeyParamPath = ssmParamUnderPrefix(prodSecretSsmPrefix, 'GOOGLE_PLACES_API_KEY');
// Scheduler categorizer (AI reply classification) OpenRouter key
const devOpenRouterApiKeyParamPath = ssmParamUnderPrefix(devSecretSsmPrefix, 'OPENROUTER_API_KEY');
const prodOpenRouterApiKeyParamPath = ssmParamUnderPrefix(prodSecretSsmPrefix, 'OPENROUTER_API_KEY');

// Dev Stack
new WorkerStack(app, 'WorkerStack-Dev', {
  env: {
    account: account,
    region: region,
  },
  environment: 'dev',
  supabaseUrl: devSupabaseUrl,
  supabaseSecretKeyParamPath: devSupabaseSecretKeyParamPath,
  slackErrorWebhookUrl: devSlackErrorWebhookUrl,
  foundryOpenRouterApiKeyParamPath: devFoundryOpenRouterApiKeyParamPath,
  googlePlacesApiKeyParamPath: devGooglePlacesApiKeyParamPath,
  openRouterApiKeyParamPath: devOpenRouterApiKeyParamPath,
  ...(devLeadsSupabaseUrl
    ? { leadsSupabaseUrl: devLeadsSupabaseUrl, leadsSupabaseSecretParamPath: devLeadsSecretParamPath }
    : {}),
  desiredCount: {
    sendWorker: 0, // Start with 0, scale up after pushing Docker images
    schedulerWorker: 0, // Start with 0, scale up after pushing Docker images
    inboxCheckerWorker: 0, // Start with 0, scale up after pushing Docker images
  },
});

// Prod Stack
new WorkerStack(app, 'WorkerStack-Prod', {
  env: {
    account: account,
    region: region,
  },
  environment: 'prod',
  supabaseUrl: prodSupabaseUrl,
  supabaseSecretKeyParamPath: prodSupabaseSecretKeyParamPath,
  slackErrorWebhookUrl: prodSlackErrorWebhookUrl,
  foundryOpenRouterApiKeyParamPath: prodFoundryOpenRouterApiKeyParamPath,
  googlePlacesApiKeyParamPath: prodGooglePlacesApiKeyParamPath,
  openRouterApiKeyParamPath: prodOpenRouterApiKeyParamPath,
  ...(prodLeadsSupabaseUrl
    ? { leadsSupabaseUrl: prodLeadsSupabaseUrl, leadsSupabaseSecretParamPath: prodLeadsSecretParamPath }
    : {}),
  desiredCount: {
    sendWorker: 0, // Start with 0, scale up after pushing Docker images
    schedulerWorker: 0, // Start with 0, scale up after pushing Docker images
    inboxCheckerWorker: 0, // Start with 0, scale up after pushing Docker images
  },
});

