#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { FoundryStack } from '../lib/foundry-stack';

const app = new cdk.App();

const account = process.env.CDK_DEFAULT_ACCOUNT || process.env.AWS_ACCOUNT_ID;
const region = process.env.CDK_DEFAULT_REGION || process.env.AWS_REGION || 'us-west-2';

if (!account) {
  throw new Error('CDK_DEFAULT_ACCOUNT or AWS_ACCOUNT_ID is required');
}

new FoundryStack(app, 'FoundryStack-Dev', {
  env: { account, region },
  environment: 'dev',
});

new FoundryStack(app, 'FoundryStack-Prod', {
  env: { account, region },
  environment: 'prod',
});
