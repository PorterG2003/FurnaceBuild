import { buildBodyParagraph, buildFurnaceEmail, buildFurnaceEmailText, escapeHtml, FURNACE_EMAIL_BRAND } from '../../buildFurnaceEmail.js';
import type { TransactionalEmail } from '../types.js';

export function buildConfirmSignupEmail(args: { confirmationUrl: string }): TransactionalEmail {
  const subject = 'Confirm your Furnace account';
  const bodyHtml = buildBodyParagraph(
    'Thanks for signing up. Click the button below to verify your email and get started.',
  );
  return {
    subject,
    html: buildFurnaceEmail({
      title: 'Confirm your email',
      pageTitle: 'Confirm your email',
      bodyHtml,
      cta: { label: 'Confirm email', href: args.confirmationUrl },
      disclaimer: "If you didn't create an account, you can ignore this email.",
    }),
    text: buildFurnaceEmailText({
      title: subject,
      bodyText: 'Thanks for signing up. Click the link below to verify your email and get started.',
      cta: { label: 'Confirm email', href: args.confirmationUrl },
      disclaimer: "If you didn't create an account, you can ignore this email.",
    }),
  };
}

export function buildMagicLinkEmail(args: { confirmationUrl: string }): TransactionalEmail {
  const subject = 'Your Furnace sign-in link';
  const bodyHtml = buildBodyParagraph(
    'Use the button below to sign in. This link works once and expires soon.',
  );
  return {
    subject,
    html: buildFurnaceEmail({
      title: 'Sign in to Furnace',
      pageTitle: 'Sign in to Furnace',
      bodyHtml,
      cta: { label: 'Sign in', href: args.confirmationUrl },
      disclaimer: "If you didn't request this, you can safely ignore this email.",
    }),
    text: buildFurnaceEmailText({
      title: subject,
      bodyText: 'Use the link below to sign in. This link works once and expires soon.',
      cta: { label: 'Sign in', href: args.confirmationUrl },
      disclaimer: "If you didn't request this, you can safely ignore this email.",
    }),
  };
}

export function buildResetPasswordEmail(args: { confirmationUrl: string; email: string }): TransactionalEmail {
  const subject = 'Reset your Furnace password';
  const bodyHtml = buildBodyParagraph(
    `We received a request to reset the password for ${escapeHtml(args.email)}. Click below to choose a new password.`,
  );
  return {
    subject,
    html: buildFurnaceEmail({
      title: 'Reset your password',
      pageTitle: 'Reset your password',
      bodyHtml,
      cta: { label: 'Reset password', href: args.confirmationUrl },
      disclaimer: "If you didn't request this, you can ignore this email. Your password will stay the same.",
    }),
    text: buildFurnaceEmailText({
      title: subject,
      bodyText: `We received a request to reset the password for ${args.email}.`,
      cta: { label: 'Reset password', href: args.confirmationUrl },
      disclaimer: "If you didn't request this, you can ignore this email. Your password will stay the same.",
    }),
  };
}

export function buildInviteUserEmail(args: { confirmationUrl: string }): TransactionalEmail {
  const subject = "You're invited to Furnace";
  const bodyHtml = buildBodyParagraph(
    "You've been invited to join Furnace. Click below to accept the invite and create your account.",
  );
  return {
    subject,
    html: buildFurnaceEmail({
      title: "You're invited",
      pageTitle: "You're invited to Furnace",
      bodyHtml,
      cta: { label: 'Accept invite', href: args.confirmationUrl },
      disclaimer: "If you weren't expecting this invite, you can ignore this email.",
    }),
    text: buildFurnaceEmailText({
      title: subject,
      bodyText: "You've been invited to join Furnace.",
      cta: { label: 'Accept invite', href: args.confirmationUrl },
      disclaimer: "If you weren't expecting this invite, you can ignore this email.",
    }),
  };
}

export function buildChangeEmailEmail(args: { confirmationUrl: string; newEmail: string }): TransactionalEmail {
  const subject = 'Confirm your new email address';
  const bodyHtml = buildBodyParagraph(
    `You requested to change your email to ${escapeHtml(args.newEmail)}. Click below to confirm.`,
  );
  return {
    subject,
    html: buildFurnaceEmail({
      title: 'Confirm new email',
      pageTitle: 'Confirm your new email',
      bodyHtml,
      cta: { label: 'Confirm email', href: args.confirmationUrl },
      disclaimer: "If you didn't request this change, you can ignore this email.",
    }),
    text: buildFurnaceEmailText({
      title: subject,
      bodyText: `You requested to change your email to ${args.newEmail}.`,
      cta: { label: 'Confirm email', href: args.confirmationUrl },
      disclaimer: "If you didn't request this change, you can ignore this email.",
    }),
  };
}

