import { config } from 'dotenv';
import { defineBackend } from '@aws-amplify/backend';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cdk from 'aws-cdk-lib';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as sfnTasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { sendTransactionalEmail } from './functions/sendTransactionalEmail/resource';
import { sendFluxQuizSubmission } from './functions/sendFluxQuizSubmission/resource';
import { testMailboxConnection } from './functions/testMailboxConnection/resource';
import { enrollmentMetric } from './functions/enrollmentMetric/resource';
import { fetchEmailAttachment } from './functions/fetchEmailAttachment/resource';
import { launchSmartleadMigration } from './functions/launchSmartleadMigration/resource';
import { foundryRegistryApi } from './functions/foundryRegistryApi/resource';
import { foundryNormalizeJob } from './functions/foundryNormalizeJob/resource';
import { foundryAutolinkJob } from './functions/foundryAutolinkJob/resource';
import { foundryContactEnrichmentJob } from './functions/foundryContactEnrichmentJob/resource';
import { foundryStateMatchingJob } from './functions/foundryStateMatchingJob/resource';
import { foundryWebsiteVerificationJob } from './functions/foundryWebsiteVerificationJob/resource';
import { foundryGoogleAdsVerificationJob } from './functions/foundryGoogleAdsVerificationJob/resource';
import { foundryCsvBuilderExportJob } from './functions/foundryCsvBuilderExportJob/resource';
import { processNotificationEvent } from './functions/processNotificationEvent/resource';
import { processWebhookEvent } from './functions/processWebhookEvent/resource';
import { classifyReply } from './functions/classifyReply/resource';
import { platformCommerce } from './functions/platformCommerce/resource';
import { stripeWebhook } from './functions/stripeWebhook/resource';
import { clientApi } from './functions/clientApi/resource';
import { clientApiBulkImport } from './functions/clientApiBulkImport/resource';
import { leadsExportJob } from './functions/leadsExportJob/resource';
import { fluxGenerate } from './functions/fluxGenerate/resource';
import { fluxEditorChat } from './functions/fluxEditorChat/resource';
import { googlePlaces } from './functions/googlePlaces/resource';
import { apolloEnrich } from './functions/apolloEnrich/resource';
import { fluxCompetitorAuditJob } from './functions/fluxCompetitorAuditJob/resource';
import { fluxCompetitorAuditStart } from './functions/fluxCompetitorAuditStart/resource';
import { categorizerPreview } from './functions/categorizerPreview/resource';

// Load .env.local so EXPO_PUBLIC_SUPABASE_URL is available for Lambdas at synth time
config({ path: '.env.local' });
config();

const smartleadMigrationEnabled = !['false', '0'].includes(
  (process.env.AMPLIFY_ENABLE_SMARTLEAD_MIGRATION ?? '').toLowerCase(),
);

/**
 * @see https://docs.amplify.aws/react/build-a-backend/ to add storage, functions, and more
 *
 * Note: ECS workers have been moved to a separate CDK stack in infra/workers/
 * This keeps Amplify deployments fast and avoids CloudFormation timeout issues.
 */
const backend = defineBackend({
  auth,
  data,
  sendTransactionalEmail,
  sendFluxQuizSubmission,
  testMailboxConnection,
  enrollmentMetric,
  fetchEmailAttachment,
  foundryRegistryApi,
  foundryNormalizeJob,
  foundryAutolinkJob,
  foundryContactEnrichmentJob,
  foundryStateMatchingJob,
  foundryWebsiteVerificationJob,
  foundryGoogleAdsVerificationJob,
  foundryCsvBuilderExportJob,
  processNotificationEvent,
  processWebhookEvent,
  classifyReply,
  platformCommerce,
  stripeWebhook,
  clientApi,
  clientApiBulkImport,
  leadsExportJob,
  fluxGenerate,
  fluxEditorChat,
  googlePlaces,
  apolloEnrich,
  fluxCompetitorAuditJob,
  fluxCompetitorAuditStart,
  categorizerPreview,
  ...(smartleadMigrationEnabled ? { launchSmartleadMigration } : {}),
});

function resolveWorkerEnvironment(): 'dev' | 'prod' {
  const value = process.env.WORKER_ENVIRONMENT ?? process.env.ENVIRONMENT ?? 'dev';

  if (value !== 'dev' && value !== 'prod') {
    throw new Error(
      `Invalid WORKER_ENVIRONMENT/ENVIRONMENT value "${value}". Expected "dev" or "prod".`,
    );
  }

  return value;
}

