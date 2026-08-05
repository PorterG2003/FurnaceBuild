#!/usr/bin/env node
/**
 * AWS CLI-backed dev lease operations. Pure planning logic lives in lease-dev-lib.ts.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { config as loadEnvFile } from 'dotenv';
import {
  CreateScheduleCommand,
  DeleteScheduleCommand,
  GetScheduleCommand,
  ListSchedulesCommand,
  SchedulerClient,
  ResourceNotFoundException,
} from '@aws-sdk/client-scheduler';
import {
  ALL_LEASE_SCHEDULE_NAMES,
  DEFAULT_LEASE_MS,
  DEV_AWS_ACCOUNT_ID,
  DEV_LEASE_STACK_NAME,
  DEV_LEASE_STACK_OUTPUT_KEYS,
  LEASE_SCHEDULE_NAMES,
  assertDevOnlyAccount,
  assertLeaseWithinMax,
  assertNoProdTarget,
  buildEcsUpdateServiceTargetInput,
  buildShutdownSchedulePlan,
  canExtendLease,
  findUnresolvedLeaseSchedules,
  parseDuration,
  shouldRefuseNewLease,
  type ShutdownScheduleEntry,
  type WorkerServiceNames,
} from './lease-dev-lib';

const REGION = process.env.CDK_DEFAULT_REGION || process.env.AWS_REGION || 'us-west-2';
const CLUSTER_NAME = 'furnace-cluster-dev';
const schedulerClient = new SchedulerClient({ region: REGION });

interface StackContext {
  scheduleGroupName: string;
  executionRoleArn: string;
  dlqArn?: string;
  clusterName: string;
  serviceNames: WorkerServiceNames;
}

interface ParsedArgs {
  command: 'start' | 'status' | 'extend' | 'stop';
  leaseMs: number;
  forRaw?: string;
}

function loadRepoEnv(): void {
  const infraDir = path.resolve(__dirname, '..');
  const repoRoot = path.resolve(infraDir, '../..');
  for (const name of ['.env.local', '.env'] as const) {
    const envPath = path.join(repoRoot, name);
    if (existsSync(envPath)) {
      loadEnvFile({ path: envPath });
    }
  }
}

function awsJson(args: string[]): unknown {
  const stdout = execFileSync('aws', [...args, '--region', REGION, '--output', 'json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(stdout) as unknown;
}

function awsRun(args: string[]): void {
  execFileSync('aws', [...args, '--region', REGION], {
    stdio: 'inherit',
  });
}

function getCallerAccountId(): string {
  const identity = awsJson(['sts', 'get-caller-identity']) as { Account?: string };
  const accountId = identity.Account?.trim();
  if (!accountId) {
    throw new Error('Could not determine AWS account from sts get-caller-identity');
  }
  return accountId;
}

function readStackOutput(stackName: string, outputKey: string): string | undefined {
  const stacks = awsJson(['cloudformation', 'describe-stacks', '--stack-name', stackName]) as {
    Stacks?: Array<{ Outputs?: Array<{ OutputKey?: string; OutputValue?: string }> }>;
  };
  const outputs = stacks.Stacks?.[0]?.Outputs ?? [];
  const match = outputs.find((output) => output.OutputKey === outputKey);
  return match?.OutputValue?.trim() || undefined;
}

function discoverServiceName(clusterName: string, fragment: string): string {
  const response = awsJson([
    'ecs',
    'list-services',
    '--cluster',
    clusterName,
    '--max-items',
    '100',
  ]) as { serviceArns?: string[] };

  const arn = (response.serviceArns ?? []).find((serviceArn) => serviceArn.includes(fragment));
  if (!arn) {
    throw new Error(`Could not find ECS service containing "${fragment}" in cluster ${clusterName}`);
  }
  const serviceName = arn.split('/').pop();
  if (!serviceName) {
    throw new Error(`Could not parse service name from ARN ${arn}`);
  }
  assertNoProdTarget(serviceName);
  return serviceName;
}

function loadStackContext(): StackContext {
  const stackName = DEV_LEASE_STACK_NAME;
  assertNoProdTarget(stackName);

  const scheduleGroupName =
    readStackOutput(stackName, DEV_LEASE_STACK_OUTPUT_KEYS.scheduleGroupName) ??
    'furnace-dev-lease';
  const executionRoleArn = readStackOutput(stackName, DEV_LEASE_STACK_OUTPUT_KEYS.executionRoleArn);
  const dlqArn = readStackOutput(stackName, DEV_LEASE_STACK_OUTPUT_KEYS.dlqArn);
  const clusterFromStack =
    readStackOutput(stackName, DEV_LEASE_STACK_OUTPUT_KEYS.clusterName) ?? CLUSTER_NAME;

  assertNoProdTarget(scheduleGroupName);
  assertNoProdTarget(clusterFromStack);

  if (!executionRoleArn) {
    throw new Error(
      `Missing stack output ${DEV_LEASE_STACK_OUTPUT_KEYS.executionRoleArn} on ${stackName}. ` +
        'Deploy worker-stack CDK changes (schedule group, execution role, DLQ) first.',
    );
  }
  assertNoProdTarget(executionRoleArn);

  if (scheduleGroupName === 'furnace-dev-lease' && !readStackOutput(stackName, DEV_LEASE_STACK_OUTPUT_KEYS.scheduleGroupName)) {
    console.warn(
      `⚠️  ${DEV_LEASE_STACK_OUTPUT_KEYS.scheduleGroupName} not found; using default group "${scheduleGroupName}"`,
    );
  }

  const serviceNames: WorkerServiceNames = {
    scheduler: discoverServiceName(clusterFromStack, 'SchedulerWorker'),
    send: discoverServiceName(clusterFromStack, 'SendWorker'),
    inbox: discoverServiceName(clusterFromStack, 'InboxCheckerWorker'),
  };

  return {
    scheduleGroupName,
    executionRoleArn,
    dlqArn,
    clusterName: clusterFromStack,
    serviceNames,
  };
}

async function listLeaseSchedules(ctx: StackContext): Promise<string[]> {
  try {
    const response = await schedulerClient.send(
      new ListSchedulesCommand({
        GroupName: ctx.scheduleGroupName,
        MaxResults: 100,
      }),
    );
    const names = (response.Schedules ?? [])
      .map((schedule) => schedule.Name?.trim())
      .filter((name): name is string => Boolean(name));
    return names.filter((name) => ALL_LEASE_SCHEDULE_NAMES.includes(name));
  } catch (error) {
    if (error instanceof ResourceNotFoundException) {
      return [];
    }
    throw error;
  }
}

async function getScheduleRunAtMs(ctx: StackContext, scheduleName: string): Promise<number | undefined> {
  try {
    const schedule = await schedulerClient.send(
      new GetScheduleCommand({
        GroupName: ctx.scheduleGroupName,
        Name: scheduleName,
      }),
    );

    if (schedule.StartDate) {
      return schedule.StartDate.getTime();
    }

    const expression = schedule.ScheduleExpression ?? '';
    const match = /^at\((\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\)$/.exec(expression);
    if (match) {
      return Date.parse(`${match[1]}Z`);
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function deleteSchedule(ctx: StackContext, scheduleName: string): Promise<void> {
  try {
    await schedulerClient.send(
      new DeleteScheduleCommand({
        GroupName: ctx.scheduleGroupName,
        Name: scheduleName,
      }),
    );
  } catch (error) {
    if (error instanceof ResourceNotFoundException) {
      return;
    }
    throw error;
  }
}

async function deleteSchedules(ctx: StackContext, scheduleNames: string[]): Promise<void> {
  for (const name of scheduleNames) {
    await deleteSchedule(ctx, name);
  }
}

async function createSchedule(ctx: StackContext, entry: ShutdownScheduleEntry): Promise<void> {
  await schedulerClient.send(
    new CreateScheduleCommand({
      Name: entry.name,
      GroupName: ctx.scheduleGroupName,
      ScheduleExpression: entry.scheduleExpression,
      ScheduleExpressionTimezone: 'UTC',
      FlexibleTimeWindow: { Mode: entry.flexibleTimeWindowMode },
      ActionAfterCompletion: entry.actionAfterCompletion,
      Target: {
        Arn: entry.targetArn,
        RoleArn: ctx.executionRoleArn,
        Input: buildEcsUpdateServiceTargetInput(entry),
        RetryPolicy: {
          MaximumRetryAttempts: entry.maximumRetryAttempts,
          MaximumEventAgeInSeconds: entry.maximumEventAgeInSeconds,
        },
        ...(ctx.dlqArn ? { DeadLetterConfig: { Arn: ctx.dlqArn } } : {}),
      },
    }),
  );
}

async function createSchedulesWithRollback(ctx: StackContext, schedules: ShutdownScheduleEntry[]): Promise<void> {
  const created: string[] = [];
  try {
    for (const entry of schedules) {
      await createSchedule(ctx, entry);
      created.push(entry.name);
    }
  } catch (error) {
    console.error('❌ Partial schedule creation failure — rolling back created schedules and leaving workers at 0');
    await deleteSchedules(ctx, created);
    scaleWorkers(ctx, 0, 0, 0);
    throw error;
  }
}

function scaleWorkers(ctx: StackContext, send: number, scheduler: number, inbox: number): void {
  const updates: Array<{ service: string; count: number; label: string }> = [
    { service: ctx.serviceNames.send, count: send, label: 'send' },
    { service: ctx.serviceNames.scheduler, count: scheduler, label: 'scheduler' },
    { service: ctx.serviceNames.inbox, count: inbox, label: 'inbox' },
  ];

  for (const update of updates) {
    console.log(`🔄 Scaling ${update.label} (${update.service}) → ${update.count}`);
    awsRun([
      'ecs',
      'update-service',
      '--cluster',
      ctx.clusterName,
      '--service',
      update.service,
      '--desired-count',
      String(update.count),
    ]);
  }
}

function getDesiredCounts(ctx: StackContext): Record<'send' | 'scheduler' | 'inbox', number | undefined> {
  const result: Record<'send' | 'scheduler' | 'inbox', number | undefined> = {
    send: undefined,
    scheduler: undefined,
    inbox: undefined,
  };

  for (const [key, serviceName] of Object.entries(ctx.serviceNames) as Array<
    ['send' | 'scheduler' | 'inbox', string]
  >) {
    const service = awsJson([
      'ecs',
      'describe-services',
      '--cluster',
      ctx.clusterName,
      '--services',
      serviceName,
    ]) as { services?: Array<{ desiredCount?: number }> };
    result[key] = service.services?.[0]?.desiredCount;
  }

  return result;
}

function formatWhen(ms: number | undefined): string {
  if (ms == null || Number.isNaN(ms)) {
    return 'unknown';
  }
  return new Date(ms).toISOString();
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = [...argv];
  let command: ParsedArgs['command'] = 'start';
  let leaseMs = DEFAULT_LEASE_MS;
  let forRaw: string | undefined;

  if (args.length > 0 && !args[0].startsWith('-')) {
    const maybeCommand = args.shift()!;
    if (['start', 'status', 'extend', 'stop'].includes(maybeCommand)) {
      command = maybeCommand as ParsedArgs['command'];
    } else {
      throw new Error(`Unknown command "${maybeCommand}". Use start|status|extend|stop.`);
    }
  }

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--for') {
      forRaw = args[i + 1];
      if (!forRaw) {
        throw new Error('--for requires a duration like 2h or 90m');
      }
      leaseMs = parseDuration(forRaw);
      i += 1;
      continue;
    }
    if (arg.startsWith('--for=')) {
      forRaw = arg.slice('--for='.length);
      leaseMs = parseDuration(forRaw);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (command === 'stop') {
    leaseMs = 0;
  } else {
    assertLeaseWithinMax(leaseMs);
  }

  return { command, leaseMs, forRaw };
}

function ensureDevAccount(): void {
  const accountId = getCallerAccountId();
  assertDevOnlyAccount(accountId);
  console.log(`✅ AWS account ${DEV_AWS_ACCOUNT_ID} (dev only)`);
}

async function cmdStart(ctx: StackContext, leaseMs: number, forRaw: string | undefined): Promise<void> {
  const unresolved = findUnresolvedLeaseSchedules(await listLeaseSchedules(ctx));
  if (shouldRefuseNewLease({ unresolvedScheduleNames: unresolved })) {
    throw new Error(
      `Refusing new lease: unresolved schedules remain (${unresolved.join(', ')}). ` +
        'Wait for them to fire, run lease:dev:stop, or delete them manually.',
    );
  }

  const plan = buildShutdownSchedulePlan({
    now: Date.now(),
    leaseMs,
    clusterName: ctx.clusterName,
    serviceNames: ctx.serviceNames,
  });

  console.log(`📅 Creating shutdown schedules (lease ${forRaw ?? `${leaseMs / (60 * 60 * 1000)}h`})`);
  console.log(`   scheduler → ${formatWhen(plan.schedulerAtMs)}`);
  console.log(`   send/inbox → ${formatWhen(plan.sendAtMs)} (+5m drain)`);

  await createSchedulesWithRollback(ctx, plan.schedules);
  console.log('📈 Scaling workers to 1/1/1');
  scaleWorkers(ctx, 1, 1, 1);

  console.log('');
  console.log('✨ Dev lease started. Workers will scale down automatically at scheduled times.');
  console.log('   Check status: npm run lease:dev:status');
}

async function cmdStatus(ctx: StackContext): Promise<void> {
  const existing = await listLeaseSchedules(ctx);
  const unresolved = findUnresolvedLeaseSchedules(existing);
  const desired = getDesiredCounts(ctx);

  console.log('Dev lease status');
  console.log(`  Cluster: ${ctx.clusterName}`);
  console.log(`  Schedule group: ${ctx.scheduleGroupName}`);
  console.log(`  Desired counts: send=${desired.send ?? '?'} scheduler=${desired.scheduler ?? '?'} inbox=${desired.inbox ?? '?'}`);

  if (unresolved.length === 0) {
    console.log('  Active shutdown schedules: none');
  } else {
    console.log(`  Active shutdown schedules (${unresolved.length}):`);
    for (const name of unresolved) {
      const runAtMs = await getScheduleRunAtMs(ctx, name);
      const remaining =
        runAtMs != null ? `${Math.max(0, Math.round((runAtMs - Date.now()) / 60_000))}m remaining` : 'time unknown';
      console.log(`    - ${name}: ${formatWhen(runAtMs)} (${remaining})`);
    }

    const schedulerExpiryMs = await getScheduleRunAtMs(ctx, LEASE_SCHEDULE_NAMES.scheduler);
    if (schedulerExpiryMs != null) {
      const extendOk = canExtendLease({ now: Date.now(), schedulerExpiryMs });
      console.log(`  Extension allowed (>10m before scheduler stop): ${extendOk ? 'yes' : 'no'}`);
    }
  }
}

async function cmdExtend(ctx: StackContext, leaseMs: number, forRaw: string | undefined): Promise<void> {
  const existing = await listLeaseSchedules(ctx);
  const unresolved = findUnresolvedLeaseSchedules(existing);
  if (unresolved.length === 0) {
    throw new Error('No active lease schedules to extend. Run npm run lease:dev first.');
  }

  const schedulerExpiryMs = await getScheduleRunAtMs(ctx, LEASE_SCHEDULE_NAMES.scheduler);
  if (schedulerExpiryMs == null) {
    throw new Error(`Could not read scheduler schedule ${LEASE_SCHEDULE_NAMES.scheduler}`);
  }

  if (!canExtendLease({ now: Date.now(), schedulerExpiryMs })) {
    throw new Error(
      'Refusing extension: scheduler shutdown is within 10 minutes. Prefer cost leakage over interrupted work.',
    );
  }

  await deleteSchedules(ctx, unresolved);

  const plan = buildShutdownSchedulePlan({
    now: Date.now(),
    leaseMs,
    clusterName: ctx.clusterName,
    serviceNames: ctx.serviceNames,
  });

  console.log(`⏱️  Extending lease by ${forRaw ?? `${leaseMs / (60 * 60 * 1000)}h`}`);
  await createSchedulesWithRollback(ctx, plan.schedules);
  console.log('✅ Lease extended (workers remain at current desired counts)');
}

async function cmdStop(ctx: StackContext): Promise<void> {
  const existing = await listLeaseSchedules(ctx);
  await deleteSchedules(ctx, existing);

  const plan = buildShutdownSchedulePlan({
    now: Date.now(),
    leaseMs: 0,
    clusterName: ctx.clusterName,
    serviceNames: ctx.serviceNames,
  });

  console.log('🛑 Scheduling immediate drain: scheduler now, send/inbox +5m');
  await createSchedulesWithRollback(ctx, plan.schedules);
  console.log('✅ Stop schedules created (ActionAfterCompletion=DELETE)');
}

function printUsage(): void {
  const pkgPath = path.join(__dirname, '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { scripts?: Record<string, string> };
  console.log(`Usage:
  npm run lease:dev [-- --for 2h]
  npm run lease:dev:status
  npm run lease:dev:extend [-- --for 2h]
  npm run lease:dev:stop

Scripts: ${Object.keys(pkg.scripts ?? {})
    .filter((key) => key.startsWith('lease:dev'))
    .join(', ')}`);
}

async function main(): Promise<void> {
  loadRepoEnv();

  if (process.argv.includes('-h') || process.argv.includes('--help')) {
    printUsage();
    return;
  }

  const parsed = parseArgs(process.argv.slice(2));
  ensureDevAccount();
  const ctx = loadStackContext();

  switch (parsed.command) {
    case 'start':
      await cmdStart(ctx, parsed.leaseMs, parsed.forRaw);
      break;
    case 'status':
      await cmdStatus(ctx);
      break;
    case 'extend':
      await cmdExtend(ctx, parsed.leaseMs, parsed.forRaw);
      break;
    case 'stop':
      await cmdStop(ctx);
      break;
    default:
      printUsage();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`❌ ${message}`);
  process.exit(1);
});
