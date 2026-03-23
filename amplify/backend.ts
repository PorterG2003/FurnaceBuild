import { config } from 'dotenv';
import { defineBackend } from '@aws-amplify/backend';

// Load .env.local so EXPO_PUBLIC_SUPABASE_URL is available for Lambdas at synth time
config({ path: '.env.local' });
config();
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as cdk from 'aws-cdk-lib';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { sendInvitationEmail } from './functions/sendInvitationEmail/resource';
import { testMailboxConnection } from './functions/testMailboxConnection/resource';
import { enrollmentMetric } from './functions/enrollmentMetric/resource';
import { fetchEmailAttachment } from './functions/fetchEmailAttachment/resource';
import { launchSmartleadMigration } from './functions/launchSmartleadMigration/resource';
import { foundryRegistryApi } from './functions/foundryRegistryApi/resource';
import { foundryNormalizeJob } from './functions/foundryNormalizeJob/resource';

/**
 * @see https://docs.amplify.aws/react/build-a-backend/ to add storage, functions, and more
 *
 * Note: ECS workers have been moved to a separate CDK stack in infra/workers/
 * This keeps Amplify deployments fast and avoids CloudFormation timeout issues.
 */
const backend = defineBackend({
  auth,
  data,
  sendInvitationEmail,
  testMailboxConnection,
  enrollmentMetric,
  fetchEmailAttachment,
  launchSmartleadMigration,
  foundryRegistryApi,
  foundryNormalizeJob,
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

// Send invitation email: Function URL + Supabase auth.getUser() for token verification
const sendInvitationLambda = backend.sendInvitationEmail.resources.lambda as lambda.Function;
sendInvitationLambda.addEnvironment('SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL ?? '');
const sendInvitationUrl = sendInvitationLambda.addFunctionUrl({
  authType: lambda.FunctionUrlAuthType.NONE,
  cors: {
    allowedOrigins: ['*'],
    allowedMethods: [lambda.HttpMethod.POST],
    allowedHeaders: ['Authorization', 'Content-Type'],
  },
});
new lambda.CfnPermission(sendInvitationLambda.stack, 'AllowPublicSendInvitationUrlInvoke', {
  action: 'lambda:InvokeFunctionUrl',
  functionName: sendInvitationLambda.functionName,
  principal: '*',
  functionUrlAuthType: 'NONE',
});
const allowPublicSendInvitationInvoke = new lambda.CfnPermission(sendInvitationLambda.stack, 'AllowPublicSendInvitationInvokeViaUrl', {
  action: 'lambda:InvokeFunction',
  functionName: sendInvitationLambda.functionName,
  principal: '*',
});
allowPublicSendInvitationInvoke.addPropertyOverride('InvokedViaFunctionUrl', true);

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

const launchSmartleadMigrationLambda = backend.launchSmartleadMigration.resources.lambda as lambda.Function;
const workerEnvironment = resolveWorkerEnvironment();
launchSmartleadMigrationLambda.addEnvironment('SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL ?? '');
launchSmartleadMigrationLambda.addEnvironment('WORKER_ENVIRONMENT', workerEnvironment);
launchSmartleadMigrationLambda.addEnvironment(
  'SMARTLEAD_MIGRATION_CLUSTER',
  cdk.Fn.importValue(`FurnaceCluster-${workerEnvironment}`),
);
launchSmartleadMigrationLambda.addEnvironment(
  'SMARTLEAD_MIGRATION_TASK_DEFINITION',
  cdk.Fn.importValue(`FurnaceSmartleadMigrationTaskDefinition-${workerEnvironment}`),
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

// Foundry registry API: Function URL + JWT + main-DB foundry flag + leads Supabase reads
const foundryRegistryLambda = backend.foundryRegistryApi.resources.lambda as lambda.Function;
foundryRegistryLambda.addEnvironment('SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL ?? '');
foundryRegistryLambda.addEnvironment('LEADS_SUPABASE_URL', process.env.LEADS_SUPABASE_URL ?? '');
// Lambda Function URL CORS AllowMethods does not accept OPTIONS (CloudFormation validation fails).
// Preflight is still handled by the runtime / GET allowance; the handler also returns 204 for OPTIONS.
const foundryRegistryUrl = foundryRegistryLambda.addFunctionUrl({
  authType: lambda.FunctionUrlAuthType.NONE,
  cors: {
    allowedOrigins: ['*'],
    allowedMethods: [lambda.HttpMethod.GET, lambda.HttpMethod.POST],
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

// Foundry async normalize: worker Lambda (Amplify) + Step Functions loop in same stack
const foundryNormalizeLambda = backend.foundryNormalizeJob.resources.lambda as lambda.Function;
foundryNormalizeLambda.addEnvironment('LEADS_SUPABASE_URL', process.env.LEADS_SUPABASE_URL ?? '');

const normalizeSfnStack = cdk.Stack.of(foundryNormalizeLambda);

const foundryNormalizeChunkTask = new tasks.LambdaInvoke(normalizeSfnStack, 'FoundryNormalizeChunk', {
  lambdaFunction: foundryNormalizeLambda,
  payload: sfn.TaskInput.fromObject({
    action: 'chunk',
    jobId: sfn.JsonPath.stringAt('$.jobId'),
    ingestionRunId: sfn.JsonPath.stringAt('$.ingestionRunId'),
    batchSize: sfn.JsonPath.numberAt('$.batchSize'),
    cursor: sfn.JsonPath.stringAt('$.cursor'),
  }),
  resultPath: '$.chunkOut',
  payloadResponseOnly: true,
});

const foundryNormalizeFinalizeTask = new tasks.LambdaInvoke(normalizeSfnStack, 'FoundryFinalizeNormalizeJob', {
  lambdaFunction: foundryNormalizeLambda,
  payload: sfn.TaskInput.fromObject({
    action: 'finalize',
    jobId: sfn.JsonPath.stringAt('$.jobId'),
  }),
  resultPath: '$.finalizeOut',
  payloadResponseOnly: true,
});

const foundryNormalizeFailNotify = new tasks.LambdaInvoke(normalizeSfnStack, 'FoundryFailNormalizeJob', {
  lambdaFunction: foundryNormalizeLambda,
  payload: sfn.TaskInput.fromObject({
    action: 'fail',
    jobId: sfn.JsonPath.stringAt('$.jobId'),
    message: 'Normalize chunk failed',
  }),
  payloadResponseOnly: true,
}).next(
  new sfn.Fail(normalizeSfnStack, 'FoundryNormalizeFailed', {
    error: 'NormalizeChunkError',
    cause: 'Lambda or runtime error',
  }),
);

foundryNormalizeChunkTask.addCatch(foundryNormalizeFailNotify, { errors: ['States.ALL'] });

const foundryNormalizeAdvanceCursor = new sfn.Pass(normalizeSfnStack, 'FoundryNormalizeAdvanceCursor', {
  parameters: {
    'jobId.$': '$.jobId',
    'ingestionRunId.$': '$.ingestionRunId',
    'batchSize.$': '$.batchSize',
    'cursor.$': '$.chunkOut.nextCursor',
  },
});

const foundryNormalizeMoreChunks = new sfn.Choice(normalizeSfnStack, 'FoundryNormalizeMoreChunks')
  .when(sfn.Condition.booleanEquals('$.chunkOut.done', true), foundryNormalizeFinalizeTask)
  .otherwise(foundryNormalizeAdvanceCursor);

foundryNormalizeChunkTask.next(foundryNormalizeMoreChunks);
foundryNormalizeAdvanceCursor.next(foundryNormalizeChunkTask);

foundryNormalizeFinalizeTask.next(new sfn.Succeed(normalizeSfnStack, 'FoundryNormalizeJobSucceeded'));

const foundryNormalizeSmLogGroup = new logs.LogGroup(normalizeSfnStack, 'FoundryNormalizeSmLogs', {
  retention: logs.RetentionDays.TWO_WEEKS,
  removalPolicy: cdk.RemovalPolicy.DESTROY,
});

const foundryNormalizeStateMachine = new sfn.StateMachine(normalizeSfnStack, 'FoundryNormalizeIngestionSm', {
  stateMachineName: `foundry-normalize-ingestion-${resolveWorkerEnvironment()}`,
  definitionBody: sfn.DefinitionBody.fromChainable(foundryNormalizeChunkTask),
  tracingEnabled: true,
  logs: {
    destination: foundryNormalizeSmLogGroup,
    level: sfn.LogLevel.ERROR,
  },
});

foundryRegistryLambda.addEnvironment(
  'FOUNDRY_NORMALIZE_STATE_MACHINE_ARN',
  foundryNormalizeStateMachine.stateMachineArn,
);
foundryRegistryLambda.addToRolePolicy(
  new iam.PolicyStatement({
    sid: 'FoundryStartNormalizeStepFunction',
    actions: ['states:StartExecution'],
    resources: [foundryNormalizeStateMachine.stateMachineArn],
  }),
);

backend.addOutput({
  custom: {
    fetchEmailAttachmentUrl: fetchAttachmentUrl.url,
    sendInvitationEmailUrl: sendInvitationUrl.url,
    testMailboxConnectionUrl: testMailboxUrl.url,
    launchSmartleadMigrationUrl: launchSmartleadMigrationUrl.url,
    foundryRegistryApiUrl: foundryRegistryUrl.url,
    foundryNormalizeStateMachineArn: foundryNormalizeStateMachine.stateMachineArn,
  },
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
