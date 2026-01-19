import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
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
   * SSM Parameter Store path for SUPABASE_SERVICE_KEY
   */
  supabaseServiceKeyParamPath: string;
  
  /**
   * Desired task count for workers
   */
  desiredCount: {
    sendWorker: number;
    schedulerWorker: number;
  };
}

export class WorkerStack extends cdk.Stack {
  public readonly sendWorkerService: ecs.FargateService;
  public readonly schedulerWorkerService: ecs.FargateService;
  public readonly sendWorkerRepo: ecr.Repository;
  public readonly schedulerWorkerRepo: ecr.Repository;

  constructor(scope: Construct, id: string, props: WorkerStackProps) {
    super(scope, id, props);

    const { environment, supabaseUrl, supabaseServiceKeyParamPath, desiredCount } = props;
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

    this.sendWorkerRepo = sendWorkerRepo;
    this.schedulerWorkerRepo = schedulerWorkerRepo;

    // ============================================
    // VPC & Networking
    // ============================================

    // Create VPC with public subnets (no NAT Gateway for cost savings)
    const vpc = new ec2.Vpc(this, 'FurnaceVpc', {
      maxAzs: 2, // Use 2 availability zones for high availability
      natGateways: 0, // No NAT Gateway - use public subnets (cheaper, ~$32/month savings)
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

    // Grant SSM Parameter Store read permissions (for SUPABASE_SERVICE_KEY)
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
        SUPABASE_SERVICE_KEY_PARAM_PATH: supabaseServiceKeyParamPath,
      },
    });

    const sendWorkerService = new ecs.FargateService(this, 'SendWorkerService', {
      cluster: cluster,
      taskDefinition: sendWorkerTaskDefinition,
      desiredCount: desiredCount.sendWorker,
      assignPublicIp: true, // Needed for SMTP (using public subnets, no NAT Gateway)
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC, // Public subnets for internet access
      },
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
        SUPABASE_SERVICE_KEY_PARAM_PATH: supabaseServiceKeyParamPath,
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
      healthCheckGracePeriod: cdk.Duration.seconds(60),
    });

    this.schedulerWorkerService = schedulerWorkerService;

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

    new cdk.CfnOutput(this, 'ClusterName', {
      value: cluster.clusterName,
      description: 'ECS cluster name',
      exportName: `FurnaceCluster-${environment}`,
    });
  }
}


