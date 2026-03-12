import outputs from '@/amplify_outputs.json';
import { getAccessToken } from '@/lib/services/auth-token';
import { reportErrorToSlack } from '@/lib/slack/reportErrorToSlack';

const custom = (
  outputs as {
    custom?: {
      launchSmartleadMigrationUrl?: string;
    };
  }
).custom;

const LAUNCH_SMARTLEAD_MIGRATION_URL = custom?.launchSmartleadMigrationUrl;

interface LaunchSmartleadMigrationParams {
  runId: string;
  accountId: string;
  apiKey: string;
}

async function callLauncher(body: Record<string, unknown>) {
  if (!LAUNCH_SMARTLEAD_MIGRATION_URL) {
    throw new Error(
      'launchSmartleadMigration URL not configured. Deploy the Amplify backend and ensure amplify_outputs.json includes custom.launchSmartleadMigrationUrl.',
    );
  }

  const token = await getAccessToken();
  if (!token) {
    throw new Error('You must be signed in to launch a Smartlead migration.');
  }

  const res = await fetch(LAUNCH_SMARTLEAD_MIGRATION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = (data as { error?: string }).error || res.statusText || 'Failed to launch Smartlead migration';
    reportErrorToSlack('Smartlead migration launcher failed', { severity: 'warning', error: message });
    throw new Error(message);
  }

  return data as { success?: boolean; taskArn?: string };
}

export async function launchSmartleadMigrationTask(
  params: LaunchSmartleadMigrationParams,
): Promise<void> {
  const data = await callLauncher({
    action: 'launch',
    runId: params.runId,
    accountId: params.accountId,
    apiKey: params.apiKey,
  });

  if (!data.success) {
    throw new Error('Failed to launch Smartlead migration task.');
  }
}

export async function resumeSmartleadMigrationTask(params: {
  runId: string;
  accountId: string;
}): Promise<void> {
  const data = await callLauncher({
    action: 'resume',
    runId: params.runId,
    accountId: params.accountId,
  });

  if (!data.success) {
    throw new Error('Failed to resume Smartlead migration task.');
  }
}
