/**
 * Send all 12 platform transactional email samples via Resend for visual QA.
 *
 * Resolves RESEND_API_KEY from (in order):
 * 1. RESEND_API_KEY env var
 * 2. RESEND_API_KEY_PARAM_PATH (full SSM name)
 * 3. {DEV|PROD_SECRET_SSM_PREFIX}/RESEND_API_KEY (Amplify secrets folder — same as Lambdas)
 *
 * Usage:
 *   npm run send:email-samples -- --to you@example.com
 *   QA_EMAIL_TO=you@example.com npm run send:email-samples
 *   npm run send:email-samples -- --dry-run
 *   SELF_RECOVERY_TARGET_ENV=dev npm run send:email-samples -- --to you@example.com
 *
 * Requires AWS credentials when fetching from Parameter Store.
 * Loads repo .env.local and infra/workers/.env.local (for DEV_SECRET_SSM_PREFIX).
 */
import { Resend } from 'resend';
import {
  buildAccountAmendmentEmail,
  buildChangeEmailEmail,
  buildConfirmSignupEmail,
  buildEmailAddressChangedEmail,
  buildFluxQuizSubmissionEmail,
  buildInviteUserEmail,
  buildMagicLinkEmail,
  buildPasswordChangedEmail,
  buildPlatformInviteEmail,
  buildReauthenticationEmail,
  buildResetPasswordEmail,
  buildTeamInvitationEmail,
} from '../lib/email/transactional/presets/index.js';
import {
  loadSelfRecoveryEnv,
  resolveResendApiKey,
  resolveSelfRecoveryTargetEnv,
} from './self-recovery-env.js';

loadSelfRecoveryEnv();

const FROM = 'Furnace <porter@getfurnace.io>';
const SEND_DELAY_MS = 600;

const SAMPLE = {
  inviterName: 'Alex Chen',
  inviterEmail: 'alex@getfurnace.io',
  accountName: 'Acme Corp',
  acceptUrl: 'https://build.getfurnace.io/accept-platform-invite/sample-id',
  amendmentUrl: 'https://build.getfurnace.io/accept-account-amendment/sample-id',
  teamAcceptUrl: 'https://build.getfurnace.io/accept-invitation/sample-id',
  confirmationUrl: 'https://build.getfurnace.io/auth/confirm?token=sample-token',
  email: 'qa-recipient@getfurnace.io',
  oldEmail: 'old@example.com',
  otp: '847291',
};

type SampleSpec = {
  id: string;
  build: () => { subject: string; html: string; text: string };
};

