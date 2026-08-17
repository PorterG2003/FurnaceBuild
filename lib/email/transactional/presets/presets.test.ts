import assert from 'node:assert/strict';
import {
  buildAccountAmendmentEmail,
  buildConfirmSignupEmail,
  buildFluxQuizSubmissionEmail,
  buildHelpMessageEmail,
  buildMagicLinkEmail,
  buildPlatformInviteEmail,
  buildReauthenticationEmail,
  buildSupabaseAuthTemplates,
  buildTeamInvitationEmail,
} from './index.js';

function assertNoLegacyStyles(html: string): void {
  assert(!html.includes('linear-gradient'));
  assert(!html.includes('#f33203'));
  assert(!html.includes('#f85102'));
}

function run(): void {
  const team = buildTeamInvitationEmail({
    accountName: 'Acme Corp',
    inviterName: 'Alex Chen',
    inviterEmail: 'alex@acme.com',
    acceptUrl: 'https://build.getfurnace.io/accept',
  });
  assert(team.subject.includes('Acme Corp'));
  assert(team.html.includes('Accept Invitation'));
  assertNoLegacyStyles(team.html);

  const platform = buildPlatformInviteEmail({
    inviterName: 'Alex Chen',
    acceptUrl: 'https://build.getfurnace.io/accept-platform-invite/sample',
    proposalTitle: 'Your Furnace invite is ready',
    accountName: 'Acme Corp',
  });
  assert(platform.subject.includes('Alex Chen invited you to Furnace'));
  assert(platform.html.includes('View your invite'));
  assert(platform.html.includes('Your Furnace workspace is created and ready for you to finalize'));
  assert(platform.html.includes("We've prepared it for"));
  assert(platform.html.includes('Acme Corp'));
  assert(!platform.html.includes('/month'));
  assertNoLegacyStyles(platform.html);

  const help = buildHelpMessageEmail({
    topicLabel: 'Technical support',
    notes: 'Campaign send is stuck on node 3.',
    accountName: 'Acme Corp',
    fromName: 'Pat',
    fromEmail: 'pat@acme.com',
  });
  assert(help.subject.includes('Technical support'));
  assert(help.subject.includes('Acme Corp'));
  assert(help.html.includes('Campaign send is stuck on node 3.'));
  assert(help.html.includes('pat@acme.com'));
  assertNoLegacyStyles(help.html);

  const amendment = buildAccountAmendmentEmail({
    inviterName: 'Alex Chen',
    acceptUrl: 'https://build.getfurnace.io/accept-account-amendment/sample',
    accountName: 'Acme Corp',
  });
  assert(amendment.subject.includes('agreement was updated'));
  assertNoLegacyStyles(amendment.html);

  const quiz = buildFluxQuizSubmissionEmail({
    companyName: 'Acme Corp',
    prospectName: 'Jane Doe',
    pageUrl: 'https://build.getfurnace.io/p/acme',
    pageSlug: 'acme',
    prospectDetails: [
      ['Prospect', 'Jane Doe'],
      ['Company', 'Acme Corp'],
    ],
    answerRows: [{ prompt: 'Budget', answerText: '$10k–$25k/mo' }],
    notes: 'Interested in Q3 start.',
  });
  assert(quiz.subject.includes('Acme Corp'));
  assert(quiz.html.includes('Quiz and book submission'));
  assert(quiz.html.includes('Jane Doe'));
  assertNoLegacyStyles(quiz.html);

  const auth = buildConfirmSignupEmail({
    confirmationUrl: 'https://example.com/confirm',
  });
  assert(auth.html.includes('Confirm email'));
  assertNoLegacyStyles(auth.html);

  const magic = buildMagicLinkEmail({ confirmationUrl: 'https://example.com/magic' });
  assert(magic.html.includes('Sign in'));

  const otp = buildReauthenticationEmail({ token: '847291' });
  assert(otp.html.includes('847291'));

  const supabaseTemplates = buildSupabaseAuthTemplates();
  assert.equal(supabaseTemplates.length, 8);
  assert(supabaseTemplates[0]!.email.html.includes('{{ .ConfirmationURL }}'));
  assert(supabaseTemplates[5]!.email.html.includes('{{ .Token }}'));

  console.log('transactional email preset tests passed.');
}

run();
