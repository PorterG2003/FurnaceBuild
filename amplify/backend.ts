import { defineBackend } from '@aws-amplify/backend';
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { sendInvitationEmail } from './functions/sendInvitationEmail/resource';
import { scheduler } from './functions/scheduler/resource';
import { sendTestMessage } from './functions/sendTestMessage/resource';
import { inboxChecker } from './functions/inboxChecker/resource';

/**
 * @see https://docs.amplify.aws/react/build-a-backend/ to add storage, functions, and more
 */
const backend = defineBackend({
  auth,
  data,
  sendInvitationEmail,
  scheduler,
  sendTestMessage,
  inboxChecker,
});

// Grant scheduler Lambda permission to send messages to SQS queue
// Queue ARN: arn:aws:sqs:us-west-2:686255981838:furnace-send-queue
const schedulerLambda = backend.scheduler.resources.lambda;

const sqsPolicyStatement = new iam.PolicyStatement({
  sid: 'AllowSendMessageToSendQueue',
  actions: [
    'sqs:SendMessage',
    'sqs:GetQueueUrl',
    'sqs:GetQueueAttributes',
  ],
  resources: ['arn:aws:sqs:us-west-2:686255981838:furnace-send-queue'],
});

schedulerLambda.addToRolePolicy(sqsPolicyStatement);

// Grant sendTestMessage Lambda permission to send messages to SQS queue
const sendTestMessageLambda = backend.sendTestMessage.resources.lambda;
sendTestMessageLambda.addToRolePolicy(sqsPolicyStatement);

// Set SEND_QUEUE_URL environment variable for sendTestMessage Lambda
// Read from process.env during CDK synthesis (set before running npx ampx sandbox)
const sendQueueUrlForLambda = process.env.SEND_QUEUE_URL;
if (sendQueueUrlForLambda) {
  // Use addPropertyOverride to set the environment variable
  const cfnFunction = sendTestMessageLambda.node.defaultChild as lambda.CfnFunction;
  if (cfnFunction) {
    // Override the SEND_QUEUE_URL environment variable
    cfnFunction.addPropertyOverride('Environment.Variables.SEND_QUEUE_URL', sendQueueUrlForLambda);
  }
} else {
  console.warn('WARNING: SEND_QUEUE_URL environment variable is not set. Set it before running npx ampx sandbox');
}

// Create ECR repository for send worker Docker images
const sendWorkerRepo = new ecr.Repository(backend.stack, 'SendWorkerRepo', {
  repositoryName: 'furnace/send-worker',
  imageScanOnPush: true,
  lifecycleRules: [
    {
      maxImageCount: 10, // Keep last 10 images
    },
  ],
});

// ============================================
// ECS Cluster & Service for Send Workers
// ============================================

// Create VPC with public subnets (simpler and cheaper than NAT Gateway for initial setup)
const vpc = new ec2.Vpc(backend.stack, 'FurnaceVpc', {
  maxAzs: 2, // Use 2 availability zones for high availability
  natGateways: 0, // No NAT Gateway - use public subnets (cheaper, ~$32/month savings)
});

// Create ECS Cluster
const cluster = new ecs.Cluster(backend.stack, 'FurnaceCluster', {
  clusterName: 'furnace-cluster',
  vpc: vpc,
  containerInsights: true, // Enable CloudWatch Container Insights
});

// Create CloudWatch Log Group
const logGroup = new logs.LogGroup(backend.stack, 'SendWorkerLogGroup', {
  logGroupName: '/ecs/furnace/send-worker',
  retention: logs.RetentionDays.ONE_WEEK,
  removalPolicy: cdk.RemovalPolicy.DESTROY,
});

// Reference existing SQS queue (already created manually)
const sendQueue = sqs.Queue.fromQueueArn(
  backend.stack,
  'SendQueueRef',
  'arn:aws:sqs:us-west-2:686255981838:furnace-send-queue'
);

// Create IAM task role (for application permissions)
const taskRole = new iam.Role(backend.stack, 'SendWorkerTaskRole', {
  assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
  description: 'Role for ECS send worker tasks',
});

// Grant SQS permissions
taskRole.addToPolicy(new iam.PolicyStatement({
  sid: 'AllowSQSAccess',
  actions: [
    'sqs:ReceiveMessage',
    'sqs:DeleteMessage',
    'sqs:GetQueueAttributes',
    'sqs:GetQueueUrl',
  ],
  resources: [sendQueue.queueArn],
}));

// Grant CloudWatch Logs permissions
taskRole.addToPolicy(new iam.PolicyStatement({
  sid: 'AllowCloudWatchLogs',
  actions: [
    'logs:CreateLogStream',
    'logs:PutLogEvents',
  ],
  resources: [logGroup.logGroupArn + ':*'],
}));

// Grant SSM Parameter Store read permissions (for SUPABASE_SERVICE_KEY secret)
// The task role is what the application code uses, so it needs permission to read from Parameter Store
// Note: Wildcards in the middle of hierarchical paths may not work, so we grant broader access
taskRole.addToPolicy(new iam.PolicyStatement({
  sid: 'AllowSSMParameterAccess',
  actions: [
    'ssm:GetParameters',
    'ssm:GetParameter',
  ],
  resources: [
    // Grant access to all Amplify parameters (broader than needed, but ensures access)
    // The actual parameter path is: /amplify/furnacebuild/porter-sandbox-387f79dcc1/SUPABASE_SERVICE_KEY
    // Wildcards in hierarchical paths are tricky, so we use a broader pattern
    `arn:aws:ssm:${cdk.Stack.of(backend.stack).region}:${cdk.Stack.of(backend.stack).account}:parameter/amplify/*`,
  ],
}));