const SAMPLES: SampleSpec[] = [
  {
    id: 'confirm-signup',
    build: () => buildConfirmSignupEmail({ confirmationUrl: SAMPLE.confirmationUrl }),
  },
  {
    id: 'magic-link',
    build: () => buildMagicLinkEmail({ confirmationUrl: SAMPLE.confirmationUrl }),
  },
  {
    id: 'reset-password',
    build: () =>
      buildResetPasswordEmail({ confirmationUrl: SAMPLE.confirmationUrl, email: SAMPLE.email }),
  },
  {
    id: 'invite-user',
    build: () => buildInviteUserEmail({ confirmationUrl: SAMPLE.confirmationUrl }),
  },
  {
    id: 'change-email',
    build: () =>
      buildChangeEmailEmail({
        confirmationUrl: SAMPLE.confirmationUrl,
        newEmail: 'new@example.com',
      }),
  },
  {
    id: 'reauthentication',
    build: () => buildReauthenticationEmail({ token: SAMPLE.otp }),
  },
  {
    id: 'password-changed',
    build: () => buildPasswordChangedEmail({ email: SAMPLE.email }),
  },
  {
    id: 'email-changed',
    build: () =>
      buildEmailAddressChangedEmail({ email: SAMPLE.email, oldEmail: SAMPLE.oldEmail }),
  },
  {
    id: 'team-invite',
    build: () =>
      buildTeamInvitationEmail({
        accountName: SAMPLE.accountName,
        inviterName: SAMPLE.inviterName,
        inviterEmail: SAMPLE.inviterEmail,
        acceptUrl: SAMPLE.teamAcceptUrl,
      }),
  },
  {
    id: 'platform-invite',
    build: () =>
      buildPlatformInviteEmail({
        inviterName: SAMPLE.inviterName,
        acceptUrl: SAMPLE.acceptUrl,
        proposalTitle: 'Your Furnace invite is ready',
        accountName: SAMPLE.accountName,
      }),
  },
  {
    id: 'account-amendment',
    build: () =>
      buildAccountAmendmentEmail({
        inviterName: SAMPLE.inviterName,
        acceptUrl: SAMPLE.amendmentUrl,
        accountName: SAMPLE.accountName,
      }),
  },
  {
    id: 'flux-quiz',
    build: () =>
      buildFluxQuizSubmissionEmail({
        companyName: SAMPLE.accountName,
        prospectName: 'Jane Doe',
        pageUrl: 'https://build.getfurnace.io/p/acme-corp',
        pageSlug: 'acme-corp',
        prospectDetails: [
          ['Prospect', 'Jane Doe'],
          ['Company', SAMPLE.accountName],
          ['Role', 'VP Marketing'],
          ['Website', 'https://acme.example.com'],
          ['Industry', 'B2B SaaS'],
          ['Company size', '51–200'],
        ],
        answerRows: [
          { prompt: 'Monthly ad budget', answerText: '$10k–$25k/mo' },
          { prompt: 'Timeline', answerText: 'Q3 2026' },
        ],
        notes: 'Interested in paid search and competitor audit.',
      }),
  },
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv: string[]): {
  to: string;
  dryRun: boolean;
  only: Set<string> | null;
  targetEnv: 'prod' | 'dev';
} {
  let to = process.env.QA_EMAIL_TO?.trim() ?? '';
  let dryRun = false;
  let only: Set<string> | null = null;
  let targetEnv = resolveSelfRecoveryTargetEnv();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--to' && argv[i + 1]) {
      to = argv[++i]!.trim();
    } else if (arg === '--only' && argv[i + 1]) {
      only = new Set(
        argv[++i]!
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
      );
    } else if (arg === '--env' && argv[i + 1]) {
      const value = argv[++i]!.trim().toLowerCase();
      if (value === 'prod' || value === 'dev') {
        targetEnv = value;
      } else {
        throw new Error('--env must be dev or prod');
      }
    }
  }

  return { to, dryRun, only, targetEnv };
}

async function main(): Promise<void> {
  const { to, dryRun, only, targetEnv } = parseArgs(process.argv.slice(2));
  if (!to && !dryRun) {
    console.error('Usage: npm run send:email-samples -- --to you@example.com');
    console.error('       QA_EMAIL_TO=you@example.com npm run send:email-samples');
    console.error('Options: --dry-run  --only team-invite,platform-invite  --env dev|prod');
    console.error('');
    console.error('Resend key: RESEND_API_KEY env, or {DEV|PROD_SECRET_SSM_PREFIX}/RESEND_API_KEY from Amplify secrets.');
    process.exit(1);
  }

  const selected = only
    ? SAMPLES.filter((sample) => only.has(sample.id))
    : SAMPLES;

  if (selected.length === 0) {
    console.error('No matching samples. Available ids:');
    console.error(SAMPLES.map((sample) => sample.id).join(', '));
    process.exit(1);
  }

  let apiKey: string | null = null;
  if (!dryRun) {
    const resolved = await resolveResendApiKey({ targetEnv });
    apiKey = resolved.apiKey;
    console.log(`Target env: ${targetEnv}`);
    console.log(`Resolved RESEND_API_KEY from ${resolved.source}.`);
    console.log('');
  }

  const resend = apiKey ? new Resend(apiKey) : null;

  console.log(`${dryRun ? 'Dry run' : 'Sending'} ${selected.length} sample email(s)${to ? ` to ${to}` : ''}…`);
  console.log('');

  for (const sample of selected) {
    const email = sample.build();
    const subject = `[QA] ${sample.id}: ${email.subject}`;

    if (dryRun) {
      console.log(`- ${sample.id}: ${subject}`);
      continue;
    }

    const { data, error } = await resend!.emails.send({
      from: FROM,
      to: [to],
      subject,
      html: email.html,
      text: email.text,
    });

    if (error) {
      console.error(`✗ ${sample.id}: ${JSON.stringify(error)}`);
      process.exitCode = 1;
    } else {
      console.log(`✓ ${sample.id}: ${subject} (${data?.id ?? 'no id'})`);
    }

    await sleep(SEND_DELAY_MS);
  }

  console.log('');
  console.log('Done.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
