import { defineBackend } from '@aws-amplify/backend';
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { sendInvitationEmail } from './functions/sendInvitationEmail/resource';
import { inboxChecker } from './functions/inboxChecker/resource';
import { enrollmentMetric } from './functions/enrollmentMetric/resource';

/**
 * @see https://docs.amplify.aws/react/build-a-backend/ to add storage, functions, and more
 */
const backend = defineBackend({
  auth,
  data,
  sendInvitationEmail,
  inboxChecker,
  enrollmentMetric,
});

// Get stack name for unique resource naming (ECR repos and log groups must be unique per account)
const stack = cdk.Stack.of(backend.stack);
const stackName = stack.stackName;
// Extract a short identifier from stack name (last part after last dash, or use stack ID)
const stackId = stackName.split('-').pop() || stackName.replace(/[^a-zA-Z0-9]/g, '').substring(0, 8);

// Create ECR repository for send worker Docker images
const sendWorkerRepo = new ecr.Repository(backend.stack, 'SendWorkerRepo', {
  repositoryName: `furnace/send-worker-${stackId}`,
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
  clusterName: `furnace-cluster-${stackId}`,
  vpc: vpc,
  containerInsights: true, // Enable CloudWatch Container Insights
});

// Create CloudWatch Log Group
const logGroup = new logs.LogGroup(backend.stack, 'SendWorkerLogGroup', {
  logGroupName: `/ecs/furnace/send-worker-${stackId}`,
  retention: logs.RetentionDays.ONE_WEEK,
  removalPolicy: cdk.RemovalPolicy.DESTROY,
});

// Create IAM task role (for application permissions)
const taskRole = new iam.Role(backend.stack, 'SendWorkerTaskRole', {
  assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
  description: 'Role for ECS send worker tasks',
});

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

const supabaseServiceKeyParamPath = stackName.includes('sandbox')
  ? '/amplify/furnacebuild/porter-sandbox-387f79dcc1/SUPABASE_SERVICE_KEY'
  : '/amplify/shared/d1jtp0rz0l9mcn/SUPABASE_SERVICE_KEY';

// Add container to task definition
// Read environment variables from build environment (set these before running npx ampx sandbox)
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const awsRegion = process.env.AWS_REGION || 'us-west-2'; // Default to us-west-2 if not set

