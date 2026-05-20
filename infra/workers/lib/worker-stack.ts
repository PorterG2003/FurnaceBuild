import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export interface WorkerStackProps extends cdk.StackProps {
  /**
   * Environment name (dev, prod)
   */
  environment: string;
  
  /**
   * Supabase URL for this environment
   */
  supabaseUrl: string;
  
  /**
   * SSM Parameter Store path for SUPABASE_SECRET_KEY
   */
  supabaseSecretKeyParamPath: string;
  
  /**
   * Desired task count for workers
   */
  desiredCount: {
    sendWorker: number;
    schedulerWorker: number;
    inboxCheckerWorker: number;
  };

  /**
   * Optional Slack Incoming Webhook URL for error reporting. When set, workers will post errors to this channel.
   */
  slackErrorWebhookUrl?: string;

  /**
   * Optional: Foundry **leads** Supabase URL for Utah ECS reconciliation (writes registry snapshots / state_entities).
   */
  leadsSupabaseUrl?: string;

  /**
   * Optional: SSM parameter name (with leading slash) for the leads project service_role key.
   * Passed to the Utah container as `LEADS_SUPABASE_SECRET_KEY_PARAM_PATH`; the task fetches at runtime (same pattern as `SUPABASE_SECRET_KEY_PARAM_PATH` on other workers).
   */
  leadsSupabaseSecretParamPath?: string;

  /**
   * Optional: SSM parameter name (with leading slash) for the Foundry OpenRouter API key (website intelligence ECS task).
   * Same Amplify secret name segment: `FOUNDRY_OPENROUTER_API_KEY`.
   */
  foundryOpenRouterApiKeyParamPath?: string;

  /**
   * Optional: SSM path for Google Places / Static Maps API key (same key; Flux competitor audit ECS path).
   * Same Amplify secret segment as `GOOGLE_PLACES_API_KEY` in Amplify.
   */
  googlePlacesApiKeyParamPath?: string;
}

export class WorkerStack extends cdk.Stack {
  public readonly sendWorkerService: ecs.FargateService;
  public readonly schedulerWorkerService: ecs.FargateService;
  public readonly inboxCheckerWorkerService: ecs.FargateService;
  public readonly sendWorkerRepo: ecr.Repository;
  public readonly schedulerWorkerRepo: ecr.Repository;
  public readonly inboxCheckerWorkerRepo: ecr.Repository;
  public readonly smartleadMigrationTaskRepo: ecr.Repository;
  public readonly utahScraperTaskRepo: ecr.Repository;
  public readonly floridaScraperTaskRepo: ecr.Repository;
  public readonly iowaScraperTaskRepo: ecr.Repository;
  public readonly websiteVerificationTaskRepo: ecr.Repository;
  public readonly googleAdsVerificationTaskRepo: ecr.Repository;