// Fetch email attachment: Function URL + Supabase auth.getUser() for token verification
const fetchAttachmentLambda = backend.fetchEmailAttachment.resources.lambda as lambda.Function;
fetchAttachmentLambda.addEnvironment('SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL ?? '');

const fetchAttachmentUrl = fetchAttachmentLambda.addFunctionUrl({
  authType: lambda.FunctionUrlAuthType.NONE, // We validate JWT inside the handler
  cors: {
    allowedOrigins: ['*'],
    allowedMethods: [lambda.HttpMethod.GET, lambda.HttpMethod.POST],
    allowedHeaders: ['Authorization', 'Content-Type'],
    exposedHeaders: ['Content-Disposition', 'Content-Type'],
  },
});
// With authType NONE, the resource-based policy must explicitly allow public invocation.
// Use CfnPermission directly since addPermission doesn't support Principal "*"
new lambda.CfnPermission(fetchAttachmentLambda.stack, 'AllowPublicFunctionUrlInvoke', {
  action: 'lambda:InvokeFunctionUrl',
  functionName: fetchAttachmentLambda.functionName,
  principal: '*',
  functionUrlAuthType: 'NONE',
});
// As of Oct 2025, Function URLs also require lambda:InvokeFunction permission.
// Keep this scoped to Function URL invocations via explicit CFN override.
const allowPublicInvokeViaUrl = new lambda.CfnPermission(fetchAttachmentLambda.stack, 'AllowPublicInvokeViaFunctionUrl', {
  action: 'lambda:InvokeFunction',
  functionName: fetchAttachmentLambda.functionName,
  principal: '*',
});
allowPublicInvokeViaUrl.addPropertyOverride('InvokedViaFunctionUrl', true);

// Transactional email: Function URL + Supabase auth.getUser() for token verification
const sendTransactionalEmailLambda = backend.sendTransactionalEmail.resources.lambda as lambda.Function;
sendTransactionalEmailLambda.addEnvironment('SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL ?? '');
const sendTransactionalEmailUrl = sendTransactionalEmailLambda.addFunctionUrl({
  authType: lambda.FunctionUrlAuthType.NONE,
  cors: {
    allowedOrigins: ['*'],
    allowedMethods: [lambda.HttpMethod.POST],
    allowedHeaders: ['Authorization', 'Content-Type'],
  },
});
new lambda.CfnPermission(sendTransactionalEmailLambda.stack, 'AllowPublicSendTransactionalEmailUrlInvoke', {
  action: 'lambda:InvokeFunctionUrl',
  functionName: sendTransactionalEmailLambda.functionName,
  principal: '*',
  functionUrlAuthType: 'NONE',
});
const allowPublicSendTransactionalEmailInvoke = new lambda.CfnPermission(
  sendTransactionalEmailLambda.stack,
  'AllowPublicSendTransactionalEmailInvokeViaUrl',
  {
    action: 'lambda:InvokeFunction',
    functionName: sendTransactionalEmailLambda.functionName,
    principal: '*',
  },
);
allowPublicSendTransactionalEmailInvoke.addPropertyOverride('InvokedViaFunctionUrl', true);

// Test mailbox connection: Function URL + Supabase auth.getUser() for token verification
const testMailboxLambda = backend.testMailboxConnection.resources.lambda as lambda.Function;
testMailboxLambda.addEnvironment('SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL ?? '');
const testMailboxUrl = testMailboxLambda.addFunctionUrl({
  authType: lambda.FunctionUrlAuthType.NONE,
  cors: {
    allowedOrigins: ['*'],
    allowedMethods: [lambda.HttpMethod.POST],
    allowedHeaders: ['Authorization', 'Content-Type'],
  },
});
new lambda.CfnPermission(testMailboxLambda.stack, 'AllowPublicTestMailboxUrlInvoke', {
  action: 'lambda:InvokeFunctionUrl',
  functionName: testMailboxLambda.functionName,
  principal: '*',
  functionUrlAuthType: 'NONE',
});
const allowPublicTestMailboxInvoke = new lambda.CfnPermission(testMailboxLambda.stack, 'AllowPublicTestMailboxInvokeViaUrl', {
  action: 'lambda:InvokeFunction',
  functionName: testMailboxLambda.functionName,
  principal: '*',
});
allowPublicTestMailboxInvoke.addPropertyOverride('InvokedViaFunctionUrl', true);

// Platform commerce: public Function URL, action-specific auth inside handler
const platformCommerceLambda = backend.platformCommerce.resources.lambda as lambda.Function;
platformCommerceLambda.addEnvironment('SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL ?? '');
platformCommerceLambda.addEnvironment(
  'WEB_APP_ORIGIN',
  process.env.WEB_APP_ORIGIN ?? 'https://build.getfurnace.io',
);
const platformCommerceUrl = platformCommerceLambda.addFunctionUrl({
  authType: lambda.FunctionUrlAuthType.NONE,
  cors: {
    allowedOrigins: ['*'],
    allowedMethods: [lambda.HttpMethod.POST],
    allowedHeaders: ['Authorization', 'Content-Type'],
  },
});
new lambda.CfnPermission(platformCommerceLambda.stack, 'AllowPublicPlatformCommerceUrlInvoke', {
  action: 'lambda:InvokeFunctionUrl',
  functionName: platformCommerceLambda.functionName,
  principal: '*',
  functionUrlAuthType: 'NONE',
});
const allowPublicPlatformCommerceInvoke = new lambda.CfnPermission(
  platformCommerceLambda.stack,
  'AllowPublicPlatformCommerceInvokeViaUrl',
  {
    action: 'lambda:InvokeFunction',
    functionName: platformCommerceLambda.functionName,
    principal: '*',
  },
);
allowPublicPlatformCommerceInvoke.addPropertyOverride('InvokedViaFunctionUrl', true);

// Stripe webhook: public Function URL authenticated by Stripe signature
const stripeWebhookLambda = backend.stripeWebhook.resources.lambda as lambda.Function;
stripeWebhookLambda.addEnvironment('SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL ?? '');
const stripeWebhookUrl = stripeWebhookLambda.addFunctionUrl({
  authType: lambda.FunctionUrlAuthType.NONE,
  cors: {
    allowedOrigins: ['*'],
    allowedMethods: [lambda.HttpMethod.POST],
    allowedHeaders: ['Stripe-Signature', 'Content-Type'],
  },
});
new lambda.CfnPermission(stripeWebhookLambda.stack, 'AllowPublicStripeWebhookUrlInvoke', {
  action: 'lambda:InvokeFunctionUrl',
  functionName: stripeWebhookLambda.functionName,
  principal: '*',
  functionUrlAuthType: 'NONE',
});
const allowPublicStripeWebhookInvoke = new lambda.CfnPermission(
  stripeWebhookLambda.stack,
  'AllowPublicStripeWebhookInvokeViaUrl',
  {
    action: 'lambda:InvokeFunction',
    functionName: stripeWebhookLambda.functionName,
    principal: '*',
  }
);
allowPublicStripeWebhookInvoke.addPropertyOverride('InvokedViaFunctionUrl', true);

// Flux quiz submission: public Function URL for live page visitors
const sendFluxQuizSubmissionLambda = backend.sendFluxQuizSubmission.resources.lambda as lambda.Function;
sendFluxQuizSubmissionLambda.addEnvironment('SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL ?? '');
sendFluxQuizSubmissionLambda.addEnvironment(
  'WEB_APP_ORIGIN',
  process.env.WEB_APP_ORIGIN ?? 'https://build.getfurnace.io',
);
const sendFluxQuizSubmissionUrl = sendFluxQuizSubmissionLambda.addFunctionUrl({
  authType: lambda.FunctionUrlAuthType.NONE,
  cors: {
    allowedOrigins: ['*'],
    allowedMethods: [lambda.HttpMethod.POST],
    allowedHeaders: ['Content-Type'],
  },
});
new lambda.CfnPermission(sendFluxQuizSubmissionLambda.stack, 'AllowPublicSendFluxQuizSubmissionUrlInvoke', {
  action: 'lambda:InvokeFunctionUrl',
  functionName: sendFluxQuizSubmissionLambda.functionName,
  principal: '*',
  functionUrlAuthType: 'NONE',
});
const allowPublicSendFluxQuizSubmissionInvoke = new lambda.CfnPermission(
  sendFluxQuizSubmissionLambda.stack,
  'AllowPublicSendFluxQuizSubmissionInvokeViaUrl',
  {
    action: 'lambda:InvokeFunction',
    functionName: sendFluxQuizSubmissionLambda.functionName,
    principal: '*',
  },
);
allowPublicSendFluxQuizSubmissionInvoke.addPropertyOverride('InvokedViaFunctionUrl', true);

// Foundry: normalize/autolink workers (Step Functions) + registry HTTP API (Function URL)
const workerEnvironment = resolveWorkerEnvironment();
const foundryNormalizeLambda = backend.foundryNormalizeJob.resources.lambda as lambda.Function;
const foundryAutolinkLambda = backend.foundryAutolinkJob.resources.lambda as lambda.Function;
const foundryContactEnrichmentLambda = backend.foundryContactEnrichmentJob.resources.lambda as lambda.Function;
const foundryCsvBuilderExportLambda = backend.foundryCsvBuilderExportJob.resources.lambda as lambda.Function;
const foundryNormalizeStack = foundryNormalizeLambda.stack;
foundryNormalizeLambda.addEnvironment('LEADS_SUPABASE_URL', process.env.LEADS_SUPABASE_URL ?? '');
foundryAutolinkLambda.addEnvironment('LEADS_SUPABASE_URL', process.env.LEADS_SUPABASE_URL ?? '');
foundryContactEnrichmentLambda.addEnvironment('LEADS_SUPABASE_URL', process.env.LEADS_SUPABASE_URL ?? '');
foundryCsvBuilderExportLambda.addEnvironment('LEADS_SUPABASE_URL', process.env.LEADS_SUPABASE_URL ?? '');

const csvBuilderExportBucket = new s3.Bucket(foundryNormalizeStack, 'CsvBuilderExportBucket', {
  blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
  encryption: s3.BucketEncryption.S3_MANAGED,
  enforceSSL: true,
  versioned: false,
  cors: [
    {
      allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.HEAD, s3.HttpMethods.PUT],
      allowedOrigins: ['*'],
      allowedHeaders: ['*'],
      exposedHeaders: ['ETag'],
    },
  ],
  lifecycleRules: [
    {
      prefix: 'csv-builder-uploads/',
      expiration: cdk.Duration.days(3),
    },
  ],
  removalPolicy: cdk.RemovalPolicy.RETAIN,
});
csvBuilderExportBucket.grantReadWrite(foundryCsvBuilderExportLambda);
foundryCsvBuilderExportLambda.addEnvironment('CSV_BUILDER_EXPORT_BUCKET', csvBuilderExportBucket.bucketName);

// fromJsonPathAt('$') with payloadResponseOnly synthesizes a literal "$" payload (CDK renderObject skips non-objects).
const foundryNormalizeChunk = new sfnTasks.LambdaInvoke(foundryNormalizeStack, 'FoundryNormalizeChunk', {
  lambdaFunction: foundryNormalizeLambda,
  payload: sfn.TaskInput.fromObject({
    'jobId.$': '$.jobId',
    'ingestionRunId.$': '$.ingestionRunId',
    'batchSize.$': '$.batchSize',
    'cursor.$': '$.cursor',
  }),
  resultPath: '$.lastChunk',
  payloadResponseOnly: true,
});

const foundryNormalizePrepareNext = new sfn.Pass(foundryNormalizeStack, 'FoundryNormalizePrepareNext', {
  parameters: {
    'jobId.$': '$.jobId',
    'ingestionRunId.$': '$.ingestionRunId',
    'batchSize.$': '$.batchSize',
    'cursor.$': '$.lastChunk.nextCursor',
  },
});

const foundryNormalizeFinalize = new sfnTasks.LambdaInvoke(foundryNormalizeStack, 'FoundryNormalizeFinalize', {
  lambdaFunction: foundryNormalizeLambda,
  payload: sfn.TaskInput.fromObject({
    action: 'finalize',
    'jobId.$': '$.jobId',
  }),
  payloadResponseOnly: true,
});

const foundryNormalizeFail = new sfnTasks.LambdaInvoke(foundryNormalizeStack, 'FoundryNormalizeFail', {
  lambdaFunction: foundryNormalizeLambda,
  payload: sfn.TaskInput.fromObject({
    action: 'fail',
    'jobId.$': '$.jobId',
    'message.$': '$.error.Cause',
  }),
  payloadResponseOnly: true,
});

const foundryNormalizeAfterFail = new sfn.Succeed(foundryNormalizeStack, 'FoundryNormalizeAfterFail');
foundryNormalizeFail.next(foundryNormalizeAfterFail);

foundryNormalizeChunk.addCatch(foundryNormalizeFail, {
  errors: [sfn.Errors.ALL],
  resultPath: '$.error',
});

const foundryNormalizeDone = new sfn.Succeed(foundryNormalizeStack, 'FoundryNormalizeDone');
foundryNormalizeFinalize.next(foundryNormalizeDone);

const foundryNormalizeMoreChunks = new sfn.Choice(foundryNormalizeStack, 'FoundryNormalizeMoreChunks')
  .when(sfn.Condition.booleanEquals('$.lastChunk.done', true), foundryNormalizeFinalize)
  .otherwise(foundryNormalizePrepareNext);

foundryNormalizeChunk.next(foundryNormalizeMoreChunks);
foundryNormalizePrepareNext.next(foundryNormalizeChunk);

const foundryNormalizeStateMachineName = `foundry-normalize-ingestion-${workerEnvironment}`;
const foundryNormalizeStateMachine = new sfn.StateMachine(foundryNormalizeStack, 'FoundryNormalizeIngestionSm', {
  stateMachineName: foundryNormalizeStateMachineName,
  definitionBody: sfn.DefinitionBody.fromChainable(foundryNormalizeChunk),
});

// ARN built from name + stack partition/region/account — avoids a CFN cycle with the registry Lambda
// (registry env + grantStartExecution on the state machine resource ↔ SFN ↔ normalize Lambda).
const foundryNormalizeStateMachineArn = cdk.Stack.of(foundryNormalizeStack).formatArn({
  service: 'states',
  resource: 'stateMachine',
  resourceName: foundryNormalizeStateMachineName,
  arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
});

const foundryAutolinkChunk = new sfnTasks.LambdaInvoke(foundryNormalizeStack, 'FoundryAutolinkChunk', {
  lambdaFunction: foundryAutolinkLambda,
  payload: sfn.TaskInput.fromObject({
    'jobId.$': '$.jobId',
    'ingestionRunId.$': '$.ingestionRunId',
    'batchSize.$': '$.batchSize',
    'cursor.$': '$.cursor',
  }),
  resultPath: '$.lastChunk',
  payloadResponseOnly: true,
});

const foundryAutolinkPrepareNext = new sfn.Pass(foundryNormalizeStack, 'FoundryAutolinkPrepareNext', {
  parameters: {
    'jobId.$': '$.jobId',
    'ingestionRunId.$': '$.ingestionRunId',
    'batchSize.$': '$.batchSize',
    'cursor.$': '$.lastChunk.nextCursor',
  },
});

const foundryAutolinkFinalize = new sfnTasks.LambdaInvoke(foundryNormalizeStack, 'FoundryAutolinkFinalize', {
  lambdaFunction: foundryAutolinkLambda,
  payload: sfn.TaskInput.fromObject({
    action: 'finalize',
    'jobId.$': '$.jobId',
  }),
  payloadResponseOnly: true,
});

const foundryAutolinkFail = new sfnTasks.LambdaInvoke(foundryNormalizeStack, 'FoundryAutolinkFail', {
  lambdaFunction: foundryAutolinkLambda,
  payload: sfn.TaskInput.fromObject({
    action: 'fail',
    'jobId.$': '$.jobId',
    'message.$': '$.error.Cause',
  }),
  payloadResponseOnly: true,
});

const foundryAutolinkAfterFail = new sfn.Succeed(foundryNormalizeStack, 'FoundryAutolinkAfterFail');
foundryAutolinkFail.next(foundryAutolinkAfterFail);

foundryAutolinkChunk.addCatch(foundryAutolinkFail, {
  errors: [sfn.Errors.ALL],
  resultPath: '$.error',
});

const foundryAutolinkDone = new sfn.Succeed(foundryNormalizeStack, 'FoundryAutolinkDone');
foundryAutolinkFinalize.next(foundryAutolinkDone);

const foundryAutolinkMoreChunks = new sfn.Choice(foundryNormalizeStack, 'FoundryAutolinkMoreChunks')
  .when(sfn.Condition.booleanEquals('$.lastChunk.done', true), foundryAutolinkFinalize)
  .otherwise(foundryAutolinkPrepareNext);

foundryAutolinkChunk.next(foundryAutolinkMoreChunks);
foundryAutolinkPrepareNext.next(foundryAutolinkChunk);

const foundryAutolinkStateMachineName = `foundry-autolink-ingestion-${workerEnvironment}`;
const foundryAutolinkStateMachine = new sfn.StateMachine(foundryNormalizeStack, 'FoundryAutolinkIngestionSm', {
  stateMachineName: foundryAutolinkStateMachineName,
  definitionBody: sfn.DefinitionBody.fromChainable(foundryAutolinkChunk),
});

const foundryAutolinkStateMachineArn = cdk.Stack.of(foundryNormalizeStack).formatArn({
  service: 'states',
  resource: 'stateMachine',
  resourceName: foundryAutolinkStateMachineName,
  arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
});

const foundryContactEnrichmentChunk = new sfnTasks.LambdaInvoke(foundryNormalizeStack, 'FoundryContactEnrichmentChunk', {
  lambdaFunction: foundryContactEnrichmentLambda,
  payload: sfn.TaskInput.fromObject({
    'jobId.$': '$.jobId',
    'batchSize.$': '$.batchSize',
    'cursor.$': '$.cursor',
  }),
  resultPath: '$.lastChunk',
  payloadResponseOnly: true,
});

const foundryContactEnrichmentPrepareNext = new sfn.Pass(foundryNormalizeStack, 'FoundryContactEnrichmentPrepareNext', {
  parameters: {
    'jobId.$': '$.jobId',
    'batchSize.$': '$.batchSize',
    'cursor.$': '$.lastChunk.nextCursor',
  },
});

const foundryContactEnrichmentFinalize = new sfnTasks.LambdaInvoke(
  foundryNormalizeStack,
  'FoundryContactEnrichmentFinalize',
  {
    lambdaFunction: foundryContactEnrichmentLambda,
    payload: sfn.TaskInput.fromObject({
      action: 'finalize',
      'jobId.$': '$.jobId',
    }),
    payloadResponseOnly: true,
  },
);

const foundryContactEnrichmentFail = new sfnTasks.LambdaInvoke(foundryNormalizeStack, 'FoundryContactEnrichmentFail', {
  lambdaFunction: foundryContactEnrichmentLambda,
  payload: sfn.TaskInput.fromObject({
    action: 'fail',
    'jobId.$': '$.jobId',
    'message.$': '$.error.Cause',
  }),
  payloadResponseOnly: true,
});

const foundryContactEnrichmentAfterFail = new sfn.Succeed(foundryNormalizeStack, 'FoundryContactEnrichmentAfterFail');
foundryContactEnrichmentFail.next(foundryContactEnrichmentAfterFail);

foundryContactEnrichmentChunk.addCatch(foundryContactEnrichmentFail, {
  errors: [sfn.Errors.ALL],
  resultPath: '$.error',
});

const foundryContactEnrichmentDone = new sfn.Succeed(foundryNormalizeStack, 'FoundryContactEnrichmentDone');
foundryContactEnrichmentFinalize.next(foundryContactEnrichmentDone);

const foundryContactEnrichmentMoreChunks = new sfn.Choice(foundryNormalizeStack, 'FoundryContactEnrichmentMoreChunks')
  .when(sfn.Condition.booleanEquals('$.lastChunk.done', true), foundryContactEnrichmentFinalize)
  .otherwise(foundryContactEnrichmentPrepareNext);

foundryContactEnrichmentChunk.next(foundryContactEnrichmentMoreChunks);
foundryContactEnrichmentPrepareNext.next(foundryContactEnrichmentChunk);

const foundryContactEnrichmentStateMachineName = `foundry-contact-enrichment-${workerEnvironment}`;
const foundryContactEnrichmentStateMachine = new sfn.StateMachine(
  foundryNormalizeStack,
  'FoundryContactEnrichmentSm',
  {
    stateMachineName: foundryContactEnrichmentStateMachineName,
    definitionBody: sfn.DefinitionBody.fromChainable(foundryContactEnrichmentChunk),
  },
);

const foundryContactEnrichmentStateMachineArn = cdk.Stack.of(foundryNormalizeStack).formatArn({
  service: 'states',
  resource: 'stateMachine',
  resourceName: foundryContactEnrichmentStateMachineName,
  arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
});

const workerClusterName = cdk.Fn.importValue(`FurnaceCluster-${workerEnvironment}`);
const workerSecurityGroupId = cdk.Fn.importValue(`FurnaceWorkerSecurityGroup-${workerEnvironment}`);
const workerPublicSubnetIds = cdk.Fn.split(
  ',',
  cdk.Fn.importValue(`FurnaceWorkerPublicSubnets-${workerEnvironment}`),
);
const ecsTaskExecutionRoleArn = cdk.Fn.importValue(`FurnaceEcsTaskExecutionRole-${workerEnvironment}`);
const utahScraperTaskRoleArn = cdk.Fn.importValue(`FurnaceUtahScraperTaskRole-${workerEnvironment}`);
const floridaScraperTaskRoleArn = cdk.Fn.importValue(`FurnaceFloridaScraperTaskRole-${workerEnvironment}`);
const iowaScraperTaskRoleArn = cdk.Fn.importValue(`FurnaceIowaScraperTaskRole-${workerEnvironment}`);
const websiteVerificationTaskRoleArn = cdk.Fn.importValue(
  `FurnaceWebsiteVerificationTaskRole-${workerEnvironment}`,
);
const googleAdsVerificationTaskRoleArn = cdk.Fn.importValue(
  `FurnaceGoogleAdsVerificationTaskRole-${workerEnvironment}`,
);
// ECS RunTask accepts a task definition *family* (no revision). Amazon ECS resolves it to the
// latest ACTIVE revision at run time. Pinning a full ARN (e.g. from SSM at Amplify deploy time)
// goes stale when infra/workers registers a new revision, leaving Step Functions on an INACTIVE TD.
const utahScraperTaskFamily = `furnace-utah-scraper-task-${workerEnvironment}`;
const floridaScraperTaskFamily = `furnace-florida-scraper-task-${workerEnvironment}`;
const iowaScraperTaskFamily = `furnace-iowa-scraper-task-${workerEnvironment}`;
const websiteVerificationTaskFamily = `furnace-website-verification-task-${workerEnvironment}`;
const googleAdsVerificationTaskFamily = `furnace-google-ads-verification-task-${workerEnvironment}`;

function buildStateScraperRunTask(
  id: string,
  containerName: string,
  taskDefinitionFamily: string,
): sfn.CustomState {
  const config =
    containerName === 'utah-scraper'
      ? { itemsPath: '$.utahBatches', taskStateName: 'RunUtahBatch' }
      : containerName === 'florida-scraper'
        ? { itemsPath: '$.floridaBatches', taskStateName: 'RunFloridaBatch' }
        : { itemsPath: '$.iowaBatches', taskStateName: 'RunIowaBatch' };
  return new sfn.CustomState(foundryNormalizeStack, id, {
    stateJson: {
      Type: 'Map',
      ItemsPath: config.itemsPath,
      MaxConcurrency: 1,
      Parameters: {
        'jobId.$': '$.jobId',
        'reconciliationRunId.$': '$.reconciliationRunId',
        'companyIds.$': '$$.Map.Item.Value',
      },
      Iterator: {
        StartAt: config.taskStateName,
        States: {
          [config.taskStateName]: {
            Type: 'Task',
            Resource: 'arn:aws:states:::ecs:runTask.sync',
            Parameters: {
              LaunchType: 'FARGATE',
              Cluster: workerClusterName,
              TaskDefinition: taskDefinitionFamily,
              NetworkConfiguration: {
                AwsvpcConfiguration: {
                  Subnets: workerPublicSubnetIds,
                  SecurityGroups: [workerSecurityGroupId],
                  AssignPublicIp: 'ENABLED',
                },
              },
              Overrides: {
                ContainerOverrides: [
                  {
                    Name: containerName,
                    Environment: [
                      { Name: 'RUN_MODE', Value: 'reconciliation' },
                      { Name: 'JOB_ID', 'Value.$': '$.jobId' },
                      { Name: 'RECONCILIATION_RUN_ID', 'Value.$': '$.reconciliationRunId' },
                      { Name: 'COMPANY_IDS_JSON', 'Value.$': 'States.JsonToString($.companyIds)' },
                    ],
                  },
                ],
              },
            },
            End: true,
          },
        },
      },
      End: true,
    },
  });
}

const foundryStateMatchingLambda = backend.foundryStateMatchingJob.resources.lambda as lambda.Function;
foundryStateMatchingLambda.addEnvironment('LEADS_SUPABASE_URL', process.env.LEADS_SUPABASE_URL ?? '');

const foundryStateMatchingUtahTask = buildStateScraperRunTask(
  'FoundryStateMatchingRunUtahTask',
  'utah-scraper',
  utahScraperTaskFamily,
);
const foundryStateMatchingFloridaTask = buildStateScraperRunTask(
  'FoundryStateMatchingRunFloridaTask',
  'florida-scraper',
  floridaScraperTaskFamily,
);
const foundryStateMatchingIowaTask = buildStateScraperRunTask(
  'FoundryStateMatchingRunIowaTask',
  'iowa-scraper',
  iowaScraperTaskFamily,
);
const foundryStateMatchingSkipUtah = new sfn.Pass(foundryNormalizeStack, 'FoundryStateMatchingSkipUtah');
const foundryStateMatchingSkipFlorida = new sfn.Pass(foundryNormalizeStack, 'FoundryStateMatchingSkipFlorida');
const foundryStateMatchingSkipIowa = new sfn.Pass(foundryNormalizeStack, 'FoundryStateMatchingSkipIowa');
const foundryStateMatchingUtahChoice = new sfn.Choice(foundryNormalizeStack, 'FoundryStateMatchingUtahChoice')
  .when(sfn.Condition.numberGreaterThan('$.utahCount', 0), foundryStateMatchingUtahTask)
  .otherwise(foundryStateMatchingSkipUtah);
const foundryStateMatchingFloridaChoice = new sfn.Choice(foundryNormalizeStack, 'FoundryStateMatchingFloridaChoice')
  .when(sfn.Condition.numberGreaterThan('$.floridaCount', 0), foundryStateMatchingFloridaTask)
  .otherwise(foundryStateMatchingSkipFlorida);
const foundryStateMatchingIowaChoice = new sfn.Choice(foundryNormalizeStack, 'FoundryStateMatchingIowaChoice')
  .when(sfn.Condition.numberGreaterThan('$.iowaCount', 0), foundryStateMatchingIowaTask)
  .otherwise(foundryStateMatchingSkipIowa);
const foundryStateMatchingParallel = new sfn.Parallel(foundryNormalizeStack, 'FoundryStateMatchingParallel');
foundryStateMatchingParallel.branch(foundryStateMatchingUtahChoice);
foundryStateMatchingParallel.branch(foundryStateMatchingFloridaChoice);
foundryStateMatchingParallel.branch(foundryStateMatchingIowaChoice);

const foundryStateMatchingFinalize = new sfnTasks.LambdaInvoke(
  foundryNormalizeStack,
  'FoundryStateMatchingFinalize',
  {
    lambdaFunction: foundryStateMatchingLambda,
    payload: sfn.TaskInput.fromObject({
      action: 'finalize',
      'jobId.$': '$.jobId',
      'reconciliationRunId.$': '$.reconciliationRunId',
    }),
    payloadResponseOnly: true,
  },
);
const foundryStateMatchingFail = new sfnTasks.LambdaInvoke(foundryNormalizeStack, 'FoundryStateMatchingFail', {
  lambdaFunction: foundryStateMatchingLambda,
  payload: sfn.TaskInput.fromObject({
    action: 'fail',
    'jobId.$': '$.jobId',
    'reconciliationRunId.$': '$.reconciliationRunId',
    'message.$': '$.error.Cause',
  }),
  payloadResponseOnly: true,
});
const foundryStateMatchingDone = new sfn.Succeed(foundryNormalizeStack, 'FoundryStateMatchingDone');
const foundryStateMatchingAfterFail = new sfn.Succeed(foundryNormalizeStack, 'FoundryStateMatchingAfterFail');
foundryStateMatchingFinalize.next(foundryStateMatchingDone);
foundryStateMatchingFail.next(foundryStateMatchingAfterFail);
foundryStateMatchingParallel.addCatch(foundryStateMatchingFail, {
  errors: [sfn.Errors.ALL],
  resultPath: '$.error',
});
foundryStateMatchingFinalize.addCatch(foundryStateMatchingFail, {
  errors: [sfn.Errors.ALL],
  resultPath: '$.error',
});
foundryStateMatchingParallel.next(foundryStateMatchingFinalize);

const foundryStateMatchingStateMachineName = `foundry-state-matching-${workerEnvironment}`;
const foundryStateMatchingStateMachine = new sfn.StateMachine(
  foundryNormalizeStack,
  'FoundryStateMatchingSm',
  {
    stateMachineName: foundryStateMatchingStateMachineName,
    definitionBody: sfn.DefinitionBody.fromChainable(foundryStateMatchingParallel),
  },
);
foundryStateMatchingStateMachine.role.addToPrincipalPolicy(
  new iam.PolicyStatement({
    sid: 'FoundryStateMatchingRunEcsTasks',
    actions: ['ecs:RunTask', 'ecs:DescribeTasks', 'ecs:StopTask'],
    resources: ['*'],
  }),
);
foundryStateMatchingStateMachine.role.addToPrincipalPolicy(
  new iam.PolicyStatement({
    sid: 'FoundryStateMatchingEventsForEcsTasks',
    actions: ['events:PutTargets', 'events:PutRule', 'events:DescribeRule'],
    resources: ['*'],
  }),
);
foundryStateMatchingStateMachine.role.addToPrincipalPolicy(
  new iam.PolicyStatement({
    sid: 'FoundryStateMatchingPassEcsRoles',
    actions: ['iam:PassRole'],
    resources: [ecsTaskExecutionRoleArn, utahScraperTaskRoleArn, floridaScraperTaskRoleArn, iowaScraperTaskRoleArn],
  }),
);
const foundryStateMatchingStateMachineArn = cdk.Stack.of(foundryNormalizeStack).formatArn({
  service: 'states',
  resource: 'stateMachine',
  resourceName: foundryStateMatchingStateMachineName,
  arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
});

const foundryWebsiteVerificationLambda = backend.foundryWebsiteVerificationJob.resources.lambda as lambda.Function;
foundryWebsiteVerificationLambda.addEnvironment('LEADS_SUPABASE_URL', process.env.LEADS_SUPABASE_URL ?? '');

const foundryWebsiteVerificationImportRunTask = new sfn.CustomState(
  foundryNormalizeStack,
  'FoundryWebsiteVerificationImportRunTask',
  {
    stateJson: {
      Type: 'Map',
      ResultPath: null,
      ItemsPath: '$.websiteBatches',
      MaxConcurrencyPath: '$.mapMaxConcurrency',
      Parameters: {
        'jobId.$': '$.jobId',
        'batchTotal.$': '$.batchCount',
        'batchIndex.$': '$$.Map.Item.Index',
        'companyIds.$': '$$.Map.Item.Value',
      },
      Iterator: {
        StartAt: 'RunWebsiteVerificationImportBatch',
        States: {
          RunWebsiteVerificationImportBatch: {
            Type: 'Task',
            Resource: 'arn:aws:states:::ecs:runTask.sync',
            Parameters: {
              LaunchType: 'FARGATE',
              Cluster: workerClusterName,
              TaskDefinition: websiteVerificationTaskFamily,
              NetworkConfiguration: {
                AwsvpcConfiguration: {
                  Subnets: workerPublicSubnetIds,
                  SecurityGroups: [workerSecurityGroupId],
                  AssignPublicIp: 'ENABLED',
                },
              },
              Overrides: {
                ContainerOverrides: [
                  {
                    Name: 'website-verification-worker',
                    Environment: [
                      { Name: 'JOB_ID', 'Value.$': '$.jobId' },
                      { Name: 'COMPANY_IDS_JSON', 'Value.$': 'States.JsonToString($.companyIds)' },
                      { Name: 'BATCH_INDEX', 'Value.$': "States.Format('{}', $.batchIndex)" },
                      { Name: 'BATCH_TOTAL', 'Value.$': "States.Format('{}', $.batchTotal)" },
                    ],
                  },
                ],
              },
            },
            End: true,
          },
        },
      },
    },
  },
);
const foundryWebsiteVerificationCsvBuilderRunTask = new sfn.CustomState(
  foundryNormalizeStack,
  'FoundryWebsiteVerificationCsvBuilderRunTask',
  {
    stateJson: {
      Type: 'Map',
      ResultPath: null,
      ItemsPath: '$.csvBuilderBatchIds',
      MaxConcurrencyPath: '$.mapMaxConcurrency',
      Parameters: {
        'jobId.$': '$.jobId',
        'batchTotal.$': '$.batchCount',
        'batchIndex.$': '$$.Map.Item.Index',
        'csvBuilderBatchId.$': '$$.Map.Item.Value',
      },
      Iterator: {
        StartAt: 'RunCsvBuilderWebsiteVerificationBatch',
        States: {
          RunCsvBuilderWebsiteVerificationBatch: {
            Type: 'Task',
            Resource: 'arn:aws:states:::ecs:runTask.sync',
            Parameters: {
              LaunchType: 'FARGATE',
              Cluster: workerClusterName,
              TaskDefinition: websiteVerificationTaskFamily,
              NetworkConfiguration: {
                AwsvpcConfiguration: {
                  Subnets: workerPublicSubnetIds,
                  SecurityGroups: [workerSecurityGroupId],
                  AssignPublicIp: 'ENABLED',
                },
              },
              Overrides: {
                ContainerOverrides: [
                  {
                    Name: 'website-verification-worker',
                    Environment: [
                      { Name: 'JOB_ID', 'Value.$': '$.jobId' },
                      { Name: 'CSV_BUILDER_BATCH_ID', 'Value.$': '$.csvBuilderBatchId' },
                      { Name: 'BATCH_INDEX', 'Value.$': "States.Format('{}', $.batchIndex)" },
                      { Name: 'BATCH_TOTAL', 'Value.$': "States.Format('{}', $.batchTotal)" },
                    ],
                  },
                ],
              },
            },
            End: true,
          },
        },
      },
    },
  },
);
const foundryWebsiteVerificationChooseFlow = new sfn.Choice(foundryNormalizeStack, 'FoundryWebsiteVerificationChooseFlow')
  .when(sfn.Condition.isPresent('$.csvBuilderBatchIds[0]'), foundryWebsiteVerificationCsvBuilderRunTask)
  .otherwise(foundryWebsiteVerificationImportRunTask);
const foundryWebsiteVerificationFinalize = new sfnTasks.LambdaInvoke(
  foundryNormalizeStack,
  'FoundryWebsiteVerificationFinalize',
  {
    lambdaFunction: foundryWebsiteVerificationLambda,
    payload: sfn.TaskInput.fromObject({
      action: 'finalize',
      'jobId.$': '$.jobId',
    }),
    payloadResponseOnly: true,
  },
);
const foundryWebsiteVerificationFail = new sfnTasks.LambdaInvoke(
  foundryNormalizeStack,
  'FoundryWebsiteVerificationFail',
  {
    lambdaFunction: foundryWebsiteVerificationLambda,
    payload: sfn.TaskInput.fromObject({
      action: 'fail',
      'jobId.$': '$.jobId',
      'message.$': '$.error.Cause',
    }),
    payloadResponseOnly: true,
  },
);
const foundryWebsiteVerificationDone = new sfn.Succeed(foundryNormalizeStack, 'FoundryWebsiteVerificationDone');
const foundryWebsiteVerificationAfterFail = new sfn.Succeed(
  foundryNormalizeStack,
  'FoundryWebsiteVerificationAfterFail',
);
foundryWebsiteVerificationFinalize.next(foundryWebsiteVerificationDone);
foundryWebsiteVerificationFail.next(foundryWebsiteVerificationAfterFail);
foundryWebsiteVerificationImportRunTask.addCatch(foundryWebsiteVerificationFail, {
  errors: [sfn.Errors.ALL],
  resultPath: '$.error',
});
foundryWebsiteVerificationCsvBuilderRunTask.addCatch(foundryWebsiteVerificationFail, {
  errors: [sfn.Errors.ALL],
  resultPath: '$.error',
});
foundryWebsiteVerificationFinalize.addCatch(foundryWebsiteVerificationFail, {
  errors: [sfn.Errors.ALL],
  resultPath: '$.error',
});
foundryWebsiteVerificationImportRunTask.next(foundryWebsiteVerificationFinalize);
foundryWebsiteVerificationCsvBuilderRunTask.next(foundryWebsiteVerificationFinalize);

const foundryWebsiteVerificationStateMachineName = `foundry-website-verification-${workerEnvironment}`;
const foundryWebsiteVerificationStateMachine = new sfn.StateMachine(
  foundryNormalizeStack,
  'FoundryWebsiteVerificationSm',
  {
    stateMachineName: foundryWebsiteVerificationStateMachineName,
    definitionBody: sfn.DefinitionBody.fromChainable(foundryWebsiteVerificationChooseFlow),
  },
);
foundryWebsiteVerificationStateMachine.role.addToPrincipalPolicy(
  new iam.PolicyStatement({
    sid: 'FoundryWebsiteVerificationRunEcsTasks',
    actions: ['ecs:RunTask', 'ecs:DescribeTasks', 'ecs:StopTask'],
    resources: ['*'],
  }),
);
foundryWebsiteVerificationStateMachine.role.addToPrincipalPolicy(
  new iam.PolicyStatement({
    sid: 'FoundryWebsiteVerificationEventsForEcsTasks',
    actions: ['events:PutTargets', 'events:PutRule', 'events:DescribeRule'],
    resources: ['*'],
  }),
);
foundryWebsiteVerificationStateMachine.role.addToPrincipalPolicy(
  new iam.PolicyStatement({
    sid: 'FoundryWebsiteVerificationPassEcsRoles',
    actions: ['iam:PassRole'],
    resources: [ecsTaskExecutionRoleArn, websiteVerificationTaskRoleArn],
  }),
);
const foundryWebsiteVerificationStateMachineArn = cdk.Stack.of(foundryNormalizeStack).formatArn({
  service: 'states',
  resource: 'stateMachine',
  resourceName: foundryWebsiteVerificationStateMachineName,
  arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
});

const foundryGoogleAdsVerificationLambda = backend.foundryGoogleAdsVerificationJob.resources.lambda as lambda.Function;
foundryGoogleAdsVerificationLambda.addEnvironment('LEADS_SUPABASE_URL', process.env.LEADS_SUPABASE_URL ?? '');

const fluxCompetitorAuditJobLambda = backend.fluxCompetitorAuditJob.resources.lambda as lambda.Function;
fluxCompetitorAuditJobLambda.addEnvironment('SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL ?? '');

const foundryGoogleAdsVerificationImportRunTask = new sfn.CustomState(
  foundryNormalizeStack,
  'FoundryGoogleAdsVerificationImportRunTask',
  {
    stateJson: {
      Type: 'Task',
      Resource: 'arn:aws:states:::ecs:runTask.sync',
      ResultPath: null,
      Parameters: {
        LaunchType: 'FARGATE',
        Cluster: workerClusterName,
        TaskDefinition: googleAdsVerificationTaskFamily,
        NetworkConfiguration: {
          AwsvpcConfiguration: {
            Subnets: workerPublicSubnetIds,
            SecurityGroups: [workerSecurityGroupId],
            AssignPublicIp: 'ENABLED',
          },
        },
        Overrides: {
          ContainerOverrides: [
            {
              Name: 'google-ads-verification-worker',
              Environment: [{ Name: 'JOB_ID', 'Value.$': '$.jobId' }],
            },
          ],
        },
      },
    },
  },
);
const foundryGoogleAdsVerificationCsvBuilderRunTask = new sfn.CustomState(
  foundryNormalizeStack,
  'FoundryGoogleAdsVerificationCsvBuilderRunTask',
  {
    stateJson: {
      Type: 'Map',
      ResultPath: null,
      ItemsPath: '$.csvBuilderBatchIds',
      MaxConcurrencyPath: '$.mapMaxConcurrency',
      Parameters: {
        'jobId.$': '$.jobId',
        'batchTotal.$': '$.batchCount',
        'batchIndex.$': '$$.Map.Item.Index',
        'csvBuilderBatchId.$': '$$.Map.Item.Value',
      },
      Iterator: {
        StartAt: 'RunCsvBuilderGoogleAdsBatch',
        States: {
          RunCsvBuilderGoogleAdsBatch: {
            Type: 'Task',
            Resource: 'arn:aws:states:::ecs:runTask.sync',
            Parameters: {
              LaunchType: 'FARGATE',
              Cluster: workerClusterName,
              TaskDefinition: googleAdsVerificationTaskFamily,
              NetworkConfiguration: {
                AwsvpcConfiguration: {
                  Subnets: workerPublicSubnetIds,
                  SecurityGroups: [workerSecurityGroupId],
                  AssignPublicIp: 'ENABLED',
                },
              },
              Overrides: {
                ContainerOverrides: [
                  {
                    Name: 'google-ads-verification-worker',
                    Environment: [
                      { Name: 'JOB_ID', 'Value.$': '$.jobId' },
                      { Name: 'CSV_BUILDER_BATCH_ID', 'Value.$': '$.csvBuilderBatchId' },
                      { Name: 'BATCH_INDEX', 'Value.$': "States.Format('{}', $.batchIndex)" },
                      { Name: 'BATCH_TOTAL', 'Value.$': "States.Format('{}', $.batchTotal)" },
                    ],
                  },
                ],
              },
            },
            End: true,
          },
        },
      },
    },
  },
);
const foundryGoogleAdsVerificationChooseFlow = new sfn.Choice(foundryNormalizeStack, 'FoundryGoogleAdsVerificationChooseFlow')
  .when(sfn.Condition.isPresent('$.csvBuilderBatchIds[0]'), foundryGoogleAdsVerificationCsvBuilderRunTask)
  .otherwise(foundryGoogleAdsVerificationImportRunTask);
const foundryGoogleAdsVerificationFinalize = new sfnTasks.LambdaInvoke(
  foundryNormalizeStack,
  'FoundryGoogleAdsVerificationFinalize',
  {
    lambdaFunction: foundryGoogleAdsVerificationLambda,
    payload: sfn.TaskInput.fromObject({
      action: 'finalize',
      'jobId.$': '$.jobId',
    }),
    payloadResponseOnly: true,
  },
);
const foundryGoogleAdsVerificationFail = new sfnTasks.LambdaInvoke(
  foundryNormalizeStack,
  'FoundryGoogleAdsVerificationFail',
  {
    lambdaFunction: foundryGoogleAdsVerificationLambda,
    payload: sfn.TaskInput.fromObject({
      action: 'fail',
      'jobId.$': '$.jobId',
      'message.$': '$.error.Cause',
    }),
    payloadResponseOnly: true,
  },
);
const foundryGoogleAdsVerificationDone = new sfn.Succeed(foundryNormalizeStack, 'FoundryGoogleAdsVerificationDone');
const foundryGoogleAdsVerificationAfterFail = new sfn.Succeed(
  foundryNormalizeStack,
  'FoundryGoogleAdsVerificationAfterFail',
);
foundryGoogleAdsVerificationFinalize.next(foundryGoogleAdsVerificationDone);
foundryGoogleAdsVerificationFail.next(foundryGoogleAdsVerificationAfterFail);
foundryGoogleAdsVerificationImportRunTask.addCatch(foundryGoogleAdsVerificationFail, {
  errors: [sfn.Errors.ALL],
  resultPath: '$.error',
});
foundryGoogleAdsVerificationCsvBuilderRunTask.addCatch(foundryGoogleAdsVerificationFail, {
  errors: [sfn.Errors.ALL],
  resultPath: '$.error',
});
foundryGoogleAdsVerificationFinalize.addCatch(foundryGoogleAdsVerificationFail, {
  errors: [sfn.Errors.ALL],
  resultPath: '$.error',
});
foundryGoogleAdsVerificationImportRunTask.next(foundryGoogleAdsVerificationFinalize);
foundryGoogleAdsVerificationCsvBuilderRunTask.next(foundryGoogleAdsVerificationFinalize);

const foundryGoogleAdsVerificationStateMachineName = `foundry-google-ads-verification-${workerEnvironment}`;
const foundryGoogleAdsVerificationStateMachine = new sfn.StateMachine(
  foundryNormalizeStack,
  'FoundryGoogleAdsVerificationSm',
  {
    stateMachineName: foundryGoogleAdsVerificationStateMachineName,
    definitionBody: sfn.DefinitionBody.fromChainable(foundryGoogleAdsVerificationChooseFlow),
  },
);
foundryGoogleAdsVerificationStateMachine.role.addToPrincipalPolicy(
  new iam.PolicyStatement({
    sid: 'FoundryGoogleAdsVerificationRunEcsTasks',
    actions: ['ecs:RunTask', 'ecs:DescribeTasks', 'ecs:StopTask'],
    resources: ['*'],
  }),
);
foundryGoogleAdsVerificationStateMachine.role.addToPrincipalPolicy(
  new iam.PolicyStatement({
    sid: 'FoundryGoogleAdsVerificationEventsForEcsTasks',
    actions: ['events:PutTargets', 'events:PutRule', 'events:DescribeRule'],
    resources: ['*'],
  }),
);
foundryGoogleAdsVerificationStateMachine.role.addToPrincipalPolicy(
  new iam.PolicyStatement({
    sid: 'FoundryGoogleAdsVerificationPassEcsRoles',
    actions: ['iam:PassRole'],
    resources: [ecsTaskExecutionRoleArn, googleAdsVerificationTaskRoleArn],
  }),
);
const foundryGoogleAdsVerificationStateMachineArn = cdk.Stack.of(foundryNormalizeStack).formatArn({
  service: 'states',
  resource: 'stateMachine',
  resourceName: foundryGoogleAdsVerificationStateMachineName,
  arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
});

/** Flux prospect page: Places → transparency → rank → static map (google-ads-verification ECS task). */
const fluxCompetitorAuditRunEcs = new sfn.CustomState(foundryNormalizeStack, 'FluxCompetitorAuditRunEcs', {
  stateJson: {
    Type: 'Task',
    Resource: 'arn:aws:states:::ecs:runTask.sync',
    ResultPath: null,
    Parameters: {
      LaunchType: 'FARGATE',
      Cluster: workerClusterName,
      TaskDefinition: googleAdsVerificationTaskFamily,
      NetworkConfiguration: {
        AwsvpcConfiguration: {
          Subnets: workerPublicSubnetIds,
          SecurityGroups: [workerSecurityGroupId],
          AssignPublicIp: 'ENABLED',
        },
      },
      Overrides: {
        ContainerOverrides: [
          {
            Name: 'google-ads-verification-worker',
            Environment: [
              { Name: 'JOB_KIND', Value: 'flux_competitor_audit' },
              { Name: 'FLUX_AUDIT_JOB_JSON', 'Value.$': 'States.JsonToString($)' },
            ],
          },
        ],
      },
    },
    End: true,
  },
});
const fluxCompetitorAuditFail = new sfnTasks.LambdaInvoke(foundryNormalizeStack, 'FluxCompetitorAuditFail', {
  lambdaFunction: fluxCompetitorAuditJobLambda,
  payload: sfn.TaskInput.fromObject({
    action: 'fail',
    'jobId.$': '$.jobId',
    'message.$': '$.error.Cause',
  }),
  payloadResponseOnly: true,
});
const fluxCompetitorAuditAfterFail = new sfn.Succeed(foundryNormalizeStack, 'FluxCompetitorAuditAfterFail');
fluxCompetitorAuditFail.next(fluxCompetitorAuditAfterFail);
fluxCompetitorAuditRunEcs.addCatch(fluxCompetitorAuditFail, {
  errors: [sfn.Errors.ALL],
  resultPath: '$.error',
});
const fluxCompetitorAuditStateMachineName = `flux-competitor-audit-${workerEnvironment}`;
const fluxCompetitorAuditStateMachine = new sfn.StateMachine(foundryNormalizeStack, 'FluxCompetitorAuditSm', {
  stateMachineName: fluxCompetitorAuditStateMachineName,
  definitionBody: sfn.DefinitionBody.fromChainable(fluxCompetitorAuditRunEcs),
});
fluxCompetitorAuditStateMachine.role.addToPrincipalPolicy(
  new iam.PolicyStatement({
    sid: 'FluxCompetitorAuditRunEcsTasks',
    actions: ['ecs:RunTask', 'ecs:DescribeTasks', 'ecs:StopTask'],
    resources: ['*'],
  }),
);
fluxCompetitorAuditStateMachine.role.addToPrincipalPolicy(
  new iam.PolicyStatement({
    sid: 'FluxCompetitorAuditEventsForEcsTasks',
    actions: ['events:PutTargets', 'events:PutRule', 'events:DescribeRule'],
    resources: ['*'],
  }),
);
fluxCompetitorAuditStateMachine.role.addToPrincipalPolicy(
  new iam.PolicyStatement({
    sid: 'FluxCompetitorAuditPassEcsRoles',
    actions: ['iam:PassRole'],
    resources: [ecsTaskExecutionRoleArn, googleAdsVerificationTaskRoleArn],
  }),
);
const fluxCompetitorAuditStateMachineArn = cdk.Stack.of(foundryNormalizeStack).formatArn({
  service: 'states',
  resource: 'stateMachine',
  resourceName: fluxCompetitorAuditStateMachineName,
  arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
});

const foundryCsvBuilderExportRun = new sfnTasks.LambdaInvoke(foundryNormalizeStack, 'FoundryCsvBuilderExportRun', {
  lambdaFunction: foundryCsvBuilderExportLambda,
  payload: sfn.TaskInput.fromObject({
    'jobId.$': '$.jobId',
    'runId.$': '$.runId',
  }),
  payloadResponseOnly: true,
});
const foundryCsvBuilderExportFail = new sfnTasks.LambdaInvoke(foundryNormalizeStack, 'FoundryCsvBuilderExportFail', {
  lambdaFunction: foundryCsvBuilderExportLambda,
  payload: sfn.TaskInput.fromObject({
    action: 'fail',
    'jobId.$': '$.jobId',
    'message.$': '$.error.Cause',
  }),
  payloadResponseOnly: true,
});
const foundryCsvBuilderExportDone = new sfn.Succeed(foundryNormalizeStack, 'FoundryCsvBuilderExportDone');
const foundryCsvBuilderExportAfterFail = new sfn.Succeed(foundryNormalizeStack, 'FoundryCsvBuilderExportAfterFail');
foundryCsvBuilderExportRun.next(foundryCsvBuilderExportDone);
foundryCsvBuilderExportFail.next(foundryCsvBuilderExportAfterFail);
foundryCsvBuilderExportRun.addCatch(foundryCsvBuilderExportFail, {
  errors: [sfn.Errors.ALL],
  resultPath: '$.error',
});

const foundryCsvBuilderExportStateMachineName = `foundry-csv-builder-export-${workerEnvironment}`;
const foundryCsvBuilderExportStateMachine = new sfn.StateMachine(foundryNormalizeStack, 'FoundryCsvBuilderExportSm', {
  stateMachineName: foundryCsvBuilderExportStateMachineName,
  definitionBody: sfn.DefinitionBody.fromChainable(foundryCsvBuilderExportRun),
});
const foundryCsvBuilderExportStateMachineArn = cdk.Stack.of(foundryNormalizeStack).formatArn({
  service: 'states',
  resource: 'stateMachine',
  resourceName: foundryCsvBuilderExportStateMachineName,
  arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
});

const foundryRegistryLambda = backend.foundryRegistryApi.resources.lambda as lambda.Function;
foundryRegistryLambda.addEnvironment('SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL ?? '');
foundryRegistryLambda.addEnvironment('LEADS_SUPABASE_URL', process.env.LEADS_SUPABASE_URL ?? '');
foundryRegistryLambda.addEnvironment('FOUNDRY_NORMALIZE_STATE_MACHINE_ARN', foundryNormalizeStateMachineArn);
foundryRegistryLambda.addEnvironment('FOUNDRY_AUTOLINK_STATE_MACHINE_ARN', foundryAutolinkStateMachineArn);
foundryRegistryLambda.addEnvironment('FOUNDRY_CONTACT_ENRICHMENT_STATE_MACHINE_ARN', foundryContactEnrichmentStateMachineArn);
foundryRegistryLambda.addEnvironment('FOUNDRY_STATE_MATCHING_STATE_MACHINE_ARN', foundryStateMatchingStateMachineArn);
foundryRegistryLambda.addEnvironment(
  'FOUNDRY_WEBSITE_VERIFICATION_STATE_MACHINE_ARN',
  foundryWebsiteVerificationStateMachineArn,
);
foundryRegistryLambda.addEnvironment(
  'FOUNDRY_GOOGLE_ADS_VERIFICATION_STATE_MACHINE_ARN',
  foundryGoogleAdsVerificationStateMachineArn,
);
foundryRegistryLambda.addEnvironment(
  'FOUNDRY_CSV_BUILDER_EXPORT_STATE_MACHINE_ARN',
  foundryCsvBuilderExportStateMachineArn,
);
foundryRegistryLambda.addEnvironment('CSV_BUILDER_EXPORT_BUCKET', csvBuilderExportBucket.bucketName);
csvBuilderExportBucket.grantReadWrite(foundryRegistryLambda);
foundryRegistryLambda.addToRolePolicy(
  new iam.PolicyStatement({
    sid: 'FoundryRegistryStartNormalizeExecution',
    actions: ['states:StartExecution'],
    resources: [
      foundryNormalizeStateMachineArn,
      foundryAutolinkStateMachineArn,
      foundryContactEnrichmentStateMachineArn,
      foundryStateMatchingStateMachineArn,
      foundryWebsiteVerificationStateMachineArn,
      foundryGoogleAdsVerificationStateMachineArn,
      foundryCsvBuilderExportStateMachineArn,
    ],
  }),
);
foundryNormalizeLambda.addEnvironment('FOUNDRY_AUTOLINK_STATE_MACHINE_ARN', foundryAutolinkStateMachineArn);
foundryNormalizeLambda.addToRolePolicy(
  new iam.PolicyStatement({
    sid: 'FoundryNormalizeStartAutolinkExecution',
    actions: ['states:StartExecution'],
    resources: [foundryAutolinkStateMachineArn],
  }),
);

const foundryRegistryUrl = foundryRegistryLambda.addFunctionUrl({
  authType: lambda.FunctionUrlAuthType.NONE,
  cors: {
    allowedOrigins: ['*'],
    allowedMethods: [
      lambda.HttpMethod.GET,
      lambda.HttpMethod.POST,
      lambda.HttpMethod.PATCH,
      lambda.HttpMethod.PUT,
      lambda.HttpMethod.DELETE,
    ],
    allowedHeaders: ['Authorization', 'Content-Type'],
  },
});
new lambda.CfnPermission(foundryRegistryLambda.stack, 'AllowPublicFoundryRegistryUrlInvoke', {
  action: 'lambda:InvokeFunctionUrl',
  functionName: foundryRegistryLambda.functionName,
  principal: '*',
  functionUrlAuthType: 'NONE',
});
const allowPublicFoundryRegistryInvoke = new lambda.CfnPermission(
  foundryRegistryLambda.stack,
  'AllowPublicFoundryRegistryInvokeViaUrl',
  {
    action: 'lambda:InvokeFunction',
    functionName: foundryRegistryLambda.functionName,
    principal: '*',
  },
);
allowPublicFoundryRegistryInvoke.addPropertyOverride('InvokedViaFunctionUrl', true);

const clientApiLambda = backend.clientApi.resources.lambda as lambda.Function;
clientApiLambda.addEnvironment('SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL ?? '');

const clientApiUrl = clientApiLambda.addFunctionUrl({
  authType: lambda.FunctionUrlAuthType.NONE,
  cors: {
    allowedOrigins: [
      'https://build.getfurnace.io',
      'http://localhost:8081',
      'http://localhost:19006',
    ],
    allowedMethods: [
      lambda.HttpMethod.GET,
      lambda.HttpMethod.POST,
      lambda.HttpMethod.PATCH,
      lambda.HttpMethod.PUT,
      lambda.HttpMethod.DELETE,
    ],
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'],
  },
});
new lambda.CfnPermission(clientApiLambda.stack, 'AllowPublicClientApiUrlInvoke', {
  action: 'lambda:InvokeFunctionUrl',
  functionName: clientApiLambda.functionName,
  principal: '*',
  functionUrlAuthType: 'NONE',
});
const allowPublicClientApiInvoke = new lambda.CfnPermission(
  clientApiLambda.stack,
  'AllowPublicClientApiInvokeViaUrl',
  {
    action: 'lambda:InvokeFunction',
    functionName: clientApiLambda.functionName,
    principal: '*',
  },
);
allowPublicClientApiInvoke.addPropertyOverride('InvokedViaFunctionUrl', true);

const clientApiWorkerEnvironment = resolveWorkerEnvironment();
const webhookQueue = new sqs.Queue(backend.stack, 'ClientApiWebhookEventsQueue', {
  queueName: `furnace-webhook-events-${clientApiWorkerEnvironment}`,
  visibilityTimeout: cdk.Duration.seconds(120),
  retentionPeriod: cdk.Duration.days(4),
});
const importQueue = new sqs.Queue(backend.stack, 'ClientApiImportQueue', {
  queueName: `furnace-client-api-import-${clientApiWorkerEnvironment}`,
  visibilityTimeout: cdk.Duration.seconds(300),
  retentionPeriod: cdk.Duration.days(4),
});

new cdk.CfnOutput(backend.stack, 'ClientApiWebhookQueueArnExport', {
  value: webhookQueue.queueArn,
  exportName: `FurnaceWebhookEventsQueueArn-${clientApiWorkerEnvironment}`,
});
new cdk.CfnOutput(backend.stack, 'ClientApiWebhookQueueUrlExport', {
  value: webhookQueue.queueUrl,
  exportName: `FurnaceWebhookEventsQueueUrl-${clientApiWorkerEnvironment}`,
});
new cdk.CfnOutput(backend.stack, 'ClientApiImportQueueArnExport', {
  value: importQueue.queueArn,
  exportName: `FurnaceClientApiImportQueueArn-${clientApiWorkerEnvironment}`,
});
new cdk.CfnOutput(backend.stack, 'ClientApiImportQueueUrlExport', {
  value: importQueue.queueUrl,
  exportName: `FurnaceClientApiImportQueueUrl-${clientApiWorkerEnvironment}`,
});

clientApiLambda.addEnvironment('CLIENT_API_WEBHOOK_QUEUE_URL', webhookQueue.queueUrl);
clientApiLambda.addEnvironment('CLIENT_API_IMPORT_QUEUE_URL', importQueue.queueUrl);
clientApiLambda.addEnvironment('WEBHOOK_ENQUEUE_SECRET', process.env.WEBHOOK_ENQUEUE_SECRET ?? '');
webhookQueue.grantSendMessages(clientApiLambda);
importQueue.grantSendMessages(clientApiLambda);

const processWebhookLambda = backend.processWebhookEvent.resources.lambda as lambda.Function;
processWebhookLambda.addEnvironment('SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL ?? '');
webhookQueue.grantConsumeMessages(processWebhookLambda);
processWebhookLambda.addEventSource(
  new lambdaEventSources.SqsEventSource(webhookQueue, {
    batchSize: 5,
    maxBatchingWindow: cdk.Duration.seconds(5),
    reportBatchItemFailures: true,
  }),
);

const clientApiBulkImportLambda = backend.clientApiBulkImport.resources.lambda as lambda.Function;
const leadsExportJobLambda = backend.leadsExportJob.resources.lambda as lambda.Function;
const clientApiStack = clientApiLambda.stack;
clientApiBulkImportLambda.addEnvironment('SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL ?? '');
leadsExportJobLambda.addEnvironment('SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL ?? '');
importQueue.grantConsumeMessages(clientApiBulkImportLambda);
clientApiBulkImportLambda.addEventSource(
  new lambdaEventSources.SqsEventSource(importQueue, {
    batchSize: 1,
    reportBatchItemFailures: true,
  }),
);

const leadsExportBucket = new s3.Bucket(clientApiStack, 'LeadsExportBucket', {
  blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
  encryption: s3.BucketEncryption.S3_MANAGED,
  enforceSSL: true,
  versioned: false,
  cors: [
    {
      allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.HEAD, s3.HttpMethods.PUT],
      allowedOrigins: ['*'],
      allowedHeaders: ['*'],
      exposedHeaders: ['ETag'],
    },
  ],
  lifecycleRules: [
    {
      prefix: 'leads-exports/',
      expiration: cdk.Duration.days(3),
    },
  ],
  removalPolicy: cdk.RemovalPolicy.RETAIN,
});
leadsExportBucket.grantReadWrite(leadsExportJobLambda);
leadsExportJobLambda.addEnvironment('LEADS_EXPORT_BUCKET', leadsExportBucket.bucketName);

const leadsExportRun = new sfnTasks.LambdaInvoke(clientApiStack, 'LeadsExportRun', {
  lambdaFunction: leadsExportJobLambda,
  payload: sfn.TaskInput.fromObject({
    'jobId.$': '$.jobId',
  }),
  payloadResponseOnly: true,
});
const leadsExportFail = new sfnTasks.LambdaInvoke(clientApiStack, 'LeadsExportFail', {
  lambdaFunction: leadsExportJobLambda,
  payload: sfn.TaskInput.fromObject({
    action: 'fail',
    'jobId.$': '$.jobId',
    'message.$': '$.error.Cause',
  }),
  payloadResponseOnly: true,
});
const leadsExportDone = new sfn.Succeed(clientApiStack, 'LeadsExportDone');
const leadsExportAfterFail = new sfn.Succeed(clientApiStack, 'LeadsExportAfterFail');
leadsExportRun.next(leadsExportDone);
leadsExportFail.next(leadsExportAfterFail);
leadsExportRun.addCatch(leadsExportFail, {
  errors: [sfn.Errors.ALL],
  resultPath: '$.error',
});
const leadsExportStateMachineName = `leads-export-${clientApiWorkerEnvironment}`;
const leadsExportStateMachine = new sfn.StateMachine(clientApiStack, 'LeadsExportSm', {
  stateMachineName: leadsExportStateMachineName,
  definitionBody: sfn.DefinitionBody.fromChainable(leadsExportRun),
});
const leadsExportStateMachineArn = cdk.Stack.of(clientApiStack).formatArn({
  service: 'states',
  resource: 'stateMachine',
  resourceName: leadsExportStateMachineName,
  arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
});
clientApiLambda.addEnvironment('LEADS_EXPORT_STATE_MACHINE_ARN', leadsExportStateMachineArn);
clientApiLambda.addToRolePolicy(
  new iam.PolicyStatement({
    sid: 'ClientApiStartLeadsExportExecution',
    actions: ['states:StartExecution'],
    resources: [leadsExportStateMachineArn],
  }),
);

const clientApiOriginHost = cdk.Fn.select(2, cdk.Fn.split('/', clientApiUrl.url));
const skipClientApiCustomDomain = ['true', '1', 'yes'].includes(
  (process.env.CLIENT_API_SKIP_CUSTOM_DOMAIN ?? '').toLowerCase(),
);
const clientApiDomainName = skipClientApiCustomDomain
  ? undefined
  : process.env.CLIENT_API_DOMAIN_NAME?.trim();
const clientApiCertificateArn = skipClientApiCustomDomain
  ? undefined
  : process.env.CLIENT_API_CERTIFICATE_ARN?.trim();
const clientApiWafWebAclArnRaw = process.env.CLIENT_API_WAF_WEB_ACL_ARN?.trim();
const clientApiWafWebAclArn =
  clientApiWafWebAclArnRaw?.startsWith('arn:aws:wafv2:') || clientApiWafWebAclArnRaw?.startsWith('arn:aws:waf:')
    ? clientApiWafWebAclArnRaw
    : undefined;
// Co-locate CloudFront with the clientApi Lambda to avoid a function <-> root stack cycle:
// distribution needs the function URL; the function needs CLIENT_API_BASE_URL from the distribution.
const clientApiCachePolicy = new cloudfront.CachePolicy(clientApiStack, 'ClientApiCachePolicy', {
  defaultTtl: cdk.Duration.seconds(0),
  minTtl: cdk.Duration.seconds(0),
  maxTtl: cdk.Duration.seconds(1),
  headerBehavior: cloudfront.CacheHeaderBehavior.allowList('Authorization'),
  queryStringBehavior: cloudfront.CacheQueryStringBehavior.all(),
  cookieBehavior: cloudfront.CacheCookieBehavior.none(),
  enableAcceptEncodingBrotli: true,
  enableAcceptEncodingGzip: true,
});
const clientApiOriginRequestPolicy = new cloudfront.OriginRequestPolicy(
  clientApiStack,
  'ClientApiOriginRequestPolicy',
  {
    headerBehavior: cloudfront.OriginRequestHeaderBehavior.allowList(
      'Content-Type',
      'Idempotency-Key',
      'X-Furnace-Internal-Secret',
    ),
    queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.all(),
    cookieBehavior: cloudfront.OriginRequestCookieBehavior.none(),
  },
);

const clientApiDistribution = new cloudfront.Distribution(clientApiStack, 'ClientApiDistribution', {
  defaultBehavior: {
    origin: new origins.HttpOrigin(clientApiOriginHost, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
    }),
    cachePolicy: clientApiCachePolicy,
    originRequestPolicy: clientApiOriginRequestPolicy,
    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
  },
  additionalBehaviors: {
    'openapi.json': {
      origin: new origins.HttpOrigin(clientApiOriginHost, {
        protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
      }),
      cachePolicy: clientApiCachePolicy,
      originRequestPolicy: clientApiOriginRequestPolicy,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    },
  },
  ...(clientApiDomainName && clientApiCertificateArn
    ? {
        domainNames: [clientApiDomainName],
        certificate: acm.Certificate.fromCertificateArn(
          clientApiStack,
          'ClientApiCertificate',
          clientApiCertificateArn,
        ),
      }
    : {}),
  webAclId: clientApiWafWebAclArn || undefined,
});

const resolvedClientApiBaseUrl = clientApiDomainName
  ? `https://${clientApiDomainName}`
  : `https://${clientApiDistribution.distributionDomainName}`;
// Set base URL from deploy-time domain only — referencing the distribution domain on the
// Lambda creates a CloudFormation cycle (Lambda -> Function URL -> Distribution -> Lambda).
if (clientApiDomainName) {
  clientApiLambda.addEnvironment('CLIENT_API_BASE_URL', `https://${clientApiDomainName}`);
} else {
  const clientApiDocsOrigin = process.env.CLIENT_API_DOCS_ORIGIN?.trim();
  if (clientApiDocsOrigin) {
    clientApiLambda.addEnvironment('CLIENT_API_DOCS_ORIGIN', clientApiDocsOrigin.replace(/\/$/, ''));
  }
}

// Flux: generate personalized prospect pages (Function URL + Supabase JWT)
const fluxGenerateLambda = backend.fluxGenerate.resources.lambda as lambda.Function;
fluxGenerateLambda.addEnvironment('SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL ?? '');
fluxGenerateLambda.addEnvironment(
  'FLUX_OPENROUTER_MODEL',
  process.env.FLUX_OPENROUTER_MODEL ?? 'anthropic/claude-opus-4.7',
);
const openRouterReferer = process.env.FLUX_OPENROUTER_HTTP_REFERER?.trim();
if (openRouterReferer) {
  fluxGenerateLambda.addEnvironment('FLUX_OPENROUTER_HTTP_REFERER', openRouterReferer);
}
const openRouterTitle = process.env.FLUX_OPENROUTER_TITLE?.trim();
if (openRouterTitle) {
  fluxGenerateLambda.addEnvironment('FLUX_OPENROUTER_TITLE', openRouterTitle);
}
const fluxGenerateUrl = fluxGenerateLambda.addFunctionUrl({
  authType: lambda.FunctionUrlAuthType.NONE,
  cors: {
    allowedOrigins: ['*'],
    allowedMethods: [lambda.HttpMethod.POST],
    allowedHeaders: ['Authorization', 'Content-Type'],
  },
});
new lambda.CfnPermission(fluxGenerateLambda.stack, 'AllowPublicFluxGenerateUrlInvoke', {
  action: 'lambda:InvokeFunctionUrl',
  functionName: fluxGenerateLambda.functionName,
  principal: '*',
  functionUrlAuthType: 'NONE',
});
const allowPublicFluxGenerateInvoke = new lambda.CfnPermission(
  fluxGenerateLambda.stack,
  'AllowPublicFluxGenerateInvokeViaUrl',
  {
    action: 'lambda:InvokeFunction',
    functionName: fluxGenerateLambda.functionName,
    principal: '*',
  },
);
allowPublicFluxGenerateInvoke.addPropertyOverride('InvokedViaFunctionUrl', true);

// Flux: editor chat (Function URL + Supabase JWT)
const fluxEditorChatLambda = backend.fluxEditorChat.resources.lambda as lambda.Function;
fluxEditorChatLambda.addEnvironment('SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL ?? '');
fluxEditorChatLambda.addEnvironment(
  'FLUX_OPENROUTER_MODEL',
  process.env.FLUX_OPENROUTER_MODEL ?? 'anthropic/claude-opus-4.7',
);
if (openRouterReferer) {
  fluxEditorChatLambda.addEnvironment('FLUX_OPENROUTER_HTTP_REFERER', openRouterReferer);
}
if (openRouterTitle) {
  fluxEditorChatLambda.addEnvironment('FLUX_OPENROUTER_TITLE', openRouterTitle);
}
const fluxEditorChatUrl = fluxEditorChatLambda.addFunctionUrl({
  authType: lambda.FunctionUrlAuthType.NONE,
  cors: {
    allowedOrigins: ['*'],
    allowedMethods: [lambda.HttpMethod.POST],
    allowedHeaders: ['Authorization', 'Content-Type'],
  },
});
new lambda.CfnPermission(fluxEditorChatLambda.stack, 'AllowPublicFluxEditorChatUrlInvoke', {
  action: 'lambda:InvokeFunctionUrl',
  functionName: fluxEditorChatLambda.functionName,
  principal: '*',
  functionUrlAuthType: 'NONE',
});
const allowPublicFluxEditorChatInvoke = new lambda.CfnPermission(
  fluxEditorChatLambda.stack,
  'AllowPublicFluxEditorChatInvokeViaUrl',
  {
    action: 'lambda:InvokeFunction',
    functionName: fluxEditorChatLambda.functionName,
    principal: '*',
  },
);
allowPublicFluxEditorChatInvoke.addPropertyOverride('InvokedViaFunctionUrl', true);

// Categorizer preview (Function URL + Supabase JWT) — read-only AI categorization preview for the builder
const categorizerPreviewLambda = backend.categorizerPreview.resources.lambda as lambda.Function;
categorizerPreviewLambda.addEnvironment('SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL ?? '');
if (process.env.OPENROUTER_CATEGORIZER_MODEL) {
  categorizerPreviewLambda.addEnvironment(
    'OPENROUTER_CATEGORIZER_MODEL',
    process.env.OPENROUTER_CATEGORIZER_MODEL,
  );
}
const categorizerPreviewUrl = categorizerPreviewLambda.addFunctionUrl({
  authType: lambda.FunctionUrlAuthType.NONE,
  cors: {
    allowedOrigins: ['*'],
    allowedMethods: [lambda.HttpMethod.POST],
    allowedHeaders: ['Authorization', 'Content-Type'],
  },
});
new lambda.CfnPermission(categorizerPreviewLambda.stack, 'AllowPublicCategorizerPreviewUrlInvoke', {
  action: 'lambda:InvokeFunctionUrl',
  functionName: categorizerPreviewLambda.functionName,
  principal: '*',
  functionUrlAuthType: 'NONE',
});
const allowPublicCategorizerPreviewInvoke = new lambda.CfnPermission(
  categorizerPreviewLambda.stack,
  'AllowPublicCategorizerPreviewInvokeViaUrl',
  {
    action: 'lambda:InvokeFunction',
    functionName: categorizerPreviewLambda.functionName,
    principal: '*',
  },
);
allowPublicCategorizerPreviewInvoke.addPropertyOverride('InvokedViaFunctionUrl', true);

// Google Places API (New) proxy — Function URL + Supabase JWT (flux or foundry flag)
const googlePlacesLambda = backend.googlePlaces.resources.lambda as lambda.Function;
googlePlacesLambda.addEnvironment('SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL ?? '');
const googlePlacesUrl = googlePlacesLambda.addFunctionUrl({
  authType: lambda.FunctionUrlAuthType.NONE,
  cors: {
    allowedOrigins: ['*'],
    allowedMethods: [lambda.HttpMethod.POST],
    allowedHeaders: ['Authorization', 'Content-Type'],
  },
});
new lambda.CfnPermission(googlePlacesLambda.stack, 'AllowPublicGooglePlacesUrlInvoke', {
  action: 'lambda:InvokeFunctionUrl',
  functionName: googlePlacesLambda.functionName,
  principal: '*',
  functionUrlAuthType: 'NONE',
});
const allowPublicGooglePlacesInvoke = new lambda.CfnPermission(
  googlePlacesLambda.stack,
  'AllowPublicGooglePlacesInvokeViaUrl',
  {
    action: 'lambda:InvokeFunction',
    functionName: googlePlacesLambda.functionName,
    principal: '*',
  },
);
allowPublicGooglePlacesInvoke.addPropertyOverride('InvokedViaFunctionUrl', true);

// Apollo.io person enrichment proxy — Function URL + Supabase JWT + credit metering
const apolloEnrichLambda = backend.apolloEnrich.resources.lambda as lambda.Function;
apolloEnrichLambda.addEnvironment('SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL ?? '');
const apolloEnrichUrl = apolloEnrichLambda.addFunctionUrl({
  authType: lambda.FunctionUrlAuthType.NONE,
  cors: {
    allowedOrigins: ['*'],
    allowedMethods: [lambda.HttpMethod.POST],
    allowedHeaders: ['Authorization', 'Content-Type'],
  },
});
new lambda.CfnPermission(apolloEnrichLambda.stack, 'AllowPublicApolloEnrichUrlInvoke', {
  action: 'lambda:InvokeFunctionUrl',
  functionName: apolloEnrichLambda.functionName,
  principal: '*',
  functionUrlAuthType: 'NONE',
});
// Second permission on parent stack avoids nested-stack circular dependency on first deploy.
const allowPublicApolloEnrichInvoke = new lambda.CfnPermission(
  backend.stack,
  'AllowPublicApolloEnrichInvokeViaUrl',
  {
    action: 'lambda:InvokeFunction',
    functionName: apolloEnrichLambda.functionArn,
    principal: '*',
  },
);
allowPublicApolloEnrichInvoke.addPropertyOverride('InvokedViaFunctionUrl', true);

const fluxCompetitorAuditStartLambda = backend.fluxCompetitorAuditStart.resources.lambda as lambda.Function;
fluxCompetitorAuditStartLambda.addEnvironment('SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL ?? '');
fluxCompetitorAuditStartLambda.addEnvironment(
  'FLUX_COMPETITOR_AUDIT_STATE_MACHINE_ARN',
  fluxCompetitorAuditStateMachineArn,
);
fluxCompetitorAuditStartLambda.addToRolePolicy(
  new iam.PolicyStatement({
    sid: 'FluxCompetitorAuditStartExecution',
    actions: ['states:StartExecution'],
    resources: [fluxCompetitorAuditStateMachineArn],
  }),
);
const fluxCompetitorAuditStartUrl = fluxCompetitorAuditStartLambda.addFunctionUrl({
  authType: lambda.FunctionUrlAuthType.NONE,
  cors: {
    allowedOrigins: ['*'],
    allowedMethods: [lambda.HttpMethod.POST],
    allowedHeaders: ['Authorization', 'Content-Type'],
  },
});
new lambda.CfnPermission(fluxCompetitorAuditStartLambda.stack, 'AllowPublicFluxCompetitorAuditStartUrlInvoke', {
  action: 'lambda:InvokeFunctionUrl',
  functionName: fluxCompetitorAuditStartLambda.functionName,
  principal: '*',
  functionUrlAuthType: 'NONE',
});
const allowPublicFluxCompetitorAuditStartInvoke = new lambda.CfnPermission(
  fluxCompetitorAuditStartLambda.stack,
  'AllowPublicFluxCompetitorAuditStartInvokeViaUrl',
  {
    action: 'lambda:InvokeFunction',
    functionName: fluxCompetitorAuditStartLambda.functionName,
    principal: '*',
  },
);
allowPublicFluxCompetitorAuditStartInvoke.addPropertyOverride('InvokedViaFunctionUrl', true);

let launchSmartleadMigrationUrlRef: { url: string } | undefined;

if (smartleadMigrationEnabled) {
  const launchSmartleadMigrationLambda = backend.launchSmartleadMigration!.resources
    .lambda as lambda.Function;
  const workerEnvironment = resolveWorkerEnvironment();
  launchSmartleadMigrationLambda.addEnvironment('SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL ?? '');
  launchSmartleadMigrationLambda.addEnvironment('WORKER_ENVIRONMENT', workerEnvironment);
  launchSmartleadMigrationLambda.addEnvironment(
    'SMARTLEAD_MIGRATION_CLUSTER',
    cdk.Fn.importValue(`FurnaceCluster-${workerEnvironment}`),
  );
  // Task definition ARN is published to SSM by infra/workers (avoids CFN export churn on each new revision).
  launchSmartleadMigrationLambda.addEnvironment(
    'SMARTLEAD_MIGRATION_TASK_DEFINITION_PARAM',
    `/furnace/ecs/${workerEnvironment}/smartlead-migration/task-definition-arn`,
  );
  launchSmartleadMigrationLambda.addEnvironment(
    'SMARTLEAD_MIGRATION_SUBNET_IDS',
    cdk.Fn.importValue(`FurnaceWorkerPublicSubnets-${workerEnvironment}`),
  );
  launchSmartleadMigrationLambda.addEnvironment(
    'SMARTLEAD_MIGRATION_SECURITY_GROUP_ID',
    cdk.Fn.importValue(`FurnaceWorkerSecurityGroup-${workerEnvironment}`),
  );
  launchSmartleadMigrationLambda.addToRolePolicy(new iam.PolicyStatement({
    sid: 'AllowRunSmartleadMigrationTasks',
    actions: [
      'ecs:RunTask',
    ],
    resources: ['*'],
  }));
  launchSmartleadMigrationLambda.addToRolePolicy(new iam.PolicyStatement({
    sid: 'AllowPassSmartleadMigrationTaskRoles',
    actions: [
      'iam:PassRole',
    ],
    resources: ['*'],
  }));
  launchSmartleadMigrationLambda.addToRolePolicy(new iam.PolicyStatement({
    sid: 'AllowSmartleadMigrationParameterStore',
    actions: [
      'ssm:PutParameter',
      'ssm:GetParameter',
      'ssm:GetParameters',
    ],
    resources: ['*'],
  }));
  const launchSmartleadMigrationUrl = launchSmartleadMigrationLambda.addFunctionUrl({
    authType: lambda.FunctionUrlAuthType.NONE,
    cors: {
      allowedOrigins: ['*'],
      allowedMethods: [lambda.HttpMethod.POST],
      allowedHeaders: ['Authorization', 'Content-Type'],
    },
  });
  launchSmartleadMigrationUrlRef = launchSmartleadMigrationUrl;
  new lambda.CfnPermission(launchSmartleadMigrationLambda.stack, 'AllowPublicLaunchSmartleadMigrationUrlInvoke', {
    action: 'lambda:InvokeFunctionUrl',
    functionName: launchSmartleadMigrationLambda.functionName,
    principal: '*',
    functionUrlAuthType: 'NONE',
  });
  const allowPublicLaunchSmartleadMigrationInvoke = new lambda.CfnPermission(
    launchSmartleadMigrationLambda.stack,
    'AllowPublicLaunchSmartleadMigrationInvokeViaUrl',
    {
      action: 'lambda:InvokeFunction',
      functionName: launchSmartleadMigrationLambda.functionName,
      principal: '*',
    },
  );
  allowPublicLaunchSmartleadMigrationInvoke.addPropertyOverride('InvokedViaFunctionUrl', true);
}

// Notification pipeline (SQS → processNotificationEvent Lambda):
// - Default: import queue from infra/workers (export FurnaceNotificationEventsQueueArn-{dev|prod}). Deploy
//   `cd infra/workers && npm run deploy:dev` (or :prod) before Amplify if you use this mode.
// - AMPLIFY_EMBED_NOTIFICATION_QUEUE=true: create the queue in this stack (typical for ampx sandbox).
// - AMPLIFY_NOTIFICATION_QUEUE_ARN=arn:aws:sqs:...: use a specific queue (e.g. copied from AWS console).
const notificationWorkerEnv = resolveWorkerEnvironment();
const embedNotificationQueue = ['true', '1', 'yes'].includes(
  (process.env.AMPLIFY_EMBED_NOTIFICATION_QUEUE ?? '').toLowerCase(),
);
const notificationQueueArnFromEnv = process.env.AMPLIFY_NOTIFICATION_QUEUE_ARN?.trim();

let notificationQueue: sqs.IQueue;
let embeddedNotificationQueue: sqs.Queue | undefined;

if (embedNotificationQueue) {
  embeddedNotificationQueue = new sqs.Queue(backend.stack, 'EmbeddedNotificationEventsQueue', {
    visibilityTimeout: cdk.Duration.seconds(150),
    retentionPeriod: cdk.Duration.days(4),
  });
  notificationQueue = embeddedNotificationQueue;
} else if (notificationQueueArnFromEnv) {
  notificationQueue = sqs.Queue.fromQueueArn(
    backend.stack,
    'ConfiguredNotificationEventsQueue',
    notificationQueueArnFromEnv,
  );
} else {
  notificationQueue = sqs.Queue.fromQueueArn(
    backend.stack,
    'ImportedFurnaceNotificationEventsQueue',
    cdk.Fn.importValue(`FurnaceNotificationEventsQueueArn-${notificationWorkerEnv}`),
  );
}

const processNotificationLambda = backend.processNotificationEvent.resources.lambda as lambda.Function;
processNotificationLambda.addEnvironment('SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL ?? '');
processNotificationLambda.addEnvironment(
  'WEB_APP_ORIGIN',
  process.env.WEB_APP_ORIGIN ?? 'https://build.getfurnace.io',
);
notificationQueue.grantConsumeMessages(processNotificationLambda);
processNotificationLambda.addEventSource(
  new lambdaEventSources.SqsEventSource(notificationQueue, {
    batchSize: 5,
    maxBatchingWindow: cdk.Duration.seconds(5),
    reportBatchItemFailures: true,
  }),
);

const classifyReplyQueue = sqs.Queue.fromQueueArn(
  backend.stack,
  'ImportedFurnaceClassifyReplyQueue',
  cdk.Fn.importValue(`FurnaceClassifyReplyQueueArn-${notificationWorkerEnv}`),
);
const classifyReplyLambda = backend.classifyReply.resources.lambda as lambda.Function;
classifyReplyLambda.addEnvironment('SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL ?? '');
classifyReplyQueue.grantConsumeMessages(classifyReplyLambda);
classifyReplyLambda.addEventSource(
  new lambdaEventSources.SqsEventSource(classifyReplyQueue, {
    batchSize: 5,
    maxBatchingWindow: cdk.Duration.seconds(5),
    reportBatchItemFailures: true,
  }),
);

const customOutputs: Record<string, string> = {
  fetchEmailAttachmentUrl: fetchAttachmentUrl.url,
  sendTransactionalEmailUrl: sendTransactionalEmailUrl.url,
  sendFluxQuizSubmissionUrl: sendFluxQuizSubmissionUrl.url,
  testMailboxConnectionUrl: testMailboxUrl.url,
  platformCommerceUrl: platformCommerceUrl.url,
  stripeWebhookUrl: stripeWebhookUrl.url,
  foundryRegistryApiUrl: foundryRegistryUrl.url,
  clientApiFunctionUrl: clientApiUrl.url,
  clientApiCloudFrontUrl: `https://${clientApiDistribution.distributionDomainName}`,
  clientApiUrl: resolvedClientApiBaseUrl,
  clientApiDocsUrl: `${resolvedClientApiBaseUrl}/docs`,
  clientApiOpenApiUrl: `${resolvedClientApiBaseUrl}/openapi.json`,
  clientApiWebhookQueueUrl: webhookQueue.queueUrl,
  clientApiImportQueueUrl: importQueue.queueUrl,
  foundryNormalizeStateMachineArn: foundryNormalizeStateMachineArn,
  foundryAutolinkStateMachineArn: foundryAutolinkStateMachineArn,
  foundryContactEnrichmentStateMachineArn: foundryContactEnrichmentStateMachineArn,
  foundryStateMatchingStateMachineArn: foundryStateMatchingStateMachineArn,
  fluxGenerateUrl: fluxGenerateUrl.url,
  fluxEditorChatUrl: fluxEditorChatUrl.url,
  googlePlacesUrl: googlePlacesUrl.url,
  apolloEnrichUrl: apolloEnrichUrl.url,
  fluxCompetitorAuditStartUrl: fluxCompetitorAuditStartUrl.url,
  categorizerPreviewUrl: categorizerPreviewUrl.url,
};
if (launchSmartleadMigrationUrlRef) {
  customOutputs.launchSmartleadMigrationUrl = launchSmartleadMigrationUrlRef.url;
}
if (embeddedNotificationQueue) {
  customOutputs.notificationEventsQueueUrl = embeddedNotificationQueue.queueUrl;
}

backend.addOutput({
  custom: customOutputs,
});

// Grant enrollmentMetric Lambda permission to publish CloudWatch metrics
// This can still be useful for monitoring, even though scheduler auto-scaling is handled separately
const enrollmentMetricLambda = backend.enrollmentMetric.resources.lambda;
enrollmentMetricLambda.addToRolePolicy(new iam.PolicyStatement({
  sid: 'AllowCloudWatchPutMetricData',
  actions: [
    'cloudwatch:PutMetricData',
  ],
  resources: ['*'], // PutMetricData requires '*' resource
}));