// Create task execution role (for ECS service permissions - pulling images, writing logs)
const taskExecutionRole = new iam.Role(backend.stack, 'SendWorkerTaskExecutionRole', {
  assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
  managedPolicies: [
    iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
  ],
});

// Grant ECR pull permissions
taskExecutionRole.addToPolicy(new iam.PolicyStatement({
  sid: 'AllowECRPull',
  actions: [
    'ecr:GetAuthorizationToken',
    'ecr:BatchCheckLayerAvailability',
    'ecr:GetDownloadUrlForLayer',
    'ecr:BatchGetImage',
  ],
  resources: ['*'], // ECR GetAuthorizationToken requires '*' resource
}));

// Grant SSM Parameter Store read permissions (for SUPABASE_SERVICE_KEY secret only)
// Amplify Gen 2 stores secrets as SSM parameters. The path format varies:
// Sandbox: /amplify/{app-name}/{sandbox-id}/{secretName}
// Production: /amplify/shared/{app-id}/{secretName}
taskExecutionRole.addToPolicy(new iam.PolicyStatement({
  sid: 'AllowSSMParameterAccess',
  actions: [
    'ssm:GetParameters',
    'ssm:GetParameter',
  ],
  resources: [
    // Grant access to Amplify secret parameters (for SUPABASE_SERVICE_KEY)
    // Covers both sandbox and production paths
    cdk.Stack.of(backend.stack).formatArn({
      service: 'ssm',
      resource: 'parameter',
      resourceName: '/amplify/*/SUPABASE_SERVICE_KEY',
    }),
    // Also grant access to shared path for production
    cdk.Stack.of(backend.stack).formatArn({
      service: 'ssm',
      resource: 'parameter',
      resourceName: '/amplify/shared/*/SUPABASE_SERVICE_KEY',
    }),
  ],
}));

// Create Fargate Task Definition
const taskDefinition = new ecs.FargateTaskDefinition(backend.stack, 'SendWorkerTaskDef', {
  memoryLimitMiB: 1024, // 1 GB
  cpu: 512, // 0.5 vCPU
  taskRole: taskRole,
  executionRole: taskExecutionRole,
});

// Determine SUPABASE_SERVICE_KEY parameter path based on environment
// The worker will fetch this secret from Parameter Store at startup
// This avoids CloudFormation validation issues with hierarchical paths
const stack = cdk.Stack.of(backend.stack);
const stackName = stack.stackName;

const supabaseServiceKeyParamPath = stackName.includes('sandbox')
  ? '/amplify/furnacebuild/porter-sandbox-387f79dcc1/SUPABASE_SERVICE_KEY'
  : '/amplify/shared/d1jtp0rz0l9mcn/SUPABASE_SERVICE_KEY';

// Add container to task definition
// Read environment variables from build environment (set these before running npx ampx sandbox)
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const sendQueueUrl = process.env.SEND_QUEUE_URL;
const awsRegion = process.env.AWS_REGION || 'us-west-2'; // Default to us-west-2 if not set

if (!supabaseUrl) {
  throw new Error('EXPO_PUBLIC_SUPABASE_URL environment variable is required. Set it before running npx ampx sandbox');
}

if (!sendQueueUrl) {
  throw new Error('SEND_QUEUE_URL environment variable is required. Set it before running npx ampx sandbox');
}

const container = taskDefinition.addContainer('send-worker', {
  image: ecs.ContainerImage.fromEcrRepository(sendWorkerRepo, 'latest'),
  logging: ecs.LogDrivers.awsLogs({
    streamPrefix: 'send-worker',
    logGroup: logGroup,
  }),
  environment: {
    AWS_REGION: awsRegion,
    // Environment variables (not sensitive - public URLs)
    // Values are read from process.env during CDK synthesis
    SUPABASE_URL: supabaseUrl,
    SEND_QUEUE_URL: sendQueueUrl,
    // Parameter path for SUPABASE_SERVICE_KEY - worker will fetch from Parameter Store at startup
    // This avoids CloudFormation validation issues with hierarchical paths
    SUPABASE_SERVICE_KEY_PARAM_PATH: supabaseServiceKeyParamPath,
  },
});

// Create ECS Service
const service = new ecs.FargateService(backend.stack, 'SendWorkerService', {
  cluster: cluster,
  taskDefinition: taskDefinition,
  desiredCount: 2, // Start with 2 tasks
  assignPublicIp: true, // Needed for SMTP (using public subnets, no NAT Gateway)
  vpcSubnets: {
    subnetType: ec2.SubnetType.PUBLIC, // Public subnets for internet access
  },
  // Note: Logging is configured in the task definition container, not at service level
});

// Auto-scaling based on SQS queue depth
const scaling = service.autoScaleTaskCount({
  minCapacity: 1,
  maxCapacity: 20,
});

// Scale based on approximate number of messages in queue
scaling.scaleOnMetric('QueueDepth', {
  metric: sendQueue.metricApproximateNumberOfMessagesVisible(),
  scalingSteps: [
    { upper: 10, change: -1 },   // Scale down if < 10 messages
    { lower: 50, change: +1 },   // Scale up if > 50 messages
    { lower: 100, change: +2 },  // Scale up more if > 100 messages
    { lower: 500, change: +5 },  // Scale up aggressively if > 500 messages
  ],
});
