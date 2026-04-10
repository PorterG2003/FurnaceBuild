import { config } from 'dotenv';
import { defineBackend } from '@aws-amplify/backend';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cdk from 'aws-cdk-lib';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as sfnTasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { sendInvitationEmail } from './functions/sendInvitationEmail/resource';
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
import { processNotificationEvent } from './functions/processNotificationEvent/resource';

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
  sendInvitationEmail,
  testMailboxConnection,
  enrollmentMetric,
  fetchEmailAttachment,
  foundryRegistryApi,
  foundryNormalizeJob,
  foundryAutolinkJob,
  foundryContactEnrichmentJob,
  foundryStateMatchingJob,
  foundryWebsiteVerificationJob,
  processNotificationEvent,
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

// Foundry: normalize/autolink workers (Step Functions) + registry HTTP API (Function URL)
const workerEnvironment = resolveWorkerEnvironment();
const foundryNormalizeLambda = backend.foundryNormalizeJob.resources.lambda as lambda.Function;
const foundryAutolinkLambda = backend.foundryAutolinkJob.resources.lambda as lambda.Function;
const foundryContactEnrichmentLambda = backend.foundryContactEnrichmentJob.resources.lambda as lambda.Function;
const foundryNormalizeStack = foundryNormalizeLambda.stack;
foundryNormalizeLambda.addEnvironment('LEADS_SUPABASE_URL', process.env.LEADS_SUPABASE_URL ?? '');
foundryAutolinkLambda.addEnvironment('LEADS_SUPABASE_URL', process.env.LEADS_SUPABASE_URL ?? '');
foundryContactEnrichmentLambda.addEnvironment('LEADS_SUPABASE_URL', process.env.LEADS_SUPABASE_URL ?? '');

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
const websiteVerificationTaskRoleArn = cdk.Fn.importValue(
  `FurnaceWebsiteVerificationTaskRole-${workerEnvironment}`,
);
const utahScraperTaskDefinitionArn = ssm.StringParameter.valueForStringParameter(
  foundryNormalizeStack,
  `/furnace/ecs/${workerEnvironment}/utah-scraper/task-definition-arn`,
);
const floridaScraperTaskDefinitionArn = ssm.StringParameter.valueForStringParameter(
  foundryNormalizeStack,
  `/furnace/ecs/${workerEnvironment}/florida-scraper/task-definition-arn`,
);
const websiteVerificationTaskDefinitionArn = ssm.StringParameter.valueForStringParameter(
  foundryNormalizeStack,
  `/furnace/ecs/${workerEnvironment}/website-verification/task-definition-arn`,
);

function buildStateScraperRunTask(
  id: string,
  containerName: string,
  taskDefinitionArn: string,
): sfn.CustomState {
  const itemsPath = containerName === 'utah-scraper' ? '$.utahBatches' : '$.floridaBatches';
  const taskStateName = containerName === 'utah-scraper' ? 'RunUtahBatch' : 'RunFloridaBatch';
  return new sfn.CustomState(foundryNormalizeStack, id, {
    stateJson: {
      Type: 'Map',
      ItemsPath: itemsPath,
      MaxConcurrency: 1,
      Parameters: {
        'jobId.$': '$.jobId',
        'reconciliationRunId.$': '$.reconciliationRunId',
        'companyIds.$': '$$.Map.Item.Value',
      },
      Iterator: {
        StartAt: taskStateName,
        States: {
          [taskStateName]: {
            Type: 'Task',
            Resource: 'arn:aws:states:::ecs:runTask.sync',
            Parameters: {
              LaunchType: 'FARGATE',
              Cluster: workerClusterName,
              TaskDefinition: taskDefinitionArn,
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
  utahScraperTaskDefinitionArn,
);
const foundryStateMatchingFloridaTask = buildStateScraperRunTask(
  'FoundryStateMatchingRunFloridaTask',
  'florida-scraper',
  floridaScraperTaskDefinitionArn,
);
const foundryStateMatchingSkipUtah = new sfn.Pass(foundryNormalizeStack, 'FoundryStateMatchingSkipUtah');
const foundryStateMatchingSkipFlorida = new sfn.Pass(foundryNormalizeStack, 'FoundryStateMatchingSkipFlorida');
const foundryStateMatchingUtahChoice = new sfn.Choice(foundryNormalizeStack, 'FoundryStateMatchingUtahChoice')
  .when(sfn.Condition.numberGreaterThan('$.utahCount', 0), foundryStateMatchingUtahTask)
  .otherwise(foundryStateMatchingSkipUtah);
const foundryStateMatchingFloridaChoice = new sfn.Choice(foundryNormalizeStack, 'FoundryStateMatchingFloridaChoice')
  .when(sfn.Condition.numberGreaterThan('$.floridaCount', 0), foundryStateMatchingFloridaTask)
  .otherwise(foundryStateMatchingSkipFlorida);
const foundryStateMatchingParallel = new sfn.Parallel(foundryNormalizeStack, 'FoundryStateMatchingParallel');
foundryStateMatchingParallel.branch(foundryStateMatchingUtahChoice);
foundryStateMatchingParallel.branch(foundryStateMatchingFloridaChoice);

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
    resources: [ecsTaskExecutionRoleArn, utahScraperTaskRoleArn, floridaScraperTaskRoleArn],
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

const foundryWebsiteVerificationRunTask = new sfn.CustomState(foundryNormalizeStack, 'FoundryWebsiteVerificationRunTask', {
  stateJson: {
    Type: 'Task',
    Resource: 'arn:aws:states:::ecs:runTask.sync',
    ResultPath: '$.ecsTask',
    Parameters: {
      LaunchType: 'FARGATE',
      Cluster: workerClusterName,
      TaskDefinition: websiteVerificationTaskDefinitionArn,
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
            Environment: [{ Name: 'JOB_ID', 'Value.$': '$.jobId' }],
          },
        ],
      },
    },
  },
});
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
foundryWebsiteVerificationRunTask.addCatch(foundryWebsiteVerificationFail, {
  errors: [sfn.Errors.ALL],
  resultPath: '$.error',
});
foundryWebsiteVerificationFinalize.addCatch(foundryWebsiteVerificationFail, {
  errors: [sfn.Errors.ALL],
  resultPath: '$.error',
});
foundryWebsiteVerificationRunTask.next(foundryWebsiteVerificationFinalize);

const foundryWebsiteVerificationStateMachineName = `foundry-website-verification-${workerEnvironment}`;
const foundryWebsiteVerificationStateMachine = new sfn.StateMachine(
  foundryNormalizeStack,
  'FoundryWebsiteVerificationSm',
  {
    stateMachineName: foundryWebsiteVerificationStateMachineName,
    definitionBody: sfn.DefinitionBody.fromChainable(foundryWebsiteVerificationRunTask),
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

const customOutputs: Record<string, string> = {
  fetchEmailAttachmentUrl: fetchAttachmentUrl.url,
  sendInvitationEmailUrl: sendInvitationUrl.url,
  testMailboxConnectionUrl: testMailboxUrl.url,
  foundryRegistryApiUrl: foundryRegistryUrl.url,
  foundryNormalizeStateMachineArn: foundryNormalizeStateMachineArn,
  foundryAutolinkStateMachineArn: foundryAutolinkStateMachineArn,
  foundryContactEnrichmentStateMachineArn: foundryContactEnrichmentStateMachineArn,
  foundryStateMatchingStateMachineArn: foundryStateMatchingStateMachineArn,
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