  constructor(scope: Construct, id: string, props: WorkerStackProps) {
    super(scope, id, props);

    const {
      environment,
      supabaseUrl,
      supabaseSecretKeyParamPath,
      desiredCount,
      slackErrorWebhookUrl,
      leadsSupabaseUrl,
      leadsSupabaseSecretParamPath,
      foundryOpenRouterApiKeyParamPath,
      googlePlacesApiKeyParamPath,
    } = props;

    if (!supabaseSecretKeyParamPath?.trim()) {
      throw new Error(
        'WorkerStack(' + id + '): supabaseSecretKeyParamPath is required so ECS tasks can fetch SUPABASE_SECRET_KEY from Parameter Store'
      );
    }
    const region = props.env?.region || 'us-west-2';
    const account = props.env?.account;

    // ============================================
    // ECR Repositories
    // ============================================

    // Create ECR repository for send worker
    const sendWorkerRepo = new ecr.Repository(this, 'SendWorkerRepo', {
      repositoryName: `furnace/send-worker-${environment}`,
      imageScanOnPush: true,
      lifecycleRules: [
        {
          maxImageCount: 10, // Keep last 10 images
        },
      ],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create ECR repository for scheduler worker
    const schedulerWorkerRepo = new ecr.Repository(this, 'SchedulerWorkerRepo', {
      repositoryName: `furnace/scheduler-worker-${environment}`,
      imageScanOnPush: true,
      lifecycleRules: [
        {
          maxImageCount: 10, // Keep last 10 images
        },
      ],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create ECR repository for inbox checker worker
    const inboxCheckerWorkerRepo = new ecr.Repository(this, 'InboxCheckerWorkerRepo', {
      repositoryName: `furnace/inbox-checker-worker-${environment}`,
      imageScanOnPush: true,
      lifecycleRules: [
        {
          maxImageCount: 10, // Keep last 10 images
        },
      ],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const smartleadMigrationTaskRepo = new ecr.Repository(this, 'SmartleadMigrationTaskRepo', {
      repositoryName: `furnace/smartlead-migration-task-${environment}`,
      imageScanOnPush: true,
      lifecycleRules: [
        {
          maxImageCount: 10,
        },
      ],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const utahScraperTaskRepo = new ecr.Repository(this, 'UtahScraperTaskRepo', {
      repositoryName: `furnace/utah-scraper-${environment}`,
      imageScanOnPush: true,
      lifecycleRules: [{ maxImageCount: 10 }],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const floridaScraperTaskRepo = new ecr.Repository(this, 'FloridaScraperTaskRepo', {
      repositoryName: `furnace/florida-scraper-${environment}`,
      imageScanOnPush: true,
      lifecycleRules: [{ maxImageCount: 10 }],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const iowaScraperTaskRepo = new ecr.Repository(this, 'IowaScraperTaskRepo', {
      repositoryName: `furnace/iowa-scraper-${environment}`,
      imageScanOnPush: true,
      lifecycleRules: [{ maxImageCount: 10 }],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const websiteVerificationTaskRepo = new ecr.Repository(this, 'WebsiteVerificationTaskRepo', {
      repositoryName: `furnace/website-verification-${environment}`,
      imageScanOnPush: true,
      lifecycleRules: [{ maxImageCount: 10 }],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const googleAdsVerificationTaskRepo = new ecr.Repository(this, 'GoogleAdsVerificationTaskRepo', {
      repositoryName: `furnace/google-ads-verification-${environment}`,
      imageScanOnPush: true,
      lifecycleRules: [{ maxImageCount: 10 }],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.sendWorkerRepo = sendWorkerRepo;
    this.schedulerWorkerRepo = schedulerWorkerRepo;
    this.inboxCheckerWorkerRepo = inboxCheckerWorkerRepo;
    this.smartleadMigrationTaskRepo = smartleadMigrationTaskRepo;
    this.utahScraperTaskRepo = utahScraperTaskRepo;
    this.floridaScraperTaskRepo = floridaScraperTaskRepo;
    this.iowaScraperTaskRepo = iowaScraperTaskRepo;
    this.websiteVerificationTaskRepo = websiteVerificationTaskRepo;
    this.googleAdsVerificationTaskRepo = googleAdsVerificationTaskRepo;

    // ============================================
    // VPC & Networking
    // ============================================

    // Create VPC with public subnets (no NAT Gateway for cost savings)
    const vpc = new ec2.Vpc(this, 'FurnaceVpc', {
      maxAzs: 2, // Use 2 availability zones for high availability
      natGateways: 0, // No NAT Gateway - use public subnets (cheaper, ~$32/month savings)
      enableDnsHostnames: true, // Enable DNS hostnames for public IP resolution
      enableDnsSupport: true, // Enable VPC DNS resolution (required for Supabase API calls)
    });

    // ============================================
    // ECS Cluster
    // ============================================

    const cluster = new ecs.Cluster(this, 'FurnaceCluster', {
      clusterName: `furnace-cluster-${environment}`,
      vpc: vpc,
      containerInsights: true, // Enable CloudWatch Container Insights
    });

    // ============================================
    // CloudWatch Log Groups
    // ============================================

    const sendWorkerLogGroup = new logs.LogGroup(this, 'SendWorkerLogGroup', {
      logGroupName: `/ecs/furnace/send-worker-${environment}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const schedulerWorkerLogGroup = new logs.LogGroup(this, 'SchedulerWorkerLogGroup', {
      logGroupName: `/ecs/furnace/scheduler-worker-${environment}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const inboxCheckerWorkerLogGroup = new logs.LogGroup(this, 'InboxCheckerWorkerLogGroup', {
      logGroupName: `/ecs/furnace/inbox-checker-worker-${environment}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const smartleadMigrationTaskLogGroup = new logs.LogGroup(this, 'SmartleadMigrationTaskLogGroup', {
      logGroupName: `/ecs/furnace/smartlead-migration-task-${environment}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const utahScraperTaskLogGroup = new logs.LogGroup(this, 'UtahScraperTaskLogGroup', {
      logGroupName: `/ecs/furnace/utah-scraper-task-${environment}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const floridaScraperTaskLogGroup = new logs.LogGroup(this, 'FloridaScraperTaskLogGroup', {
      logGroupName: `/ecs/furnace/florida-scraper-task-${environment}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const iowaScraperTaskLogGroup = new logs.LogGroup(this, 'IowaScraperTaskLogGroup', {
      logGroupName: `/ecs/furnace/iowa-scraper-task-${environment}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const websiteVerificationTaskLogGroup = new logs.LogGroup(this, 'WebsiteVerificationTaskLogGroup', {
      logGroupName: `/ecs/furnace/website-verification-task-${environment}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const googleAdsVerificationTaskLogGroup = new logs.LogGroup(this, 'GoogleAdsVerificationTaskLogGroup', {
      logGroupName: `/ecs/furnace/google-ads-verification-task-${environment}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ============================================
    // IAM Roles
    // ============================================

    // Task execution role (for ECS service permissions - pulling images, writing logs)
    const taskExecutionRole = new iam.Role(this, 'TaskExecutionRole', {
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

    // Grant SSM Parameter Store read permissions (for SUPABASE_SECRET_KEY)
    taskExecutionRole.addToPolicy(new iam.PolicyStatement({
      sid: 'AllowSSMParameterAccess',
      actions: [
        'ssm:GetParameters',
        'ssm:GetParameter',
      ],
      resources: [
        // Grant access to Amplify parameters (broader pattern for flexibility)
        `arn:aws:ssm:${region}:${account}:parameter/amplify/*`,
      ],
    }));

    // Send worker task role (for application permissions)
    const sendWorkerTaskRole = new iam.Role(this, 'SendWorkerTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: `Role for ECS send worker tasks (${environment})`,
    });

    // Grant CloudWatch Logs permissions for send worker
    sendWorkerTaskRole.addToPolicy(new iam.PolicyStatement({
      sid: 'AllowCloudWatchLogs',
      actions: [
        'logs:CreateLogStream',
        'logs:PutLogEvents',
      ],
      resources: [sendWorkerLogGroup.logGroupArn + ':*'],
    }));

    // Grant SSM Parameter Store read permissions for send worker
    sendWorkerTaskRole.addToPolicy(new iam.PolicyStatement({
      sid: 'AllowSSMParameterAccess',
      actions: [
        'ssm:GetParameters',
        'ssm:GetParameter',
      ],
      resources: [
        `arn:aws:ssm:${region}:${account}:parameter/amplify/*`,
      ],
    }));

    // Scheduler worker task role (for application permissions)
    const schedulerWorkerTaskRole = new iam.Role(this, 'SchedulerWorkerTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: `Role for ECS scheduler worker tasks (${environment})`,
    });

    // Grant CloudWatch Logs permissions for scheduler worker
    schedulerWorkerTaskRole.addToPolicy(new iam.PolicyStatement({
      sid: 'AllowCloudWatchLogs',
      actions: [
        'logs:CreateLogStream',
        'logs:PutLogEvents',
      ],
      resources: [schedulerWorkerLogGroup.logGroupArn + ':*'],
    }));

    // Grant SSM Parameter Store read permissions for scheduler worker
    schedulerWorkerTaskRole.addToPolicy(new iam.PolicyStatement({
      sid: 'AllowSSMParameterAccess',
      actions: [
        'ssm:GetParameters',
        'ssm:GetParameter',
      ],
      resources: [
        `arn:aws:ssm:${region}:${account}:parameter/amplify/*`,
      ],
    }));

    // Inbox checker worker task role (for application permissions)
    const inboxCheckerWorkerTaskRole = new iam.Role(this, 'InboxCheckerWorkerTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: `Role for ECS inbox checker worker tasks (${environment})`,
    });

    // Grant CloudWatch Logs permissions for inbox checker worker
    inboxCheckerWorkerTaskRole.addToPolicy(new iam.PolicyStatement({
      sid: 'AllowCloudWatchLogs',
      actions: [
        'logs:CreateLogStream',
        'logs:PutLogEvents',
      ],
      resources: [inboxCheckerWorkerLogGroup.logGroupArn + ':*'],
    }));

    // Grant SSM Parameter Store read permissions for inbox checker worker
    inboxCheckerWorkerTaskRole.addToPolicy(new iam.PolicyStatement({
      sid: 'AllowSSMParameterAccess',
      actions: [
        'ssm:GetParameters',
        'ssm:GetParameter',
      ],
      resources: [
        `arn:aws:ssm:${region}:${account}:parameter/amplify/*`,
      ],
    }));

    const notificationEventsQueue = new sqs.Queue(this, 'NotificationEventsQueue', {
      queueName: `furnace-notification-events-${environment}`,
      visibilityTimeout: cdk.Duration.seconds(150),
      retentionPeriod: cdk.Duration.days(4),
    });
    const webhookEventsQueueUrl = cdk.Fn.importValue(`FurnaceWebhookEventsQueueUrl-${environment}`);
    const webhookEventsQueueArn = cdk.Fn.importValue(`FurnaceWebhookEventsQueueArn-${environment}`);

    sendWorkerTaskRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'AllowSendWebhookEventsQueue',
        actions: ['sqs:SendMessage'],
        resources: [webhookEventsQueueArn],
      }),
    );

    inboxCheckerWorkerTaskRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'AllowSendNotificationEventsQueue',
        actions: ['sqs:SendMessage'],
        resources: [notificationEventsQueue.queueArn],
      }),
    );
    inboxCheckerWorkerTaskRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'AllowInboxCheckerWebhookEventsQueue',
        actions: ['sqs:SendMessage'],
        resources: [webhookEventsQueueArn],
      }),
    );

    const smartleadMigrationTaskRole = new iam.Role(this, 'SmartleadMigrationTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: `Role for Smartlead migration ECS tasks (${environment})`,
    });

    smartleadMigrationTaskRole.addToPolicy(new iam.PolicyStatement({
      sid: 'AllowSmartleadTaskCloudWatchLogs',
      actions: [
        'logs:CreateLogStream',
        'logs:PutLogEvents',
      ],
      resources: [smartleadMigrationTaskLogGroup.logGroupArn + ':*'],
    }));

    smartleadMigrationTaskRole.addToPolicy(new iam.PolicyStatement({
      sid: 'AllowSmartleadTaskSSMAccess',
      actions: [
        'ssm:GetParameters',
        'ssm:GetParameter',
      ],
      resources: [
        `arn:aws:ssm:${region}:${account}:parameter/amplify/*`,
        `arn:aws:ssm:${region}:${account}:parameter/furnace/smartlead-migrations/*`,
      ],
    }));

    const utahScraperTaskRole = new iam.Role(this, 'UtahScraperTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: `Role for Utah registry scraper ECS tasks (${environment})`,
    });
    utahScraperTaskRole.addToPolicy(new iam.PolicyStatement({
      sid: 'AllowUtahScraperCloudWatchLogs',
      actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
      resources: [utahScraperTaskLogGroup.logGroupArn + ':*'],
    }));

    const leadsUrlTrim = leadsSupabaseUrl?.trim();
    const leadsParamTrim = leadsSupabaseSecretParamPath?.trim();
    const foundryOpenRouterParamTrim = foundryOpenRouterApiKeyParamPath?.trim();
    const utahLeadsConfigured = Boolean(leadsUrlTrim && leadsParamTrim);

    const floridaScraperTaskRole = new iam.Role(this, 'FloridaScraperTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: `Role for Florida Sunbiz registry scraper ECS tasks (${environment})`,
    });
    floridaScraperTaskRole.addToPolicy(new iam.PolicyStatement({
      sid: 'AllowFloridaScraperCloudWatchLogs',
      actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
      resources: [floridaScraperTaskLogGroup.logGroupArn + ':*'],
    }));
    const iowaScraperTaskRole = new iam.Role(this, 'IowaScraperTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: `Role for Iowa registry scraper ECS tasks (${environment})`,
    });
    iowaScraperTaskRole.addToPolicy(new iam.PolicyStatement({
      sid: 'AllowIowaScraperCloudWatchLogs',
      actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
      resources: [iowaScraperTaskLogGroup.logGroupArn + ':*'],
    }));
    const websiteVerificationTaskRole = new iam.Role(this, 'WebsiteVerificationTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: `Role for website verification ECS tasks (${environment})`,
    });
    websiteVerificationTaskRole.addToPolicy(new iam.PolicyStatement({
      sid: 'AllowWebsiteVerificationCloudWatchLogs',
      actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
      resources: [websiteVerificationTaskLogGroup.logGroupArn + ':*'],
    }));
    const googleAdsVerificationTaskRole = new iam.Role(this, 'GoogleAdsVerificationTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: `Role for Google Ads verification ECS tasks (${environment})`,
    });
    googleAdsVerificationTaskRole.addToPolicy(new iam.PolicyStatement({
      sid: 'AllowGoogleAdsVerificationCloudWatchLogs',
      actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
      resources: [googleAdsVerificationTaskLogGroup.logGroupArn + ':*'],
    }));
    googleAdsVerificationTaskRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'AllowGoogleAdsVerificationAmplifySsm',
        actions: ['ssm:GetParameters', 'ssm:GetParameter'],
        resources: [`arn:aws:ssm:${region}:${account}:parameter/amplify/*`],
      }),
    );

    if (utahLeadsConfigured) {
      const paramSuffix = leadsParamTrim!.replace(/^\//, '');
      const leadsSsmPolicy = new iam.PolicyStatement({
        sid: 'AllowUtahLeadsSecretSsm',
        actions: ['ssm:GetParameters', 'ssm:GetParameter'],
        resources: [`arn:aws:ssm:${region}:${account}:parameter/${paramSuffix}`],
      });
      utahScraperTaskRole.addToPolicy(leadsSsmPolicy);
      floridaScraperTaskRole.addToPolicy(
        new iam.PolicyStatement({
          sid: 'AllowFloridaLeadsSecretSsm',
          actions: ['ssm:GetParameters', 'ssm:GetParameter'],
          resources: [`arn:aws:ssm:${region}:${account}:parameter/${paramSuffix}`],
        }),
      );
      iowaScraperTaskRole.addToPolicy(
        new iam.PolicyStatement({
          sid: 'AllowIowaLeadsSecretSsm',
          actions: ['ssm:GetParameters', 'ssm:GetParameter'],
          resources: [`arn:aws:ssm:${region}:${account}:parameter/${paramSuffix}`],
        }),
      );
      websiteVerificationTaskRole.addToPolicy(
        new iam.PolicyStatement({
          sid: 'AllowWebsiteVerificationLeadsSecretSsm',
          actions: ['ssm:GetParameters', 'ssm:GetParameter'],
          resources: [`arn:aws:ssm:${region}:${account}:parameter/${paramSuffix}`],
        }),
      );
      googleAdsVerificationTaskRole.addToPolicy(
        new iam.PolicyStatement({
          sid: 'AllowGoogleAdsVerificationLeadsSecretSsm',
          actions: ['ssm:GetParameters', 'ssm:GetParameter'],
          resources: [`arn:aws:ssm:${region}:${account}:parameter/${paramSuffix}`],
        }),
      );
    }
    if (foundryOpenRouterParamTrim) {
      const foundryOpenRouterParamSuffix = foundryOpenRouterParamTrim.replace(/^\//, '');
      websiteVerificationTaskRole.addToPolicy(
        new iam.PolicyStatement({
          sid: 'AllowWebsiteVerificationFoundryOpenRouterSecretSsm',
          actions: ['ssm:GetParameters', 'ssm:GetParameter'],
          resources: [`arn:aws:ssm:${region}:${account}:parameter/${foundryOpenRouterParamSuffix}`],
        }),
      );
    }

    // ============================================
    // Send Worker Task Definition & Service
    // ============================================

    const sendWorkerTaskDefinition = new ecs.FargateTaskDefinition(this, 'SendWorkerTaskDef', {
      memoryLimitMiB: 1024, // 1 GB
      cpu: 512, // 0.5 vCPU
      taskRole: sendWorkerTaskRole,
      executionRole: taskExecutionRole,
    });

    const sendWorkerContainer = sendWorkerTaskDefinition.addContainer('send-worker', {
      image: ecs.ContainerImage.fromEcrRepository(sendWorkerRepo, 'latest'),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'send-worker',
        logGroup: sendWorkerLogGroup,
      }),
      environment: {
        AWS_REGION: region,
        SUPABASE_URL: supabaseUrl,
        SUPABASE_SECRET_KEY_PARAM_PATH: supabaseSecretKeyParamPath,
        WEBHOOK_QUEUE_URL: webhookEventsQueueUrl,
        ...(slackErrorWebhookUrl ? { SLACK_ERROR_WEBHOOK_URL: slackErrorWebhookUrl } : {}),
      },
    });

    // Create security group for workers (allow all outbound, no inbound needed)
    const workerSecurityGroup = new ec2.SecurityGroup(this, 'WorkerSecurityGroup', {
      vpc: vpc,
      description: `Security group for ${environment} workers (send + scheduler)`,
      allowAllOutbound: true, // Allow all outbound traffic (DNS, HTTPS, SMTP)
    });

    const sendWorkerService = new ecs.FargateService(this, 'SendWorkerService', {
      cluster: cluster,
      taskDefinition: sendWorkerTaskDefinition,
      desiredCount: desiredCount.sendWorker,
      assignPublicIp: true, // Needed for SMTP (using public subnets, no NAT Gateway)
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC, // Public subnets for internet access
      },
      securityGroups: [workerSecurityGroup], // Use explicit security group
    });

    this.sendWorkerService = sendWorkerService;

    // ============================================
    // Scheduler Worker Task Definition & Service
    // ============================================

    const schedulerWorkerTaskDefinition = new ecs.FargateTaskDefinition(this, 'SchedulerWorkerTaskDef', {
      memoryLimitMiB: 1024, // 1 GB
      cpu: 512, // 0.5 vCPU
      taskRole: schedulerWorkerTaskRole,
      executionRole: taskExecutionRole, // Reuse execution role
    });

    const schedulerWorkerContainer = schedulerWorkerTaskDefinition.addContainer('scheduler-worker', {
      image: ecs.ContainerImage.fromEcrRepository(schedulerWorkerRepo, 'latest'),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'scheduler-worker',
        logGroup: schedulerWorkerLogGroup,
      }),
      environment: {
        AWS_REGION: region,
        SUPABASE_URL: supabaseUrl,
        SUPABASE_SECRET_KEY_PARAM_PATH: supabaseSecretKeyParamPath,
        ...(slackErrorWebhookUrl ? { SLACK_ERROR_WEBHOOK_URL: slackErrorWebhookUrl } : {}),
      },
    });

    const schedulerWorkerService = new ecs.FargateService(this, 'SchedulerWorkerService', {
      cluster: cluster, // Reuse same cluster as send workers
      taskDefinition: schedulerWorkerTaskDefinition,
      desiredCount: desiredCount.schedulerWorker,
      assignPublicIp: true, // Needed for Supabase access (using public subnets, no NAT Gateway)
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC, // Public subnets for internet access
      },
      securityGroups: [workerSecurityGroup], // Reuse same security group
      healthCheckGracePeriod: cdk.Duration.seconds(60),
    });

    this.schedulerWorkerService = schedulerWorkerService;

    // ============================================
    // Inbox Checker Worker Task Definition & Service
    // ============================================

    const inboxCheckerWorkerTaskDefinition = new ecs.FargateTaskDefinition(this, 'InboxCheckerWorkerTaskDef', {
      memoryLimitMiB: 512, // 512 MB (IMAP connections are lightweight)
      cpu: 256, // 0.25 vCPU
      taskRole: inboxCheckerWorkerTaskRole,
      executionRole: taskExecutionRole, // Reuse execution role
    });

    const inboxCheckerWorkerContainer = inboxCheckerWorkerTaskDefinition.addContainer('inbox-checker-worker', {
      image: ecs.ContainerImage.fromEcrRepository(inboxCheckerWorkerRepo, 'latest'),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'inbox-checker-worker',
        logGroup: inboxCheckerWorkerLogGroup,
      }),
      environment: {
        AWS_REGION: region,
        SUPABASE_URL: supabaseUrl,
        SUPABASE_SECRET_KEY_PARAM_PATH: supabaseSecretKeyParamPath,
        NOTIFICATION_QUEUE_URL: notificationEventsQueue.queueUrl,
        WEBHOOK_QUEUE_URL: webhookEventsQueueUrl,
        ...(slackErrorWebhookUrl ? { SLACK_ERROR_WEBHOOK_URL: slackErrorWebhookUrl } : {}),
      },
    });

    const inboxCheckerWorkerService = new ecs.FargateService(this, 'InboxCheckerWorkerService', {
      cluster: cluster, // Reuse same cluster as other workers
      taskDefinition: inboxCheckerWorkerTaskDefinition,
      desiredCount: desiredCount.inboxCheckerWorker,
      assignPublicIp: true, // Needed for IMAP access (using public subnets, no NAT Gateway)
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC, // Public subnets for internet access
      },
      securityGroups: [workerSecurityGroup], // Reuse same security group
      healthCheckGracePeriod: cdk.Duration.seconds(60),
    });

    this.inboxCheckerWorkerService = inboxCheckerWorkerService;

    // ============================================
    // Smartlead Migration Task Definition
    // ============================================

    const smartleadMigrationTaskDefinition = new ecs.FargateTaskDefinition(this, 'SmartleadMigrationTaskDef', {
      family: `furnace-smartlead-migration-task-${environment}`,
      memoryLimitMiB: 1024,
      cpu: 512,
      taskRole: smartleadMigrationTaskRole,
      executionRole: taskExecutionRole,
    });

    smartleadMigrationTaskDefinition.addContainer('smartlead-migration-task', {
      image: ecs.ContainerImage.fromEcrRepository(smartleadMigrationTaskRepo, 'latest'),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'smartlead-migration-task',
        logGroup: smartleadMigrationTaskLogGroup,
      }),
      environment: {
        AWS_REGION: region,
        SUPABASE_URL: supabaseUrl,
        SUPABASE_SECRET_KEY_PARAM_PATH: supabaseSecretKeyParamPath,
        ...(slackErrorWebhookUrl ? { SLACK_ERROR_WEBHOOK_URL: slackErrorWebhookUrl } : {}),
      },
    });

    const utahScraperTaskDefinition = new ecs.FargateTaskDefinition(this, 'UtahScraperTaskDef', {
      family: `furnace-utah-scraper-task-${environment}`,
      memoryLimitMiB: 2048,
      cpu: 1024,
      taskRole: utahScraperTaskRole,
      executionRole: taskExecutionRole,
    });
    utahScraperTaskDefinition.addContainer('utah-scraper', {
      image: ecs.ContainerImage.fromEcrRepository(utahScraperTaskRepo, 'latest'),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'utah-scraper',
        logGroup: utahScraperTaskLogGroup,
      }),
      environment: {
        AWS_REGION: region,
        INPUT_CSV: '/data/input.csv',
        OUTPUT_JSON: '/out/utah-scrape-report.json',
        RATE_MS: '2000',
        ...(utahLeadsConfigured
          ? {
              LEADS_SUPABASE_URL: leadsUrlTrim!,
              LEADS_SUPABASE_SECRET_KEY_PARAM_PATH: leadsParamTrim!,
            }
          : {}),
      },
    });

    const floridaScraperTaskDefinition = new ecs.FargateTaskDefinition(this, 'FloridaScraperTaskDef', {
      family: `furnace-florida-scraper-task-${environment}`,
      memoryLimitMiB: 2048,
      cpu: 1024,
      taskRole: floridaScraperTaskRole,
      executionRole: taskExecutionRole,
    });
    floridaScraperTaskDefinition.addContainer('florida-scraper', {
      image: ecs.ContainerImage.fromEcrRepository(floridaScraperTaskRepo, 'latest'),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'florida-scraper',
        logGroup: floridaScraperTaskLogGroup,
      }),
      environment: {
        AWS_REGION: region,
        INPUT_CSV: '/data/input.csv',
        OUTPUT_JSON: '/out/florida-scrape-report.json',
        RATE_MS: '2000',
        ...(utahLeadsConfigured
          ? {
              LEADS_SUPABASE_URL: leadsUrlTrim!,
              LEADS_SUPABASE_SECRET_KEY_PARAM_PATH: leadsParamTrim!,
            }
          : {}),
      },
    });
    const iowaScraperTaskDefinition = new ecs.FargateTaskDefinition(this, 'IowaScraperTaskDef', {
      family: `furnace-iowa-scraper-task-${environment}`,
      memoryLimitMiB: 2048,
      cpu: 1024,
      taskRole: iowaScraperTaskRole,
      executionRole: taskExecutionRole,
    });
    iowaScraperTaskDefinition.addContainer('iowa-scraper', {
      image: ecs.ContainerImage.fromEcrRepository(iowaScraperTaskRepo, 'latest'),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'iowa-scraper',
        logGroup: iowaScraperTaskLogGroup,
      }),
      environment: {
        AWS_REGION: region,
        INPUT_CSV: '/data/input.csv',
        OUTPUT_JSON: '/out/iowa-scrape-report.json',
        RATE_MS: '2000',
        ...(utahLeadsConfigured
          ? {
              LEADS_SUPABASE_URL: leadsUrlTrim!,
              LEADS_SUPABASE_SECRET_KEY_PARAM_PATH: leadsParamTrim!,
            }
          : {}),
      },
    });
    const websiteVerificationTaskDefinition = new ecs.FargateTaskDefinition(this, 'WebsiteVerificationTaskDef', {
      family: `furnace-website-verification-task-${environment}`,
      memoryLimitMiB: 2048,
      cpu: 1024,
      taskRole: websiteVerificationTaskRole,
      executionRole: taskExecutionRole,
    });
    websiteVerificationTaskDefinition.addContainer('website-verification-worker', {
      image: ecs.ContainerImage.fromEcrRepository(websiteVerificationTaskRepo, 'latest'),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'website-verification-worker',
        logGroup: websiteVerificationTaskLogGroup,
      }),
      environment: {
        AWS_REGION: region,
        ...(utahLeadsConfigured
          ? {
              LEADS_SUPABASE_URL: leadsUrlTrim!,
              LEADS_SUPABASE_SECRET_KEY_PARAM_PATH: leadsParamTrim!,
            }
          : {}),
        ...(foundryOpenRouterParamTrim
          ? {
              FOUNDRY_OPENROUTER_API_KEY_PARAM_PATH: foundryOpenRouterParamTrim,
            }
          : {}),
      },
    });
    const googleAdsVerificationTaskDefinition = new ecs.FargateTaskDefinition(this, 'GoogleAdsVerificationTaskDef', {
      family: `furnace-google-ads-verification-task-${environment}`,
      memoryLimitMiB: 2048,
      cpu: 1024,
      taskRole: googleAdsVerificationTaskRole,
      executionRole: taskExecutionRole,
    });
    const googlePlacesKeyParamTrim = googlePlacesApiKeyParamPath?.trim();
    googleAdsVerificationTaskDefinition.addContainer('google-ads-verification-worker', {
      image: ecs.ContainerImage.fromEcrRepository(googleAdsVerificationTaskRepo, 'latest'),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'google-ads-verification-worker',
        logGroup: googleAdsVerificationTaskLogGroup,
      }),
      environment: {
        AWS_REGION: region,
        FLUX_SUPABASE_URL: supabaseUrl,
        FLUX_SUPABASE_SECRET_KEY_PARAM_PATH: supabaseSecretKeyParamPath,
        ...(googlePlacesKeyParamTrim
          ? { GOOGLE_PLACES_API_KEY_PARAM_PATH: googlePlacesKeyParamTrim }
          : {}),
        ...(utahLeadsConfigured
          ? {
              LEADS_SUPABASE_URL: leadsUrlTrim!,
              LEADS_SUPABASE_SECRET_KEY_PARAM_PATH: leadsParamTrim!,
            }
          : {}),
      },
    });

    // Stable SSM names for latest task definition ARNs (Amplify Lambdas read at runtime; avoids CFN export churn).
    new ssm.StringParameter(this, 'SmartleadMigrationTaskDefinitionArnParam', {
      parameterName: `/furnace/ecs/${environment}/smartlead-migration/task-definition-arn`,
      stringValue: smartleadMigrationTaskDefinition.taskDefinitionArn,
      description: 'Current Smartlead migration ECS task definition ARN for RunTask',
    });
    new ssm.StringParameter(this, 'UtahScraperTaskDefinitionArnParam', {
      parameterName: `/furnace/ecs/${environment}/utah-scraper/task-definition-arn`,
      stringValue: utahScraperTaskDefinition.taskDefinitionArn,
      description: 'Current Utah scraper ECS task definition ARN for RunTask',
    });
    new ssm.StringParameter(this, 'FloridaScraperTaskDefinitionArnParam', {
      parameterName: `/furnace/ecs/${environment}/florida-scraper/task-definition-arn`,
      stringValue: floridaScraperTaskDefinition.taskDefinitionArn,
      description: 'Current Florida Sunbiz scraper ECS task definition ARN for RunTask',
    });
    new ssm.StringParameter(this, 'IowaScraperTaskDefinitionArnParam', {
      parameterName: `/furnace/ecs/${environment}/iowa-scraper/task-definition-arn`,
      stringValue: iowaScraperTaskDefinition.taskDefinitionArn,
      description: 'Current Iowa scraper ECS task definition ARN for RunTask',
    });
    new ssm.StringParameter(this, 'WebsiteVerificationTaskDefinitionArnParam', {
      parameterName: `/furnace/ecs/${environment}/website-verification/task-definition-arn`,
      stringValue: websiteVerificationTaskDefinition.taskDefinitionArn,
      description: 'Current website verification ECS task definition ARN for RunTask',
    });
    new ssm.StringParameter(this, 'GoogleAdsVerificationTaskDefinitionArnParam', {
      parameterName: `/furnace/ecs/${environment}/google-ads-verification/task-definition-arn`,
      stringValue: googleAdsVerificationTaskDefinition.taskDefinitionArn,
      description: 'Current Google Ads verification ECS task definition ARN for RunTask',
    });

    // Legacy export: older Amplify stacks still use Fn::ImportValue on this name. Removing it
    // causes WorkerStack updates to fail/rollback while that import exists. Current Amplify code
    // reads `/furnace/ecs/{env}/smartlead-migration/task-definition-arn` instead; redeploy Amplify
    // for all branches that still import this, then this output can be deleted.
    new cdk.CfnOutput(this, 'SmartleadMigrationTaskDefinitionArnLegacyExport', {
      value: smartleadMigrationTaskDefinition.taskDefinitionArn,
      description:
        'Smartlead migration task definition ARN (legacy CFN export; prefer SSM smartlead-migration/task-definition-arn)',
      exportName: `FurnaceSmartleadMigrationTaskDefinition-${environment}`,
    });

    // ============================================
    // Outputs
    // ============================================

    new cdk.CfnOutput(this, 'SendWorkerRepoUri', {
      value: sendWorkerRepo.repositoryUri,
      description: 'ECR repository URI for send worker',
      exportName: `FurnaceSendWorkerRepo-${environment}`,
    });

    new cdk.CfnOutput(this, 'SchedulerWorkerRepoUri', {
      value: schedulerWorkerRepo.repositoryUri,
      description: 'ECR repository URI for scheduler worker',
      exportName: `FurnaceSchedulerWorkerRepo-${environment}`,
    });

    new cdk.CfnOutput(this, 'InboxCheckerWorkerRepoUri', {
      value: inboxCheckerWorkerRepo.repositoryUri,
      description: 'ECR repository URI for inbox checker worker',
      exportName: `FurnaceInboxCheckerWorkerRepo-${environment}`,
    });

    new cdk.CfnOutput(this, 'SmartleadMigrationTaskRepoUri', {
      value: smartleadMigrationTaskRepo.repositoryUri,
      description: 'ECR repository URI for Smartlead migration task',
      exportName: `FurnaceSmartleadMigrationTaskRepo-${environment}`,
    });

    new cdk.CfnOutput(this, 'UtahScraperTaskRepoUri', {
      value: utahScraperTaskRepo.repositoryUri,
      description: 'ECR repository URI for Utah registry scraper task',
      exportName: `FurnaceUtahScraperTaskRepo-${environment}`,
    });

    new cdk.CfnOutput(this, 'FloridaScraperTaskRepoUri', {
      value: floridaScraperTaskRepo.repositoryUri,
      description: 'ECR repository URI for Florida Sunbiz registry scraper task',
      exportName: `FurnaceFloridaScraperTaskRepo-${environment}`,
    });
    new cdk.CfnOutput(this, 'IowaScraperTaskRepoUri', {
      value: iowaScraperTaskRepo.repositoryUri,
      description: 'ECR repository URI for Iowa registry scraper task',
      exportName: `FurnaceIowaScraperTaskRepo-${environment}`,
    });
    new cdk.CfnOutput(this, 'WebsiteVerificationTaskRepoUri', {
      value: websiteVerificationTaskRepo.repositoryUri,
      description: 'ECR repository URI for website verification task',
      exportName: `FurnaceWebsiteVerificationTaskRepo-${environment}`,
    });
    new cdk.CfnOutput(this, 'GoogleAdsVerificationTaskRepoUri', {
      value: googleAdsVerificationTaskRepo.repositoryUri,
      description: 'ECR repository URI for Google Ads verification task',
      exportName: `FurnaceGoogleAdsVerificationTaskRepo-${environment}`,
    });

    new cdk.CfnOutput(this, 'ClusterName', {
      value: cluster.clusterName,
      description: 'ECS cluster name',
      exportName: `FurnaceCluster-${environment}`,
    });

    new cdk.CfnOutput(this, 'WorkerVpcId', {
      value: vpc.vpcId,
      description: 'VPC id for Furnace ECS workers (Step Functions / RunTask imports)',
      exportName: `FurnaceWorkerVpcId-${environment}`,
    });

    new cdk.CfnOutput(this, 'WorkerVpcAvailabilityZones', {
      value: cdk.Fn.join(',', vpc.availabilityZones),
      description: 'Comma-separated AZs for Furnace worker VPC',
      exportName: `FurnaceWorkerVpcAvailabilityZones-${environment}`,
    });

    new cdk.CfnOutput(this, 'WorkerSecurityGroupId', {
      value: workerSecurityGroup.securityGroupId,
      description: 'Security group id for Furnace ECS workers',
      exportName: `FurnaceWorkerSecurityGroup-${environment}`,
    });

    new cdk.CfnOutput(this, 'WorkerPublicSubnetIds', {
      value: vpc.publicSubnets.map((subnet) => subnet.subnetId).join(','),
      description: 'Comma-separated public subnet ids for Furnace ECS workers',
      exportName: `FurnaceWorkerPublicSubnets-${environment}`,
    });

    new cdk.CfnOutput(this, 'NotificationEventsQueueUrl', {
      value: notificationEventsQueue.queueUrl,
      description: 'SQS URL for notification domain events (Lambda consumer in Amplify)',
      exportName: `FurnaceNotificationEventsQueueUrl-${environment}`,
    });

    new cdk.CfnOutput(this, 'NotificationEventsQueueArn', {
      value: notificationEventsQueue.queueArn,
      description: 'SQS ARN for notification domain events',
      exportName: `FurnaceNotificationEventsQueueArn-${environment}`,
    });

    new cdk.CfnOutput(this, 'EcsTaskExecutionRoleArn', {
      value: taskExecutionRole.roleArn,
      description: 'Shared ECS task execution role (image pull, logs, SSM secrets)',
      exportName: `FurnaceEcsTaskExecutionRole-${environment}`,
    });

    new cdk.CfnOutput(this, 'UtahScraperTaskRoleArn', {
      value: utahScraperTaskRole.roleArn,
      description: 'Task role for Utah registry scraper containers',
      exportName: `FurnaceUtahScraperTaskRole-${environment}`,
    });

    new cdk.CfnOutput(this, 'FloridaScraperTaskRoleArn', {
      value: floridaScraperTaskRole.roleArn,
      description: 'Task role for Florida Sunbiz registry scraper containers',
      exportName: `FurnaceFloridaScraperTaskRole-${environment}`,
    });
    new cdk.CfnOutput(this, 'IowaScraperTaskRoleArn', {
      value: iowaScraperTaskRole.roleArn,
      description: 'Task role for Iowa registry scraper containers',
      exportName: `FurnaceIowaScraperTaskRole-${environment}`,
    });
    new cdk.CfnOutput(this, 'WebsiteVerificationTaskRoleArn', {
      value: websiteVerificationTaskRole.roleArn,
      description: 'Task role for website verification containers',
      exportName: `FurnaceWebsiteVerificationTaskRole-${environment}`,
    });
    new cdk.CfnOutput(this, 'GoogleAdsVerificationTaskRoleArn', {
      value: googleAdsVerificationTaskRole.roleArn,
      description: 'Task role for Google Ads verification containers',
      exportName: `FurnaceGoogleAdsVerificationTaskRole-${environment}`,
    });
  }
}


