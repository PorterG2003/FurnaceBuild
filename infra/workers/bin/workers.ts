#!/usr/bin/env node
import 'source-map-support/register';
/// <reference types="node" />
import * as cdk from 'aws-cdk-lib';
import { WorkerStack } from '../lib/worker-stack';

const app = new cdk.App();

// Get environment from command line or environment variable
const environment = process.env.ENVIRONMENT || process.env.CDK_ENVIRONMENT || 'dev';
const account = process.env.CDK_DEFAULT_ACCOUNT || process.env.AWS_ACCOUNT_ID;
const region = process.env.CDK_DEFAULT_REGION || process.env.AWS_REGION || 'us-west-2';

// Get Supabase URLs from environment variables
const devSupabaseUrl = process.env.DEV_SUPABASE_URL || process.env.SUPABASE_URL_DEV;
const prodSupabaseUrl = process.env.PROD_SUPABASE_URL || process.env.SUPABASE_URL_PROD;

// SSM Parameter Store paths for SUPABASE_SERVICE_KEY (Supabase Secret Key)
// These should be set up manually in SSM Parameter Store using the Secret Key (not Publishable Key)
// Secret Key = old "Service Role Key" - bypasses RLS and has admin privileges
const devSupabaseServiceKeyParamPath = process.env.DEV_SUPABASE_SERVICE_KEY_PARAM_PATH || 
  '/amplify/furnacebuild/dev/SUPABASE_SERVICE_KEY';
const prodSupabaseServiceKeyParamPath = process.env.PROD_SUPABASE_SERVICE_KEY_PARAM_PATH || 
  '/amplify/shared/d1jtp0rz0l9mcn/SUPABASE_SERVICE_KEY';

// Validate required environment variables
if (!devSupabaseUrl) {
  throw new Error('DEV_SUPABASE_URL or SUPABASE_URL_DEV environment variable is required for dev stack');
}

if (!prodSupabaseUrl) {
  throw new Error('PROD_SUPABASE_URL or SUPABASE_URL_PROD environment variable is required for prod stack');
}

if (!account) {
  throw new Error('CDK_DEFAULT_ACCOUNT or AWS_ACCOUNT_ID environment variable is required');
}

// Dev Stack
new WorkerStack(app, 'WorkerStack-Dev', {
  env: {
    account: account,
    region: region,
  },
  environment: 'dev',
  supabaseUrl: devSupabaseUrl,
  supabaseServiceKeyParamPath: devSupabaseServiceKeyParamPath,
  desiredCount: {
    sendWorker: 0, // Start with 0, scale up after pushing Docker images
    schedulerWorker: 0, // Start with 0, scale up after pushing Docker images
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
  supabaseServiceKeyParamPath: prodSupabaseServiceKeyParamPath,
  desiredCount: {
    sendWorker: 0, // Start with 0, scale up after pushing Docker images
    schedulerWorker: 0, // Start with 0, scale up after pushing Docker images
  },
});