if (!supabaseUrl) {
  throw new Error('EXPO_PUBLIC_SUPABASE_URL environment variable is required. Set it before running npx ampx sandbox');
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

// Auto-scaling disabled - send workers poll database directly
// TODO: Implement database-based scaling if needed (e.g., based on pending message_jobs count)
// const scaling = service.autoScaleTaskCount({
//   minCapacity: 1,
//   maxCapacity: 20,
// });

// ============================================
// ECS Service for Scheduler Workers
// ============================================

// Create ECR repository for scheduler worker Docker images
const schedulerWorkerRepo = new ecr.Repository(backend.stack, 'SchedulerWorkerRepo', {
  repositoryName: `furnace/scheduler-worker-${stackId}`,
  imageScanOnPush: true,
  lifecycleRules: [
    {
      maxImageCount: 10, // Keep last 10 images
    },
  ],
});

// Create CloudWatch Log Group for scheduler worker
const schedulerWorkerLogGroup = new logs.LogGroup(backend.stack, 'SchedulerWorkerLogGroup', {
  logGroupName: `/ecs/furnace/scheduler-worker-${stackId}`,
  retention: logs.RetentionDays.ONE_WEEK,
  removalPolicy: cdk.RemovalPolicy.DESTROY,
});

// Create IAM task role for scheduler worker (for application permissions)
const schedulerWorkerTaskRole = new iam.Role(backend.stack, 'SchedulerWorkerTaskRole', {
  assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
  description: 'Role for ECS scheduler worker tasks',
});

// SQS permissions removed - scheduler workers create message_jobs directly in database

// Grant CloudWatch Logs permissions
schedulerWorkerTaskRole.addToPolicy(new iam.PolicyStatement({
  sid: 'AllowCloudWatchLogs',
  actions: [
    'logs:CreateLogStream',
    'logs:PutLogEvents',
  ],
  resources: [schedulerWorkerLogGroup.logGroupArn + ':*'],
}));

// Grant SSM Parameter Store read permissions (for SUPABASE_SERVICE_KEY secret)
schedulerWorkerTaskRole.addToPolicy(new iam.PolicyStatement({
  sid: 'AllowSSMParameterAccess',
  actions: [
    'ssm:GetParameters',
    'ssm:GetParameter',
  ],
  resources: [
    // Grant access to all Amplify parameters (broader than needed, but ensures access)
    `arn:aws:ssm:${cdk.Stack.of(backend.stack).region}:${cdk.Stack.of(backend.stack).account}:parameter/amplify/*`,
  ],
}));

// Create Fargate Task Definition for scheduler worker
const schedulerWorkerTaskDefinition = new ecs.FargateTaskDefinition(backend.stack, 'SchedulerWorkerTaskDef', {
  memoryLimitMiB: 1024, // 1 GB
  cpu: 512, // 0.5 vCPU
  taskRole: schedulerWorkerTaskRole,
  executionRole: taskExecutionRole, // Reuse execution role from send worker
});

// Add container to scheduler worker task definition
const schedulerWorkerContainer = schedulerWorkerTaskDefinition.addContainer('scheduler-worker', {
  image: ecs.ContainerImage.fromEcrRepository(schedulerWorkerRepo, 'latest'),
  logging: ecs.LogDrivers.awsLogs({
    streamPrefix: 'scheduler-worker',
    logGroup: schedulerWorkerLogGroup,
  }),
  environment: {
    AWS_REGION: awsRegion,
    // Environment variables (not sensitive - public URLs)
    SUPABASE_URL: supabaseUrl,
    // Parameter path for SUPABASE_SERVICE_KEY - worker will fetch from Parameter Store at startup
    SUPABASE_SERVICE_KEY_PARAM_PATH: supabaseServiceKeyParamPath,
  },
});

// Create ECS Service for scheduler worker
const schedulerWorkerService = new ecs.FargateService(backend.stack, 'SchedulerWorkerService', {
  cluster: cluster, // Reuse same cluster as send workers
  taskDefinition: schedulerWorkerTaskDefinition,
  desiredCount: 2, // Start with 2 tasks
  assignPublicIp: true, // Needed for Supabase access (using public subnets, no NAT Gateway)
  vpcSubnets: {
    subnetType: ec2.SubnetType.PUBLIC, // Public subnets for internet access
  },
  healthCheckGracePeriod: cdk.Duration.seconds(60),
});

// Auto-scaling based on enrollment count (will be configured after enrollment metric Lambda is created)
// Note: Auto-scaling requires a CloudWatch custom metric, which will be published by enrollmentMetric Lambda
// For now, we'll add the auto-scaling configuration but it will need the metric to be created first
const schedulerScaling = schedulerWorkerService.autoScaleTaskCount({
  minCapacity: 1,
  maxCapacity: 20,
});

// Configure auto-scaling based on enrollment count metric
// The metric is published by enrollmentMetric Lambda every minute
const enrollmentCountMetric = new cloudwatch.Metric({
  namespace: 'Furnace/Scheduler',
  metricName: 'EnrollmentsReadyToProcess',
  statistic: 'Average',
  period: cdk.Duration.minutes(1),
});

schedulerScaling.scaleOnMetric('EnrollmentCount', {
  metric: enrollmentCountMetric,
  scalingSteps: [
    { upper: 10, change: -1 },   // Scale down if < 10 enrollments
    { lower: 50, change: +1 },   // Scale up if > 50 enrollments
    { lower: 100, change: +2 },  // Scale up more if > 100 enrollments
    { lower: 500, change: +5 },  // Scale up aggressively if > 500 enrollments
  ],
});

// Grant enrollmentMetric Lambda permission to publish CloudWatch metrics
const enrollmentMetricLambda = backend.enrollmentMetric.resources.lambda;
enrollmentMetricLambda.addToRolePolicy(new iam.PolicyStatement({
  sid: 'AllowCloudWatchPutMetricData',
  actions: [
    'cloudwatch:PutMetricData',
  ],
  resources: ['*'], // PutMetricData requires '*' resource
}));