export function buildReauthenticationEmail(args: { token: string }): TransactionalEmail {
  const subject = 'Your Furnace verification code';
  return {
    subject,
    html: buildFurnaceEmail({
      title: 'Verification code',
      pageTitle: 'Verification code',
      bodyHtml: '',
      otpToken: args.token,
      disclaimer: "This code expires soon. If you didn't request it, you can ignore this email.",
    }),
    text: buildFurnaceEmailText({
      title: subject,
      bodyText: `Use this code to continue: ${args.token}`,
      disclaimer: "This code expires soon. If you didn't request it, you can ignore this email.",
    }),
  };
}

export function buildPasswordChangedEmail(args: { email: string }): TransactionalEmail {
  const subject = 'Your Furnace password was changed';
  const bodyHtml = [
    buildBodyParagraph(
      `The password for ${escapeHtml(args.email)} was recently changed. If you made this change, you're all set.`,
    ),
    `<p style="margin: 16px 0 0 0; font-size: 13px; line-height: 1.5; color: ${FURNACE_EMAIL_BRAND.textMuted};">If you didn't change it, please reset your password and contact support.</p>`,
  ].join('');
  return {
    subject,
    html: buildFurnaceEmail({
      title: 'Password changed',
      pageTitle: 'Password changed',
      bodyHtml,
    }),
    text: buildFurnaceEmailText({
      title: subject,
      bodyText: `The password for ${args.email} was recently changed.`,
    }),
  };
}

export function buildEmailAddressChangedEmail(args: { email: string; oldEmail: string }): TransactionalEmail {
  const subject = 'Your Furnace email address was changed';
  const bodyHtml = [
    buildBodyParagraph(
      `The email for your account was changed from ${escapeHtml(args.oldEmail)} to ${escapeHtml(args.email)}.`,
    ),
    `<p style="margin: 16px 0 0 0; font-size: 13px; line-height: 1.5; color: ${FURNACE_EMAIL_BRAND.textMuted};">If you didn't make this change, please contact support.</p>`,
  ].join('');
  return {
    subject,
    html: buildFurnaceEmail({
      title: 'Email address changed',
      pageTitle: 'Email address changed',
      bodyHtml,
    }),
    text: buildFurnaceEmailText({
      title: subject,
      bodyText: `The email for your account was changed from ${args.oldEmail} to ${args.email}.`,
    }),
  };
}

/** Go-template placeholders for Supabase Dashboard paste targets. */
export const SUPABASE_AUTH_PLACEHOLDERS = {
  confirmationUrl: '{{ .ConfirmationURL }}',
  token: '{{ .Token }}',
  email: '{{ .Email }}',
  newEmail: '{{ .NewEmail }}',
  oldEmail: '{{ .OldEmail }}',
} as const;

export function buildSupabaseAuthTemplates(): Array<{
  id: string;
  dashboardName: string;
  email: TransactionalEmail;
}> {
  const p = SUPABASE_AUTH_PLACEHOLDERS;
  return [
    {
      id: 'confirm-signup',
      dashboardName: 'Confirm signup',
      email: buildConfirmSignupEmail({ confirmationUrl: p.confirmationUrl }),
    },
    {
      id: 'magic-link',
      dashboardName: 'Magic link',
      email: buildMagicLinkEmail({ confirmationUrl: p.confirmationUrl }),
    },
    {
      id: 'reset-password',
      dashboardName: 'Reset password (recovery)',
      email: buildResetPasswordEmail({ confirmationUrl: p.confirmationUrl, email: p.email }),
    },
    {
      id: 'invite-user',
      dashboardName: 'Invite user',
      email: buildInviteUserEmail({ confirmationUrl: p.confirmationUrl }),
    },
    {
      id: 'change-email',
      dashboardName: 'Change email address',
      email: buildChangeEmailEmail({ confirmationUrl: p.confirmationUrl, newEmail: p.newEmail }),
    },
    {
      id: 'reauthentication',
      dashboardName: 'Reauthentication (OTP)',
      email: buildReauthenticationEmail({ token: p.token }),
    },
    {
      id: 'password-changed',
      dashboardName: 'Password changed (notification)',
      email: buildPasswordChangedEmail({ email: p.email }),
    },
    {
      id: 'email-changed',
      dashboardName: 'Email address changed (notification)',
      email: buildEmailAddressChangedEmail({ email: p.email, oldEmail: p.oldEmail }),
    },
  ];
}
